/**
 * 森空岛 API 路由
 */

import express from 'express';
import fetch from 'node-fetch';
import sklandService from '../services/sklandService.js';
import { successResponse, errorResponse, asyncHandler } from '../utils/apiHelper.js';

const router = express.Router();

/**
 * POST /api/skland/login
 * 登录森空岛账号
 */
router.post('/login', asyncHandler(async (req, res) => {
  const { phone, code, savePassword } = req.body;
  
  if (!phone || !code) {
    return res.status(400).json(errorResponse(new Error('手机号和验证码/密码不能为空')));
  }

  const result = await sklandService.login(phone, code, savePassword || false);
  
  if (result.success) {
    return res.json(successResponse(null, result.message));
  } else {
    return res.status(400).json(errorResponse(new Error(result.error)));
  }
}));

/**
 * POST /api/skland/send-code
 * 发送验证码
 */
router.post('/send-code', asyncHandler(async (req, res) => {
  const { phone } = req.body;
  
  if (!phone) {
    return res.status(400).json(errorResponse(new Error('手机号不能为空')));
  }

  const result = await sklandService.sendCode(phone);
  
  if (result.success) {
    return res.json(successResponse(null, result.message));
  } else {
    return res.status(400).json(errorResponse(new Error(result.error)));
  }
}));

/**
 * POST /api/skland/logout
 * 登出森空岛账号
 */
router.post('/logout', asyncHandler(async (req, res) => {
  const result = await sklandService.logout();
  
  if (result.success) {
    return res.json(successResponse(null, '登出成功'));
  } else {
    return res.status(400).json(errorResponse(new Error(result.error)));
  }
}));

/**
 * GET /api/skland/status
 * 获取登录状态
 */
router.get('/status', asyncHandler(async (req, res) => {
  const isLoggedIn = await sklandService.isLoggedIn();
  const config = await sklandService.getConfig();
  
  return res.json(successResponse({
    isLoggedIn,
    phone: config?.phone || null,
    loginTime: config?.loginTime || null
  }));
}));

/**
 * GET /api/skland/player-data
 * 获取玩家完整数据（Dashboard 摘要）
 */
router.get('/player-data', asyncHandler(async (req, res) => {
  const useCache = req.query.cache !== 'false';
  
  // 使用 getDashboardSummary 返回格式化的摘要数据
  const result = await sklandService.getDashboardSummary(useCache);
  
  if (result.success) {
    return res.json(successResponse(result.data, result.cached ? '使用缓存数据' : '获取成功'));
  } else {
    // 如果是未登录，返回 401 而不是 400
    const statusCode = result.error === '未登录' ? 401 : 400;
    return res.status(statusCode).json(errorResponse(new Error(result.error)));
  }
}));

/**
 * GET /api/skland/refresh
 * 刷新玩家数据
 */
router.post('/refresh', asyncHandler(async (req, res) => {
  const result = await sklandService.getPlayerData(false);
  
  if (result.success) {
    return res.json(successResponse(result.data, '刷新成功'));
  } else {
    return res.status(400).json(errorResponse(new Error(result.error)));
  }
}));

/**
 * GET /api/skland/avatar-proxy
 * 代理头像图片（解决 CDN 防盗链问题）
 */
router.get('/avatar-proxy', asyncHandler(async (req, res) => {
  const { url } = req.query;
  
  if (!url || typeof url !== 'string') {
    return res.status(400).json(errorResponse(new Error('缺少图片 URL')));
  }
  
  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      return res.status(response.status).json(errorResponse(new Error(`图片加载失败: ${response.statusText}`)));
    }
    
    // 转发图片
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    res.set('Content-Type', response.headers.get('content-type') || 'image/png');
    res.set('Cache-Control', 'public, max-age=86400'); // 缓存 24 小时
    res.send(buffer);
  } catch (error) {
    return res.status(500).json(errorResponse(error));
  }
}));

export default router;
