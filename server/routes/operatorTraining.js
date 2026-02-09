/**
 * 干员养成 API 路由
 */

import express from 'express';
import operatorTrainingService from '../services/operatorTrainingService.js';
import { asyncHandler, successResponse, errorResponse } from '../utils/apiHelper.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const logger = createLogger('OperatorTrainingRoutes');

/**
 * GET /api/operator-training/operators
 * 获取干员列表
 */
router.get('/operators', asyncHandler(async (req, res) => {
  const filters = {
    rarity: req.query.rarity ? parseInt(req.query.rarity) : undefined,
    profession: req.query.profession,
    owned: req.query.owned === 'true' ? true : req.query.owned === 'false' ? false : undefined,
    needsElite2: req.query.needsElite2 === 'true'
  };
  
  const operators = await operatorTrainingService.getOperatorList(filters);
  
  res.json(successResponse({
    operators,
    count: operators.length
  }));
}));

/**
 * GET /api/operator-training/queue
 * 获取养成队列
 */
router.get('/queue', asyncHandler(async (req, res) => {
  const queueData = await operatorTrainingService.getTrainingQueue();
  res.json(successResponse(queueData));
}));

/**
 * POST /api/operator-training/queue
 * 添加干员到养成队列
 */
router.post('/queue', asyncHandler(async (req, res) => {
  const { operatorId, currentElite, targetElite } = req.body;
  
  if (!operatorId) {
    return res.status(400).json(errorResponse(new Error('缺少 operatorId 参数')));
  }
  
  const queueItem = await operatorTrainingService.addToQueue(operatorId, {
    currentElite,
    targetElite
  });
  
  res.json(successResponse(queueItem, '已添加到养成队列'));
}));

/**
 * DELETE /api/operator-training/queue/:operatorId
 * 从养成队列中移除干员
 */
router.delete('/queue/:operatorId', asyncHandler(async (req, res) => {
  const { operatorId } = req.params;
  await operatorTrainingService.removeFromQueue(operatorId);
  res.json(successResponse(null, '已从养成队列中移除'));
}));

/**
 * PUT /api/operator-training/queue/order
 * 更新队列顺序
 */
router.put('/queue/order', asyncHandler(async (req, res) => {
  const { operatorIds } = req.body;
  
  if (!Array.isArray(operatorIds)) {
    return res.status(400).json(errorResponse(new Error('operatorIds 必须是数组')));
  }
  
  await operatorTrainingService.updateQueueOrder(operatorIds);
  res.json(successResponse(null, '队列顺序已更新'));
}));

/**
 * PUT /api/operator-training/settings
 * 更新养成设置
 */
router.put('/settings', asyncHandler(async (req, res) => {
  const settings = await operatorTrainingService.updateSettings(req.body);
  res.json(successResponse(settings, '设置已更新'));
}));

/**
 * POST /api/operator-training/plan
 * 生成养成计划
 */
router.post('/plan', asyncHandler(async (req, res) => {
  const { mode = 'current' } = req.body;
  const plan = await operatorTrainingService.generateTrainingPlan(mode);
  res.json(successResponse(plan));
}));

/**
 * POST /api/operator-training/apply
 * 应用养成计划到任务流程
 */
router.post('/apply', asyncHandler(async (req, res) => {
  const { plan, settings, taskType = 'combat' } = req.body;
  
  if (!plan) {
    return res.status(400).json(errorResponse(new Error('缺少 plan 参数')));
  }
  
  const result = await operatorTrainingService.applyPlanToTasks(plan, settings, taskType);
  res.json(successResponse(result, '养成计划已应用到任务流程'));
}));

export default router;
