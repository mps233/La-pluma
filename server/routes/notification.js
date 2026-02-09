import express from 'express';
import {
  setNotificationConfig,
  getNotificationConfig,
  sendNotification,
  sendToChannel,
  testNotificationChannel,
} from '../services/notificationService.js';
import { initTelegramBot, stopTelegramBot } from '../services/telegramBotService.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { asyncHandler, successResponse, errorResponse } from '../utils/apiHelper.js';
import { createLogger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();
const logger = createLogger('NotificationRoutes');

// 配置文件路径
const CONFIG_DIR = join(__dirname, '../data/user-configs');
const NOTIFICATION_CONFIG_FILE = join(CONFIG_DIR, 'notification.json');

// 加载配置
async function loadConfig() {
  try {
    const data = await readFile(NOTIFICATION_CONFIG_FILE, 'utf-8');
    const config = JSON.parse(data);
    setNotificationConfig(config);
    return config;
  } catch (error) {
    logger.debug('通知配置文件不存在，使用默认配置');
    return null;
  }
}

// 保存配置
async function saveConfig(config) {
  try {
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(NOTIFICATION_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    throw new Error(`保存配置失败: ${error.message}`);
  }
}

// 导出加载配置函数供服务器启动时调用
export { loadConfig };

// 获取通知配置
router.get('/config', asyncHandler(async (req, res) => {
  const config = getNotificationConfig();
  res.json(successResponse(config));
}));

// 更新通知配置
router.post('/config', asyncHandler(async (req, res) => {
  const config = req.body;
  setNotificationConfig(config);
  await saveConfig(config);
  
  // 重启 Telegram Bot
  if (config.channels?.telegram) {
    logger.info('重启 Telegram Bot');
    stopTelegramBot();
    
    setTimeout(() => {
      initTelegramBot({
        enabled: config.channels.telegram.enabled,
        botToken: config.channels.telegram.botToken,
        chatId: config.channels.telegram.chatId
      });
    }, 1000);
  }
  
  res.json(successResponse(null, '配置已保存，Telegram Bot 已重启'));
}));

// 测试通知渠道
router.post('/test/:channel', asyncHandler(async (req, res) => {
  const { channel } = req.params;
  logger.info('测试通知渠道', { channel });
  
  const result = await testNotificationChannel(channel);
  logger.info('测试结果', { channel, success: result.success });
  
  res.json({ success: result.success, message: result.message });
}));

// 发送测试通知
router.post('/send-test', asyncHandler(async (req, res) => {
  const { title, content, level = 'info' } = req.body;
  const result = await sendNotification({
    title: title || '测试通知',
    content: content || '这是一条测试通知',
    level,
  });
  res.json(result);
}));

// 发送通知到指定渠道
router.post('/send/:channel', asyncHandler(async (req, res) => {
  const { channel } = req.params;
  const { title, content, level = 'info', data } = req.body;
  const result = await sendToChannel(channel, {
    title,
    content,
    level,
    data,
  });
  res.json(successResponse(result));
}));

export default router;
