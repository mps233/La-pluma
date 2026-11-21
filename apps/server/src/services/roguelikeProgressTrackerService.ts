import { parseMaaCallbackEvents } from './maaCallbackService.ts';
import type { MaaCallbackEvent } from './maaCallbackService.ts';
import { readMaaLogChunk } from './maaLogFileService.ts';
import type { MaaLogCheckpoint, MaaLogChunk } from './maaLogFileService.ts';
import {
  applyRoguelikeProgressEvents,
  buildRoguelikeProgressSnapshot,
  createRoguelikeProgressState,
  markRoguelikeProgressDegraded
} from './roguelikeProgressService.ts';
import type {
  RoguelikeCommand,
  RoguelikeProgressSnapshot,
  RoguelikeProgressState
} from './roguelikeProgressService.ts';

export interface RoguelikeProgressTrackerInput {
  runId: string;
  checkpoint: MaaLogCheckpoint;
  command: RoguelikeCommand;
  theme: string;
  mode: number | null;
  targetRounds: number | null;
  settlementSupported: boolean | null;
  startedAtMs: number | null;
}

interface ProgressTrackerTimer {
  cancel(): void;
}

export interface RoguelikeProgressTrackerRuntime {
  now(): number;
  schedule(callback: () => void, delayMs: number): ProgressTrackerTimer;
  readChunk(checkpoint: MaaLogCheckpoint, maxBytes: number): Promise<MaaLogChunk>;
  parseEvents(text: string, taskchain: string): MaaCallbackEvent[];
}

interface ProgressTrackerRegistration {
  checkpoint: MaaLogCheckpoint;
  taskchain: string;
  state: RoguelikeProgressState;
  snapshot: RoguelikeProgressSnapshot;
  timer: ProgressTrackerTimer | null;
  finalized: boolean;
  running: Promise<void> | null;
  finalizePromise: Promise<RoguelikeProgressSnapshot | null> | null;
}

const POLL_INTERVAL_MS = 1_000;
const READ_CHUNK_BYTES = 256 * 1024;
const TICK_CHUNK_LIMIT = 4;
const FINALIZE_CHUNK_LIMIT = 16;

const defaultRuntime: RoguelikeProgressTrackerRuntime = {
  now: () => Date.now(),
  schedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    timer.unref?.();
    let cancelled = false;
    return {
      cancel() {
        if (cancelled) return;
        cancelled = true;
        clearTimeout(timer);
      }
    };
  },
  readChunk: (checkpoint, maxBytes) => readMaaLogChunk(checkpoint, maxBytes),
  parseEvents: (text, taskchain) => parseMaaCallbackEvents(text, taskchain)
};

let runtime = defaultRuntime;
const trackers = new Map<string, ProgressTrackerRegistration>();

function resolveTaskchain(command: RoguelikeCommand): string {
  return command === 'reclamation' ? 'Reclamation' : 'Roguelike';
}

function cancelTimer(registration: ProgressTrackerRegistration): void {
  const timer = registration.timer;
  if (!timer) return;
  registration.timer = null;
  timer.cancel();
}

interface DrainResult {
  aborted: boolean;
}

async function drainChunks(
  registration: ProgressTrackerRegistration,
  chunkLimit: number,
  shouldAbort: (() => boolean) | null,
  continueOnTruncated: boolean
): Promise<DrainResult> {
  for (let index = 0; index < chunkLimit; index += 1) {
    if (shouldAbort?.()) return { aborted: true };

    let chunk: MaaLogChunk;
    try {
      chunk = await runtime.readChunk(registration.checkpoint, READ_CHUNK_BYTES);
    } catch {
      registration.state = markRoguelikeProgressDegraded(registration.state);
      return { aborted: false };
    }

    if (shouldAbort?.()) return { aborted: true };

    registration.checkpoint = chunk.nextCheckpoint;
    if (chunk.text) {
      const events = runtime.parseEvents(chunk.text, registration.taskchain);
      if (events.length > 0) {
        registration.state = applyRoguelikeProgressEvents(registration.state, events);
      }
    }

    if (chunk.status !== 'ok') {
      registration.state = markRoguelikeProgressDegraded(registration.state);
    }
    if (chunk.status === 'unreadable') {
      return { aborted: false };
    }
    if (chunk.status === 'truncated' && !continueOnTruncated) {
      return { aborted: false };
    }
    if (chunk.caughtUp) return { aborted: false };
  }

  registration.state = markRoguelikeProgressDegraded(registration.state);
  return { aborted: false };
}

function scheduleTick(
  runId: string,
  registration: ProgressTrackerRegistration,
  delayMs: number
): void {
  if (registration.finalized || trackers.get(runId) !== registration) return;

  registration.timer = runtime.schedule(() => {
    registration.timer = null;
    if (registration.finalized || trackers.get(runId) !== registration) return;

    const running = runTick(runId, registration);
    registration.running = running;
    const settle = (): void => {
      if (registration.running === running) registration.running = null;
    };
    void running.then(settle, settle);
  }, delayMs);
}

async function runTick(runId: string, registration: ProgressTrackerRegistration): Promise<void> {
  let aborted = false;
  try {
    const result = await drainChunks(
      registration,
      TICK_CHUNK_LIMIT,
      () => registration.finalized || trackers.get(runId) !== registration,
      false
    );
    aborted = result.aborted;
  } catch {
    registration.state = markRoguelikeProgressDegraded(registration.state);
  }

  if (aborted || registration.finalized || trackers.get(runId) !== registration) return;

  registration.snapshot = buildRoguelikeProgressSnapshot(registration.state, runtime.now());
  scheduleTick(runId, registration, POLL_INTERVAL_MS);
}

export function startRoguelikeProgressTracker(input: RoguelikeProgressTrackerInput): boolean {
  if (trackers.has(input.runId)) return false;

  const state = createRoguelikeProgressState({
    command: input.command,
    theme: input.theme,
    mode: input.mode,
    targetRounds: input.targetRounds,
    settlementSupported: input.settlementSupported,
    startedAtMs: input.startedAtMs
  });
  const registration: ProgressTrackerRegistration = {
    checkpoint: input.checkpoint,
    taskchain: resolveTaskchain(input.command),
    state,
    snapshot: buildRoguelikeProgressSnapshot(state, runtime.now()),
    timer: null,
    finalized: false,
    running: null,
    finalizePromise: null
  };

  trackers.set(input.runId, registration);
  scheduleTick(input.runId, registration, 0);
  return true;
}

export async function finalizeRoguelikeProgressTracker(
  runId: string
): Promise<RoguelikeProgressSnapshot | null> {
  const registration = trackers.get(runId);
  if (!registration) return null;
  if (registration.finalizePromise) return registration.finalizePromise;

  const finalizePromise = (async () => {
    registration.finalized = true;
    cancelTimer(registration);

    if (registration.running) {
      await registration.running;
    }

    try {
      await drainChunks(registration, FINALIZE_CHUNK_LIMIT, null, true);
    } catch {
      registration.state = markRoguelikeProgressDegraded(registration.state);
    }

    registration.snapshot = buildRoguelikeProgressSnapshot(registration.state, runtime.now());
    return registration.snapshot;
  })();

  registration.finalizePromise = finalizePromise;
  return finalizePromise;
}

export function releaseRoguelikeProgressTracker(runId: string): void {
  const registration = trackers.get(runId);
  if (!registration) return;
  registration.finalized = true;
  trackers.delete(runId);
  cancelTimer(registration);
}

export function releaseAllRoguelikeProgressTrackers(): void {
  for (const runId of [...trackers.keys()]) {
    releaseRoguelikeProgressTracker(runId);
  }
}

export function getRoguelikeProgress(runId: string): RoguelikeProgressSnapshot | null {
  return trackers.get(runId)?.snapshot ?? null;
}

export function configureRoguelikeProgressTrackerRuntimeForTests(
  overrides: Partial<RoguelikeProgressTrackerRuntime> = {}
): void {
  runtime = { ...defaultRuntime, ...overrides };
}

export function resetRoguelikeProgressTrackerForTests(): void {
  releaseAllRoguelikeProgressTrackers();
  runtime = defaultRuntime;
}
