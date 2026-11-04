import {
  beginAgentRun,
  completeAgentRun,
  failAgentRun,
  flushAgentRunStore,
  getAgentRun,
  markAgentRunWaiting,
  setAgentRunAcceptedResult,
  startAgentRunForExecution,
  stopAgentRun,
  updateAgentRunProgress
} from './agentRunService.ts';
import type { AgentRunDto } from './agentRunService.ts';
import { buildCopilotPlan, executeCopilotPlan } from './copilotPlanService.ts';

export interface CopilotManualSession {
  runId: string;
  setId: string;
  name: string;
  raid: string;
  selectedItemIndexes: number[];
  options: Record<string, unknown>;
}

export interface CopilotManualStepResult {
  runId: string;
  state: string;
  setId: string;
  name: string;
  waitingForNext: boolean;
  finished: boolean;
  stopped: boolean;
  nextItemIndex: number | null;
  taskResults: unknown[];
  message: string;
}

const sessions = new Map<string, CopilotManualSession>();
let planBuilder = buildCopilotPlan;
let stepExecutor = executeCopilotPlan;
type ManualPlanBuilder = typeof buildCopilotPlan;
type ManualStepExecutor = typeof executeCopilotPlan;

export function configureManualCopilotRuntimeForTests(overrides: {
  buildPlan?: ManualPlanBuilder;
  executeStep?: ManualStepExecutor;
} = {}): void {
  planBuilder = overrides.buildPlan ?? buildCopilotPlan;
  stepExecutor = overrides.executeStep ?? executeCopilotPlan;
}

export function resetManualCopilotRuntimeForTests(): void {
  sessions.clear();
  planBuilder = buildCopilotPlan;
  stepExecutor = executeCopilotPlan;
}


function normalizeSelectedIndexes(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter(Number.isInteger))];
}

function pendingItemIndexes(
  plan: Awaited<ReturnType<typeof buildCopilotPlan>>,
  selectedIndexes: number[]
): number[] {
  const selected = new Set(selectedIndexes);
  return [...new Set(
    plan.entries
      .filter(entry => !entry.completed && (selected.size === 0 || selected.has(entry.itemIndex)))
      .map(entry => entry.itemIndex)
  )].sort((left, right) => left - right);
}

function makeResult(
  session: CopilotManualSession,
  run: AgentRunDto | null,
  status: { waitingForNext: boolean; finished: boolean; stopped: boolean; nextItemIndex: number | null; message: string }
): CopilotManualStepResult {
  return {
    runId: session.runId,
    state: run?.state || 'running',
    setId: session.setId,
    name: session.name,
    waitingForNext: status.waitingForNext,
    finished: status.finished,
    stopped: status.stopped,
    nextItemIndex: status.nextItemIndex,
    taskResults: Array.isArray(run?.taskResults) ? run.taskResults : [],
    message: status.message
  };
}

async function executeStep(session: CopilotManualSession, itemIndex: number): Promise<void> {
  await stepExecutor({
    setId: session.setId,
    raid: session.raid,
    selectedIndexes: [itemIndex],
    options: session.options,
    lifecycle: {
      runId: session.runId,
      onProgress: (progress, taskResults) => updateAgentRunProgress(session.runId, progress, taskResults ?? null)
    }
  });
}

async function advance(
  session: CopilotManualSession,
  run: AgentRunDto,
  executing: boolean
): Promise<CopilotManualStepResult> {
  let plan = await planBuilder(session.setId, session.raid);
  let pending = pendingItemIndexes(plan, session.selectedItemIndexes);
  if (executing) {
    // The step was just executed; progress is re-read to derive the next item.
    plan = await planBuilder(session.setId, session.raid);
    pending = pendingItemIndexes(plan, session.selectedItemIndexes);
  }
  const nextItemIndex = pending[0] ?? null;

  if (nextItemIndex === null) {
    const result = makeResult(session, run, {
      waitingForNext: false,
      finished: true,
      stopped: false,
      nextItemIndex: null,
      message: '手动作业集执行完成'
    });
    completeAgentRun(session.runId, result);
    sessions.delete(session.runId);
    await flushAgentRunStore().catch(() => undefined);
    return { ...result, runId: session.runId, state: 'succeeded', taskResults: getAgentRun(session.runId)?.taskResults ?? result.taskResults };
  }

  const waiting = makeResult(session, run, {
    waitingForNext: true,
    finished: false,
    stopped: false,
    nextItemIndex,
    message: '等待开始下一关'
  });
  markAgentRunWaiting(session.runId);
  updateAgentRunProgress(session.runId, {
    setId: session.setId,
    name: session.name,
    phase: 'waiting_for_next',
    selectedIndexes: session.selectedItemIndexes,
    nextItemIndex,
    message: '等待开始下一关',
    currentStep: null,
    totalSteps: null
  }, null);
  setAgentRunAcceptedResult(session.runId, waiting);
  await flushAgentRunStore().catch(() => undefined);
  const latest = getAgentRun(session.runId);
  return { ...waiting, state: latest?.state || 'waiting' };
}

export async function startManualCopilotSet({
  setId,
  raid = 'normal',
  selectedIndexes,
  options = {},
  clientType,
  idempotencyKey
}: {
  setId: string | number;
  raid?: string;
  selectedIndexes?: unknown;
  options?: Record<string, unknown>;
  clientType?: string;
  idempotencyKey?: string | null;
}): Promise<CopilotManualStepResult> {
  const normalizedSetId = String(setId);
  const plan = await planBuilder(normalizedSetId, raid);
  const selected = normalizeSelectedIndexes(selectedIndexes);
  const pending = pendingItemIndexes(plan, selected);
  if (pending.length === 0) {
    const session: CopilotManualSession = {
      runId: '',
      setId: normalizedSetId,
      name: plan.name,
      raid,
      selectedItemIndexes: selected,
      options
    };
    const result = makeResult(session, null, {
      waitingForNext: false,
      finished: true,
      stopped: false,
      nextItemIndex: null,
      message: '作业集没有待执行条目'
    });
    return { ...result, state: 'succeeded' };
  }

  const reservation = beginAgentRun({
    operationId: 'run_copilot_set_manual',
    idempotencyKey,
    input: { setId: normalizedSetId, raid, selectedIndexes: selected, options, clientType },
    metadata: { taskName: `作业集手动执行 ${plan.name}`, taskType: 'copilot' },
    progress: { setId: normalizedSetId, name: plan.name, phase: 'starting', message: '准备执行' }
  });
  const runId = reservation.run.runId;
  const session: CopilotManualSession = {
    runId,
    setId: normalizedSetId,
    name: plan.name,
    raid,
    selectedItemIndexes: selected,
    options: { ...options, ...(clientType ? { clientType } : {}) }
  };
  sessions.set(runId, session);

  try {
    await flushAgentRunStore();
  } catch (error) {
    sessions.delete(runId);
    failAgentRun(runId, error);
    await flushAgentRunStore().catch(() => undefined);
    throw error;
  }

  try {
    startAgentRunForExecution(runId);
    await executeStep(session, pending[0]);
    return await advance(session, getAgentRun(runId)!, true);
  } catch (error) {
    sessions.delete(runId);
    failAgentRun(runId, error);
    await flushAgentRunStore().catch(() => undefined);
    throw error;
  }
}

export async function continueManualCopilotSet({
  runId,
  options
}: {
  runId: string;
  options?: Record<string, unknown>;
}): Promise<CopilotManualStepResult> {
  const session = sessions.get(runId);
  if (!session) {
    throw Object.assign(new Error('手动作业集会话不存在或已结束'), {
      code: 'COPILOT_MANUAL_SESSION_NOT_FOUND',
      statusCode: 404,
      retryable: false
    });
  }
  if (options && Object.keys(options).length > 0) session.options = { ...session.options, ...options };

  const current = getAgentRun(runId);
  if (!current) {
    sessions.delete(runId);
    throw Object.assign(new Error('手动作业集 Run 不存在'), {
      code: 'COPILOT_MANUAL_RUN_NOT_FOUND',
      statusCode: 404,
      retryable: false
    });
  }
  if (current.state === 'waiting' || current.state === 'running' || current.state === 'accepted') {
    startAgentRunForExecution(runId);
  } else {
    sessions.delete(runId);
    throw Object.assign(new Error(`手动作业集 Run 当前状态为 ${current.state}，不能继续`), {
      code: 'COPILOT_MANUAL_RUN_NOT_CONTINUABLE',
      statusCode: 409,
      details: { runId, state: current.state },
      retryable: false
    });
  }

  const plan = await planBuilder(session.setId, session.raid);
  const pending = pendingItemIndexes(plan, session.selectedItemIndexes);
  const nextItemIndex = pending[0];
  if (nextItemIndex === undefined) {
    return advance(session, getAgentRun(runId)!, false);
  }
  try {
    await flushAgentRunStore();
    await executeStep(session, nextItemIndex);
    return await advance(session, getAgentRun(runId)!, true);
  } catch (error) {
    sessions.delete(runId);
    failAgentRun(runId, error);
    await flushAgentRunStore().catch(() => undefined);
    throw error;
  }
}

export function stopManualCopilotSetRun(runId: string): AgentRunDto | null {
  const session = sessions.get(runId);
  if (!session) return null;
  sessions.delete(runId);
  const run = getAgentRun(runId);
  if (!run) return null;
  if (['succeeded', 'failed', 'stopped', 'interrupted'].includes(run.state)) return run;
  return stopAgentRun(runId, { canceled: true });
}

export function getManualCopilotSetSession(runId: string): CopilotManualSession | null {
  const session = sessions.get(runId);
  return session ? { ...session, selectedItemIndexes: [...session.selectedItemIndexes], options: { ...session.options } } : null;
}
