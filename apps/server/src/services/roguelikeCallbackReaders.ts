import { getCallbackDetails } from './maaCallbackService.ts';
import type { MaaCallbackEvent } from './maaCallbackService.ts';

export interface RoguelikeSettlementSummary {
  gamePass: boolean | null;
  floor: number | null;
  step: number | null;
  combat: number | null;
  recruit: number | null;
  collection: number | null;
  boss: number | null;
  emergency: number | null;
  difficulty: number | null;
  score: number | null;
  exp: number | null;
  skill: string | null;
}

export interface RoguelikeInvestmentSummary {
  rounds: number;
  count: number;
  total: number | null;
  deposit: number | null;
  reachedLimit: boolean;
  reachedFull: boolean;
}

export interface RoguelikeEventSummary {
  name: string;
  option: string | null;
}

const SETTLEMENT_NUMBER_FIELDS = [
  'floor',
  'step',
  'combat',
  'recruit',
  'collection',
  'boss',
  'emergency',
  'difficulty',
  'score'
] as const;

function readSignedCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumericText(value: unknown): number | null {
  const text = readText(value);
  if (text === null) return null;
  const parsed = Number.parseInt(text.replace(/[^0-9-]/g, ''), 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function readChoiceLabel(value: unknown): string | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
    ? `选项 ${value}`
    : null;
}

export function readRoguelikeSettlement(event: MaaCallbackEvent): RoguelikeSettlementSummary | null {
  if (event.what !== 'RoguelikeSettlement') return null;

  const details = getCallbackDetails(event);
  if (!details) return null;

  const settlement: RoguelikeSettlementSummary = {
    gamePass: typeof details.game_pass === 'boolean' ? details.game_pass : null,
    floor: null,
    step: null,
    combat: null,
    recruit: null,
    collection: null,
    boss: null,
    emergency: null,
    difficulty: null,
    score: null,
    exp: readNumericText(details.exp),
    skill: readText(details.skill)
  };

  for (const field of SETTLEMENT_NUMBER_FIELDS) {
    settlement[field] = readSignedCount(details[field]);
  }

  return Object.values(settlement).some(value => value !== null) ? settlement : null;
}

export function readRoguelikeEvent(event: MaaCallbackEvent): RoguelikeEventSummary | null {
  const what = event.what;
  if (what !== 'RoguelikeEvent' && what !== 'RoguelikeEventSelected') return null;

  const details = getCallbackDetails(event);
  if (!details) return null;

  const name = readText(details.name);
  if (name === null) return null;

  const option = what === 'RoguelikeEventSelected'
    ? readText(details.option_text) ?? readChoiceLabel(details.choose_option)
    : readChoiceLabel(details.choose_option);

  return { name, option };
}

export function readRoguelikeTaskName(event: MaaCallbackEvent): string | null {
  const task = readText(getCallbackDetails(event)?.task);
  if (task === null) return null;

  const separator = task.lastIndexOf('@');
  const name = separator === -1 ? task : task.slice(separator + 1);
  return name.trim() || null;
}

export function readRoguelikeInvestment(
  event: MaaCallbackEvent,
  current: RoguelikeInvestmentSummary | null
): RoguelikeInvestmentSummary {
  const details = getCallbackDetails(event) ?? {};
  const count = readSignedCount(details.count);
  const deposit = readSignedCount(details.deposit);
  const base: RoguelikeInvestmentSummary = current ?? {
    rounds: 0,
    count: 0,
    total: null,
    deposit: null,
    reachedLimit: false,
    reachedFull: false
  };

  return {
    ...base,
    rounds: base.rounds + 1,
    count: base.count + (count !== null && count >= 0 ? count : 0),
    total: readSignedCount(details.total) ?? base.total,
    deposit: deposit !== null && deposit >= 0 ? deposit : base.deposit
  };
}
