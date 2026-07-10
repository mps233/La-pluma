/**
 * 通知服务 - 支持多种通知渠道
 * 当前支持：Telegram
 * 未来可扩展：微信、钉钉、邮件、Bark 等
 */

import fetch from 'node-fetch';
import { createLogger } from '../utils/logger.js';

// 创建日志记录器
const logger = createLogger('Notification');

// 日常关卡开放时间表。days: 0=周日, 1=周一, ..., 6=周六
const RESOURCE_STAGES = {
  'CE-6': { name: '龙门币', days: [0, 2, 4, 6] }, // 周日、周二、周四、周六
  'AP-5': { name: '采购凭证', days: [0, 1, 3, 5] }, // 周日、周一、周三、周五
  'CA-5': { name: '技巧概要', days: [0, 2, 4, 6] }, // 周日、周二、周四、周六
  'LS-6': { name: '作战记录', days: [0, 1, 2, 3, 4, 5, 6] }, // 每天

  'PR-A': { name: '重装/医疗芯片', days: [0, 1, 4, 5] }, // 周日、周一、周四、周五
  'PR-A-1': { name: '重装/医疗芯片', days: [0, 1, 4, 5], hidden: true },
  'PR-A-2': { name: '重装/医疗芯片组', days: [0, 1, 4, 5], hidden: true },
  'PR-B': { name: '狙击/术师芯片', days: [1, 2, 5, 6] }, // 周一、周二、周五、周六
  'PR-B-1': { name: '狙击/术师芯片', days: [1, 2, 5, 6], hidden: true },
  'PR-B-2': { name: '狙击/术师芯片组', days: [1, 2, 5, 6], hidden: true },
  'PR-C': { name: '先锋/辅助芯片', days: [0, 3, 4, 6] }, // 周日、周三、周四、周六
  'PR-C-1': { name: '先锋/辅助芯片', days: [0, 3, 4, 6], hidden: true },
  'PR-C-2': { name: '先锋/辅助芯片组', days: [0, 3, 4, 6], hidden: true },
  'PR-D': { name: '近卫/特种芯片', days: [0, 2, 3, 6] }, // 周日、周二、周三、周六
  'PR-D-1': { name: '近卫/特种芯片', days: [0, 2, 3, 6], hidden: true },
  'PR-D-2': { name: '近卫/特种芯片组', days: [0, 2, 3, 6], hidden: true },

  'SK-5': { name: '碳', days: [0, 1, 3, 5] },     // 周日、周一、周三、周五
};

export function getTodayOpenStages() {
  const today = new Date().getDay();
  const open = [];
  const closed = [];

  Object.entries(RESOURCE_STAGES).forEach(([stage, info]) => {
    if (info.hidden) return;

    const item = {
      stage,
      name: info.name,
      isOpen: info.days.includes(today)
    };

    if (item.isOpen) {
      open.push(item);
    } else {
      closed.push(item);
    }
  });

  return {
    weekday: today,
    open,
    closed
  };
}

/**
 * 检查关卡是否在今天开放
 */
export function isStageOpenToday(stage) {
  const stageKey = stage.toUpperCase();
  if (!RESOURCE_STAGES[stageKey]) {
    return { isOpen: true, reason: null }; // 非资源本，默认开放
  }
  
  const today = new Date().getDay(); // 0=周日, 1=周一, ..., 6=周六
  const stageInfo = RESOURCE_STAGES[stageKey];
  const isOpen = stageInfo.days.includes(today);
  
  return {
    isOpen,
    reason: isOpen ? null : `${stageInfo.name}今日未开放`,
    stageName: stageInfo.name
  };
}

// 通知配置存储
let notificationConfig = {
  enabled: false,
  channels: {
    telegram: {
      enabled: false,
      botToken: '',
      chatId: '',
    },
    // 预留其他通知渠道
    wechat: {
      enabled: false,
      // 微信企业号配置
    },
    dingtalk: {
      enabled: false,
      // 钉钉机器人配置
    },
    email: {
      enabled: false,
      // 邮件配置
    },
    bark: {
      enabled: false,
      // Bark 配置
    }
  }
};

/**
 * 通知接口 - 所有通知渠道都需要实现这个接口
 */
class NotificationChannel {
  constructor(config) {
    this.config = config;
  }

  /**
   * 发送通知
   * @param {Object} message - 消息对象
   * @param {string} message.title - 标题
   * @param {string} message.content - 内容
   * @param {string} message.level - 级别 (info/success/warning/error)
   * @param {Object} message.data - 额外数据
   */
  async send(message) {
    throw new Error('子类必须实现 send 方法');
  }

  /**
   * 测试连接
   */
  async test() {
    throw new Error('子类必须实现 test 方法');
  }

  canSendImage() {
    return false;
  }
}

/**
 * Telegram 通知渠道
 */
class TelegramChannel extends NotificationChannel {
  canSendImage() {
    return Boolean(this.config.botToken && this.config.chatId);
  }

  async send(message) {
    if (!this.config.botToken || !this.config.chatId) {
      throw new Error('Telegram 配置不完整');
    }

    const { title, content, level = 'info', data, image } = message;
    
    // 如果有图片，使用 sendPhoto API
    if (image) {
      return await this.sendPhoto(title, content, level, data, image);
    }
    
    // 根据级别选择 emoji
    const levelEmojis = {
      info: 'ℹ️',
      success: '✅',
      warning: '⚠️',
      error: '❌'
    };
    
    const emoji = levelEmojis[level] || 'ℹ️';
    
    // 构建消息文本
    let text = `${emoji} *${title}*\n\n${content}`;
    
    // 如果有额外数据，添加到消息中
    if (data) {
      text += '\n\n📊 *详细信息*';
      Object.entries(data).forEach(([key, value]) => {
        text += `\n• ${key}: ${value}`;
      });
    }
    
    // 添加时间戳
    text += `\n\n🕐 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
    
    const url = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: this.config.chatId,
        text: text,
        parse_mode: 'Markdown',
      }),
    });
    
    const result = await response.json();
    
    if (!result.ok) {
      throw new Error(`Telegram 发送失败: ${result.description || '未知错误'}`);
    }
    
    return result;
  }

  async sendPhoto(title, content, level, data, imageBase64) {
    const levelEmojis = {
      info: 'ℹ️',
      success: '✅',
      warning: '⚠️',
      error: '❌'
    };
    
    const emoji = levelEmojis[level] || 'ℹ️';
    
    // 构建图片说明文本
    let caption = `${emoji} *${title}*\n\n${content}`;
    
    // 如果有额外数据，添加到消息中
    if (data) {
      caption += '\n\n📊 *详细信息*';
      Object.entries(data).forEach(([key, value]) => {
        caption += `\n• ${key}: ${value}`;
      });
    }
    
    caption += `\n\n🕐 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
    
    const url = `https://api.telegram.org/bot${this.config.botToken}/sendPhoto`;
    
    // 将 base64 转换为 Buffer
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    
    // 检查图片大小（Telegram 限制 10MB）
    const imageSizeMB = imageBuffer.length / 1024 / 1024;
    logger.debug('图片大小检查', { sizeMB: imageSizeMB.toFixed(2) });
    
    if (imageSizeMB > 10) {
      logger.warn('图片超过 10MB，尝试不发送图片', { sizeMB: imageSizeMB.toFixed(2) });
      // 图片太大，改为发送纯文本消息
      return await this.send({ title, content, level, data });
    }
    
    // 使用 FormData 发送图片
    const FormData = (await import('form-data')).default;
    const formData = new FormData();
    
    // 增加事件监听器限制，避免内存泄漏警告
    formData.setMaxListeners(20);
    
    formData.append('chat_id', this.config.chatId);
    formData.append('photo', imageBuffer, { filename: 'screenshot.png' });
    formData.append('caption', caption);
    formData.append('parse_mode', 'Markdown');
    
    // 添加重试机制
    const maxRetries = 3;
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.debug('发送 Telegram 图片', { attempt, maxRetries });
        
        const response = await fetch(url, {
          method: 'POST',
          body: formData,
          headers: formData.getHeaders(),
          timeout: 30000, // 30秒超时
        });
        
        const result = await response.json();
        
        if (!result.ok) {
          throw new Error(`Telegram 发送图片失败: ${result.description || '未知错误'}`);
        }
        
        logger.success('Telegram 图片发送成功');
        return result;
      } catch (error) {
        lastError = error;
        logger.error('发送 Telegram 图片失败', { 
          attempt, 
          maxRetries, 
          error: error.message 
        });
        
        if (attempt < maxRetries) {
          // 等待后重试
          const waitTime = attempt * 2000; // 2秒、4秒
          logger.debug('等待后重试', { waitMs: waitTime });
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
    
    // 所有重试都失败，尝试发送不带图片的消息
    logger.warn('发送图片失败，改为发送纯文本消息');
    try {
      return await this.send({ title, content, level, data });
    } catch (textError) {
      throw new Error(`发送图片和文本消息都失败: ${lastError.message}`);
    }
  }

  async test() {
    try {
      await this.send({
        title: '测试通知',
        content: 'La Pluma 通知系统测试成功！',
        level: 'info',
      });
      return { success: true, message: '测试消息已发送' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
}

/**
 * 通知管理器
 */
class NotificationManager {
  constructor() {
    this.channels = new Map();
    this.initChannels();
  }

  initChannels() {
    // 注册 Telegram 渠道
    this.registerChannel('telegram', TelegramChannel);
    
    // 未来可以在这里注册更多渠道
    // this.registerChannel('wechat', WeChatChannel);
    // this.registerChannel('dingtalk', DingTalkChannel);
    // this.registerChannel('email', EmailChannel);
    // this.registerChannel('bark', BarkChannel);
  }

  registerChannel(name, ChannelClass) {
    this.channels.set(name, ChannelClass);
  }

  hasReadyImageChannel() {
    if (!notificationConfig.enabled) return false;

    for (const [channelName, ChannelClass] of this.channels.entries()) {
      const channelConfig = notificationConfig.channels[channelName];
      if (!channelConfig?.enabled) continue;
      if (new ChannelClass(channelConfig).canSendImage()) return true;
    }
    return false;
  }

  /**
   * 发送通知到所有启用的渠道
   */
  async sendToAll(message) {
    if (!notificationConfig.enabled) {
      logger.info('通知功能未启用');
      return { success: true, message: '通知功能未启用' };
    }

    const results = [];
    const errors = [];

    for (const [channelName, ChannelClass] of this.channels.entries()) {
      const channelConfig = notificationConfig.channels[channelName];
      
      if (!channelConfig || !channelConfig.enabled) {
        continue;
      }

      try {
        const channel = new ChannelClass(channelConfig);
        await channel.send(message);
        results.push({ channel: channelName, success: true });
        logger.success('通知已发送', { channel: channelName });
      } catch (error) {
        errors.push({ channel: channelName, error: error.message });
        logger.error('发送通知失败', { 
          channel: channelName, 
          error: error.message 
        });
      }
    }

    return {
      success: errors.length === 0,
      results,
      errors,
      message: errors.length === 0 
        ? `通知已发送到 ${results.length} 个渠道` 
        : `部分渠道发送失败: ${errors.map(e => e.channel).join(', ')}`
    };
  }

  /**
   * 发送到指定渠道
   */
  async sendToChannel(channelName, message) {
    const ChannelClass = this.channels.get(channelName);
    
    if (!ChannelClass) {
      throw new Error(`未知的通知渠道: ${channelName}`);
    }

    const channelConfig = notificationConfig.channels[channelName];
    
    if (!channelConfig || !channelConfig.enabled) {
      throw new Error(`通知渠道 ${channelName} 未启用`);
    }

    const channel = new ChannelClass(channelConfig);
    return await channel.send(message);
  }

  /**
   * 测试指定渠道
   */
  async testChannel(channelName, configOverride = null) {
    const ChannelClass = this.channels.get(channelName);
    
    if (!ChannelClass) {
      throw new Error(`未知的通知渠道: ${channelName}`);
    }

    const channelConfig = configOverride || notificationConfig.channels[channelName];
    
    if (!channelConfig) {
      throw new Error(`通知渠道 ${channelName} 未配置`);
    }

    const channel = new ChannelClass(channelConfig);
    return await channel.test();
  }
}

// 创建全局通知管理器实例
const notificationManager = new NotificationManager();

/**
 * 设置通知配置
 */
export function setNotificationConfig(config) {
  notificationConfig = { ...notificationConfig, ...config };
  logger.info('通知配置已更新');
}

/**
 * 获取通知配置
 */
export function getNotificationConfig() {
  // 返回完整配置（不隐藏敏感信息）
  // 前端需要完整的 token 才能正确保存
  return JSON.parse(JSON.stringify(notificationConfig));
}

export function shouldCaptureNotificationScreenshot() {
  return notificationManager.hasReadyImageChannel();
}

/**
 * 发送通知
 */
export async function sendNotification(message) {
  return await notificationManager.sendToAll(message);
}

/**
 * 发送到指定渠道
 */
export async function sendToChannel(channelName, message) {
  return await notificationManager.sendToChannel(channelName, message);
}

/**
 * 测试通知渠道
 */
export async function testNotificationChannel(channelName, configOverride = null) {
  return await notificationManager.testChannel(channelName, configOverride);
}

/**
 * 发送任务完成通知
 */
export function buildTaskCompletionMessage(taskInfo = {}) {
  const { 
    taskName = '自动化任务', 
    totalTasks = 0, 
    successTasks = 0, 
    failedTasks = 0,
    skippedTasks = 0,
    duration = 0,
    errors = [],
    skipped = [],
    summaries = [],
    actions = [],
    reports = [],
    warnings = [],
    screenshot = null
  } = taskInfo;

  const normalizedActions = Array.isArray(actions) ? actions : [];
  const normalizedReports = Array.isArray(reports) ? reports : [];
  const normalizedWarnings = Array.isArray(warnings) ? warnings : [];
  const normalizedSkipped = Array.isArray(skipped) ? skipped : [];
  const normalizedErrors = Array.isArray(errors) ? errors : [];
  const normalizedSummaries = Array.isArray(summaries) ? summaries : [];
  const hasStructuredFailure = normalizedActions.some(action => action?.status === 'failed')
    || normalizedReports.some(report => report?.status === 'failed');
  const hasStructuredSkip = normalizedActions.some(action => action?.status === 'skipped');
  const hasFailure = failedTasks > 0 || hasStructuredFailure;
  const hasSkip = skippedTasks > 0 || hasStructuredSkip;

  // 根据任务结果确定通知级别和标题
  let level = 'success';
  let title = '任务完成';
  
  if (hasFailure && hasSkip) {
    level = 'warning';
    title = '任务完成（部分失败/跳过）';
  } else if (hasFailure) {
    level = 'warning';
    title = '任务完成（部分失败）';
  } else if (hasSkip) {
    level = 'info';
    title = '任务完成（部分跳过）';
  }
  
  let content = `*${taskName}* 执行完成`;

  if (normalizedActions.length > 0) {
    const statusIcons = { success: '✅', skipped: '⏭️', failed: '❌' };
    content += '\n\n🔎 *执行结果*';
    normalizedActions.forEach(action => {
      const icon = statusIcons[action?.status] || '•';
      const taskLabel = action?.task ? `${action.task}: ` : '';
      content += `\n${icon} ${taskLabel}${action?.message || '状态未知'}`;
    });
  }

  if (normalizedReports.length > 0) {
    const providerLabels = { penguin: '企鹅物流', yituliu: '一图流' };
    content += '\n\n📡 *掉落汇报*';
    normalizedReports.forEach(report => {
      const icon = report?.status === 'success' ? '✅' : '❌';
      const provider = providerLabels[report?.provider] || report?.provider || '未知平台';
      content += `\n${icon} ${provider}: ${report?.message || '状态未知'}`;
    });
  }

  if (normalizedWarnings.length > 0) {
    content += '\n\n⚠️ *执行提示*';
    normalizedWarnings.forEach(warning => {
      content += `\n• ${warning}`;
    });
  }
  
  // 添加任务总结信息
  if (normalizedSummaries.length > 0) {
    content += '\n\n📋 *任务总结*';
    normalizedSummaries.forEach(summary => {
      content += `\n\n*${summary.task}*`;
      
      // 理智作战总结
      if (summary.stage) {
        content += `\n• 关卡: ${summary.stage}`;
        if (summary.times) content += `\n• 次数: ${summary.times}`;
        if (summary.duration) content += `\n• 耗时: ${summary.duration}`;
        if (summary.medicine && summary.medicine !== '0') content += `\n• 理智药: ${summary.medicine}`;
        if (summary.stone && summary.stone !== '0') content += `\n• 源石: ${summary.stone}`;
        
        // 掉落信息（已经是格式化的字符串）
        if (summary.drops) {
          content += `\n• 掉落: ${summary.drops}`;
        }
      }
      
      // 公招总结
      if (summary.recruits) {
        content += '\n• 公招结果:';
        summary.recruits.forEach(recruit => {
          content += `\n  - [${recruit.tags}] → ${recruit.stars}⭐`;
        });
      }
      
      // 基建总结
      if (summary.infrast) {
        content += `\n• ${summary.infrast}`;
      }
    });
  }
  
  // 跳过的任务（资源本未开放等）
  const representedTasks = new Set(normalizedActions.map(action => action?.task).filter(Boolean));
  const remainingSkipped = normalizedSkipped.filter(item => {
    const task = typeof item === 'string' ? item : item?.task;
    return !task || !representedTasks.has(task);
  });
  if (remainingSkipped.length > 0) {
    content += `\n\n⏭️ *跳过任务*`;
    remainingSkipped.forEach(s => {
      if (typeof s === 'string') content += `\n• ${s}`;
      else content += `\n• ${s.task}${s.reason ? ` - ${s.reason}` : ''}`;
    });
  }
  
  // 失败的任务
  const remainingErrors = normalizedErrors.filter(item => {
    const task = typeof item === 'string' ? item : item?.task;
    return !task || !representedTasks.has(task);
  });
  if (remainingErrors.length > 0) {
    content += `\n\n❌ *失败任务*`;
    remainingErrors.forEach(e => {
      // 处理对象格式 { task: '任务名', error: '错误信息' } 或字符串格式
      if (typeof e === 'object' && e.task) {
        content += `\n• ${e.task}${e.error ? ` - ${e.error}` : ''}`;
      } else {
        content += `\n• ${e}`;
      }
    });
  }
  
  const data = {
    '总任务数': totalTasks,
    '成功': successTasks,
    ...(skippedTasks > 0 && { '跳过': skippedTasks }),
    ...(failedTasks > 0 && { '失败': failedTasks }),
    ...(normalizedReports.some(report => report?.status === 'failed') && {
      '汇报失败': normalizedReports.filter(report => report?.status === 'failed').length
    }),
    '耗时': `${Math.floor(duration / 1000)} 秒`,
  };

  return {
    title,
    content,
    level,
    data,
    image: screenshot
  };
}

export async function sendTaskCompletionNotification(taskInfo) {
  return await sendNotification(buildTaskCompletionMessage(taskInfo));
}

export default {
  setNotificationConfig,
  getNotificationConfig,
  shouldCaptureNotificationScreenshot,
  sendNotification,
  sendToChannel,
  testNotificationChannel,
  buildTaskCompletionMessage,
  sendTaskCompletionNotification,
  isStageOpenToday,
};
