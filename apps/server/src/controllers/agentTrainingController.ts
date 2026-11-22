import operatorTrainingService from '../services/operatorTrainingService.ts';
import type { TrainingOperatorList, TrainingQueueSnapshot } from '../services/operatorTrainingService.ts';
import type { TrainingSettings } from '../services/operatorTrainingModel.ts';
import type { ApplyPlanResult, QueueMutationResult } from '../services/operatorTrainingApplication.ts';
import type { TrainingPlan } from '../services/operatorTrainingPlan.ts';
import { isRecord } from '../services/operatorTrainingModel.ts';
import { sendDryRun, sendSuccess } from '../utils/apiHelper.ts';
import type { ApiResponseWriter } from '../utils/apiHelper.ts';
import {
  parseApplyPlanBody,
  parseCandidateFilters,
  parsePlanModeBody,
  parseQueueAddBody,
  parseQueueOrderBody,
  parseSettingsBody
} from './trainingDto.ts';
import type {
  TrainingOperatorListPayload,
  TrainingQueueRemoveRequest,
  TrainingRequest
} from './trainingDto.ts';
import { resolveRequestConnection } from './requestConnection.ts';

export async function listCandidates(req: TrainingRequest, res: ApiResponseWriter): Promise<void> {
  const list: TrainingOperatorList = await operatorTrainingService.getOperatorList(parseCandidateFilters(req.query));
  const payload: TrainingOperatorListPayload = {
    operators: list.operators,
    count: list.operators.length,
    recognition: list.recognition
  };
  return sendSuccess(res, req, payload);
}

export async function readQueue(req: TrainingRequest, res: ApiResponseWriter): Promise<void> {
  const payload: TrainingQueueSnapshot = await operatorTrainingService.getTrainingQueue();
  return sendSuccess(res, req, payload);
}

export async function addQueueItem(req: TrainingRequest, res: ApiResponseWriter): Promise<void> {
  const { operatorId, options } = parseQueueAddBody(req.body);
  return sendSuccess(res, req, await operatorTrainingService.addToQueue(operatorId, options), '已添加到养成队列');
}

export async function removeQueueItem(req: TrainingQueueRemoveRequest, res: ApiResponseWriter): Promise<void> {
  const payload: QueueMutationResult = await operatorTrainingService.removeFromQueue(req.params.operatorId);
  return sendSuccess(res, req, payload, '已从养成队列中移除');
}

export async function updateQueueOrder(req: TrainingRequest, res: ApiResponseWriter): Promise<void> {
  const payload: QueueMutationResult = await operatorTrainingService.updateQueueOrder(parseQueueOrderBody(req.body));
  return sendSuccess(res, req, payload, '队列顺序已更新');
}

/**
 * `/training/sync` 的任务流程同步：部分成功不改写为整体失败，流程或定时
 * 同步失败时响应消息仍按失败提示，载荷保留服务的诊断字段。
 */
export async function syncFlow(req: TrainingRequest, res: ApiResponseWriter): Promise<void> {
  const result = await operatorTrainingService.syncTrainingFlow();
  return sendSuccess(res, req, result, result.flowSync.status === 'failed' ? '任务流程同步失败，可重试' : '任务流程同步状态已更新');
}

export async function updateSettings(req: TrainingRequest, res: ApiResponseWriter): Promise<void> {
  const payload: TrainingSettings = await operatorTrainingService.updateSettings(parseSettingsBody(req.body));
  return sendSuccess(res, req, payload, '设置已更新');
}

export async function generatePlan(req: TrainingRequest, res: ApiResponseWriter): Promise<void> {
  // 模式先校验：非法请求不解析连接；关卡开放按连接 profile 的客户端游戏日判定。
  const mode = parsePlanModeBody(req.body);
  const { clientType } = await resolveRequestConnection(req, { allowOverrides: true });
  const payload: TrainingPlan = await operatorTrainingService.generateTrainingPlan(mode, { clientType });
  return sendSuccess(res, req, payload);
}

/** `/actions/apply-training-plan` 的计划应用：队列变化或计划上下文过期由领域返回 409。 */
export async function applyPlan(req: TrainingRequest, res: ApiResponseWriter): Promise<void> {
  const { plan, settings } = parseApplyPlanBody(req.body);
  const now = new Date();
  const { clientType } = await resolveRequestConnection(req, { allowOverrides: true });
  const payload: ApplyPlanResult = await operatorTrainingService.applyPlanToTasks(plan, settings, {
    clientType,
    now
  });
  return sendSuccess(res, req, payload, '养成计划已应用到任务流程');
}

export interface TrainingMaterialFetchPlan {
  action: string;
  sideEffects: string[];
}

/**
 * `/actions/fetch-training-materials` 的养成材料数据拉取：只执行数据拉取
 * 脚本，不占设备执行租约；dryRun 只返回计划并经 sendDryRun 发送。
 */
export async function fetchMaterials(req: TrainingRequest, res: ApiResponseWriter): Promise<void> {
  const plan: TrainingMaterialFetchPlan = { action: 'fetch-training-materials', sideEffects: ['refresh_training_material_cache'] };
  // 旧实现的 `req.body?.dryRun` 对非对象请求体同样不触发 dryRun。
  if (isRecord(req.body) && req.body.dryRun) {
    return sendDryRun(res, req, plan);
  }
  return sendSuccess(res, req, await operatorTrainingService.fetchOperatorMaterials(), '养成材料数据已更新');
}
