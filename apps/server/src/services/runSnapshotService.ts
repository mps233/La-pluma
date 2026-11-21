import { getActiveAgentRuns, getLatestTerminalAgentRun, isDeviceOwningAgentRunStatus } from './agentRunService.ts';
import type { AgentRunDto, AgentRunStatus } from './agentRunService.ts';
import { getCopilotSetRunProgress } from './copilotSetRunService.ts';
import type { CopilotSetProgress } from './copilotSetRunService.ts';
import { getCopilotQueueRunProgress } from './copilotQueueRunService.ts';
import type { CopilotQueueProgress } from './copilotQueueRunService.ts';
import { getMaaExecutionLeaseSnapshot } from './executionCoordinatorService.ts';
import type { MaaExecutionLeaseSnapshot } from './executionCoordinatorService.ts';
import { getRealtimeLogs, getTaskStatus } from './maaProcessService.ts';
import type { MaaRealtimeLogEntry, MaaTaskStatus } from './maaProcessService.ts';
import { getScheduleExecutionStatus } from './schedulerService.ts';
import type { ScheduleExecutionStatus } from './scheduleFlowExecution.ts';
import { getRoguelikeStopIntent } from './roguelikeStopIntentService.ts';
import type { RoguelikeStopIntent } from './roguelikeStopIntentService.ts';
import { getRoguelikeProgress } from './roguelikeProgressTrackerService.ts';
import type { RoguelikeProgressSnapshot } from './roguelikeProgressService.ts';
import { resolveBoundedInteger } from '../utils/numericQueryHelper.ts';

/**
 * Run 身份与终态只来自 agentRunService；进程、流程与设备租约是并列的独立投影，
 * 本模块只汇总成可观察快照，不复制状态机，也不从探测结果推断执行成功。
 */

const ACTIVE_RUN_STATES = new Set<AgentRunStatus>(['accepted', 'waiting', 'running', 'stopping']);

/**
 * 更新 Run 的进度标签：进程投影只来自 taskStatus（受管更新子进程），
 * 未启动时显示固定标签，避免把“进程 idle”误读成更新完成。
 */
const UPDATE_PROGRESS_LABELS: Readonly<Record<string, string>> = {
  update_core: 'MaaCore 更新',
  update_cli: 'MAA CLI 更新',
  update_resources: '资源同步'
};

/**
 * 快照里的进程/流程进度投影：只描述当前拥有或等待执行权的那次执行，
 * 不是 Run 状态，也不能替代作业集会话进度。
 */
export interface AgentRunProgressProjection {
  currentStep: number | null;
  totalSteps: number | null;
  currentTask: string | null;
  message: string;
  /** 仅日常流程投影自己的 schedule 身份，其它执行不带。 */
  scheduleId?: string | null;
  /** 仅日常流程带停止意图。 */
  shouldStop?: boolean;
  /** 仅肉鸽/生息演算战斗结束后的延后停止带。 */
  stopIntent?: RoguelikeStopIntent;
  /** 肉鸽/生息演算 run_task 的运行中进度快照。 */
  roguelike?: RoguelikeProgressSnapshot;
}

/**
 * 快照中的 Run 视图：Run DTO 字段原样保留，`progress` 只由本模块为活动 Run
 * 追加。进程/流程投影与作业集会话进度结构不同，不能互相替代。
 */
export interface AgentRunSnapshotEntry extends AgentRunDto {
  progress?: AgentRunProgressProjection | CopilotSetProgress | CopilotQueueProgress;
}

/** 设备占用来源：只列出本次观察到的投影，不推断未观察到的来源。 */
export type DeviceOccupancySource = 'run' | 'task' | 'schedule' | 'lease';

/**
 * 设备占用状态：`run` 表示被跟踪的 Run 拥有执行权，`external` 表示观察到设备
 * 活动但没有这样的 Run，`pending` 表示只有尚未取得执行权的意图，`idle`
 * 表示没有观察到活动，`unknown` 表示租约文件存在但无法核实。
 */
export type DeviceOccupancyState = 'idle' | 'run' | 'external' | 'pending' | 'unknown';

/** 占用里的进程投影：只描述 MAA 子进程，不是 Run 终态。 */
export interface OccupancyTaskProjection {
  isRunning: boolean;
  taskName: string | null;
  taskType: string | null;
  stopRequested: boolean;
}

export interface OccupancyScheduleProjection {
  isRunning: boolean;
  scheduleId: string | null;
  runId: string | null;
  currentStep: number;
  totalSteps: number;
  currentTask: string | null;
  shouldStop: boolean;
}

/** 设备占用投影：Run、进程、流程与租约各自保留来源，不能合并成单一终态。 */
export interface RunOccupancyProjection {
  state: DeviceOccupancyState;
  runId: string | null;
  runState: AgentRunStatus | null;
  sources: DeviceOccupancySource[];
  lease: MaaExecutionLeaseSnapshot;
  task: OccupancyTaskProjection;
  schedule: OccupancyScheduleProjection;
}

/** `/runs/current` 的行数查询：值保持 unknown，由 normalizeLineCount 归一。 */
export interface AgentRunSnapshotOptions {
  lines?: unknown;
}

/** 快照响应：顶层仍保留旧任务字段，另加 Run、日志、最新终态与占用投影。 */
export interface AgentRunSnapshot extends MaaTaskStatus {
  schedule: ScheduleExecutionStatus;
  recentLogs: MaaRealtimeLogEntry[];
  run: AgentRunSnapshotEntry | null;
  activeRuns: AgentRunSnapshotEntry[];
  lastRun: AgentRunDto | null;
  occupancy: RunOccupancyProjection;
}

interface OccupancyInput {
  activeRuns: AgentRunDto[];
  task: MaaTaskStatus;
  schedule: ScheduleExecutionStatus;
  lease: MaaExecutionLeaseSnapshot;
}

function normalizeLineCount(lines: unknown): number {
  return resolveBoundedInteger(lines, { defaultValue: 80, min: 1, max: 500 });
}

/** Run DTO 在领域层把 `progress` 保留为 unknown（投影由快照层追加），这里在快照边界收窄。 */
function asSnapshotEntry(run: AgentRunDto): AgentRunSnapshotEntry {
  return run as AgentRunSnapshotEntry;
}

/**
 * Adds the process projection to an active run. Progress is read from the
 * current task/schedule, so it only describes the run that owns execution.
 * A daily flow that has not published its schedule state yet is reported as
 * waiting instead of borrowing another flow's steps.
 *
 * 入参为 null 时原样返回 null：停止/落盘等入口会把“没有 Run”传给本函数，
 * 这里不补造 Run，也不把缺失当成成功终态。
 */
export function enrichAgentRun(run: AgentRunDto): AgentRunSnapshotEntry;
export function enrichAgentRun(run: null): null;
export function enrichAgentRun(run: AgentRunDto | null): AgentRunSnapshotEntry | null;
export function enrichAgentRun(run: AgentRunDto | null): AgentRunSnapshotEntry | null {
  if (!run || !ACTIVE_RUN_STATES.has(run.state)) return run as AgentRunSnapshotEntry | null;

  const schedule = getScheduleExecutionStatus();
  const task = getTaskStatus();
  if (run.operationId === 'run_daily_flow') {
    if (schedule.runId !== run.runId) {
      return {
        ...run,
        progress: {
          currentStep: null,
          totalSteps: null,
          currentTask: null,
          message: run.state === 'accepted' ? '等待执行权' : '等待流程状态'
        }
      };
    }
    return {
      ...run,
      progress: {
        scheduleId: schedule.scheduleId,
        currentStep: schedule.currentStep,
        totalSteps: schedule.totalSteps,
        currentTask: schedule.currentTask,
        shouldStop: schedule.shouldStop,
        message: schedule.message || (schedule.isRunning ? '今日流程执行中' : '今日流程正在收尾')
      }
    };
  }
  if (run.operationId === 'run_copilot_set') {
    const progress = getCopilotSetRunProgress(run.runId);
    if (progress) return { ...run, progress };
    return {
      ...run,
      progress: {
        currentStep: null,
        totalSteps: null,
        currentTask: null,
        message: run.state === 'waiting' ? '等待开始下一关' : '等待作业集状态'
      }
    };
  }
  if (run.operationId === 'run_copilot_queue') {
    const progress = getCopilotQueueRunProgress(run.runId);
    if (progress) return { ...run, progress };
    return {
      ...run,
      progress: {
        currentStep: null,
        totalSteps: null,
        currentTask: null,
        message: run.state === 'waiting' ? '等待开始下一项' : '等待作业队列状态'
      }
    };
  }
  const updateLabel = UPDATE_PROGRESS_LABELS[run.operationId];
  if (updateLabel) {
    return {
      ...run,
      progress: {
        currentStep: null,
        totalSteps: null,
        currentTask: task.taskName || updateLabel,
        message: run.state === 'accepted'
          ? '等待执行权'
          : task.stopRequested
            ? '正在终止更新'
            : task.isRunning ? `${updateLabel}进行中` : '更新执行中'
      }
    };
  }
  if (run.operationId === 'run_task') {
    const roguelike = getRoguelikeProgress(run.runId);
    if (roguelike) {
      const stopIntent = run.state === 'running' ? getRoguelikeStopIntent(run.runId) : null;
      return {
        ...run,
        progress: {
          currentStep: null,
          totalSteps: null,
          currentTask: roguelike.currentAction,
          message: stopIntent
            ? '等待战斗结束后终止'
            : roguelike.command === 'reclamation' ? '生息演算执行中' : '集成战略执行中',
          roguelike,
          ...(stopIntent ? { stopIntent } : {})
        }
      };
    }
  }
  const stopIntent = run.state === 'running' ? getRoguelikeStopIntent(run.runId) : null;
  return {
    ...run,
    progress: {
      currentStep: null,
      totalSteps: null,
      currentTask: task.taskName,
      message: stopIntent
        ? '等待战斗结束后终止'
        : task.stopRequested ? '正在终止任务' : task.isRunning ? '任务执行中' : '等待任务启动',
      ...(stopIntent ? { stopIntent } : {})
    }
  };
}

function describeOccupancy({ activeRuns, task, schedule, lease }: OccupancyInput): RunOccupancyProjection {
  const current = activeRuns[0] || null;
  const owningRun = activeRuns.find(run => isDeviceOwningAgentRunStatus(run.state)) || null;

  const sources: DeviceOccupancySource[] = [];
  if (activeRuns.length) sources.push('run');
  if (task.isRunning) sources.push('task');
  if (schedule.isRunning) sources.push('schedule');
  if (lease.state === 'held') sources.push('lease');

  const deviceBusy = Boolean(task.isRunning || schedule.isRunning || lease.state === 'held');
  let state: DeviceOccupancyState = 'idle';
  if (owningRun) state = 'run';
  else if (deviceBusy) state = 'external';
  else if (lease.state === 'unknown') state = 'unknown';
  else if (activeRuns.length) state = 'pending';

  return {
    state,
    runId: current?.runId || null,
    runState: current?.state || null,
    sources,
    lease,
    task: {
      isRunning: Boolean(task.isRunning),
      taskName: task.taskName ?? null,
      taskType: task.taskType ?? null,
      stopRequested: Boolean(task.stopRequested)
    },
    schedule: {
      isRunning: Boolean(schedule.isRunning),
      scheduleId: schedule.scheduleId ?? null,
      runId: schedule.runId ?? null,
      currentStep: schedule.currentStep ?? null,
      totalSteps: schedule.totalSteps ?? 0,
      currentTask: schedule.currentTask ?? null,
      shouldStop: Boolean(schedule.shouldStop)
    }
  };
}

/**
 * One observable snapshot for every client: the current active run, all other
 * active intents, the latest terminal run and the device occupancy projection.
 * Legacy task fields stay at the top level for old clients.
 */
export async function buildAgentRunSnapshot({ lines = 80 }: AgentRunSnapshotOptions = {}): Promise<AgentRunSnapshot> {
  const task = getTaskStatus();
  const schedule = getScheduleExecutionStatus();
  const activeRuns = getActiveAgentRuns();
  const currentRunId = activeRuns[0]?.runId || null;
  // Global process/schedule projections only describe the current run; a
  // copilot session is owned by its own runId and stays observable even when
  // another run is current.
  const enrichedRuns: AgentRunSnapshotEntry[] = activeRuns.map(run =>
    run.runId === currentRunId
      || run.operationId === 'run_copilot_set'
      || run.operationId === 'run_copilot_queue'
      ? enrichAgentRun(run)
      : asSnapshotEntry(run)
  );
  const lease = await getMaaExecutionLeaseSnapshot();

  return {
    ...task,
    schedule,
    recentLogs: getRealtimeLogs(normalizeLineCount(lines)),
    run: enrichedRuns[0] || null,
    activeRuns: enrichedRuns,
    lastRun: getLatestTerminalAgentRun(),
    occupancy: describeOccupancy({ activeRuns, task, schedule, lease })
  };
}
