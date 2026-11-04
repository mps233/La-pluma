import { getErrorMessage, isRecord } from '../utils/errors.ts';
import { getGameDay } from './gameCalendar.ts';
/**
 * 通知服务 - 支持多种通知渠道
 * 当前支持：Telegram
 * 未来可扩展：微信、钉钉、邮件、Bark 等
 */

import fetch from 'node-fetch';
import type { RequestInit } from 'node-fetch';
import { createLogger } from '../utils/logger.ts';

// 创建日志记录器
const logger = createLogger('Notification');

type FetchInitWithTimeout = RequestInit & { timeout?: number }

interface TelegramApiResponse {
  ok?: boolean
  description?: string
  [key: string]: unknown
}

interface TaskAction {
  task?: string
  status?: string
  message?: string
  [key: string]: unknown
}

interface TaskReport {
  status?: string
  provider?: string
  message?: string
  [key: string]: unknown
}

interface TaskRecruit {
  tags?: string
  stars?: string | number
}

interface TaskSummary {
  task?: string
  stage?: string
  times?: string | number
  duration?: string | number
  medicine?: string
  stone?: string
  drops?: string
  recruits?: TaskRecruit[]
  infrast?: string
  [key: string]: unknown
}

interface TaskInfo {
  taskName?: string
  totalTasks?: number
  successTasks?: number
  failedTasks?: number
  skippedTasks?: number
  duration?: number
  errors?: unknown[]
  skipped?: unknown[]
  summaries?: TaskSummary[]
  actions?: TaskAction[]
  reports?: TaskReport[]
  warnings?: unknown[]
  screenshot?: string | null
  [key: string]: unknown
}

export interface NotificationMessage {
  title: string
  content: string
  level?: string
  data?: Record<string, unknown> | null
  image?: string
}

interface ChannelConfig {
  enabled?: boolean
  botToken?: string
  chatId?: string
  [key: string]: unknown
}

export interface NotificationConfig {
  enabled: boolean
  channels: Record<string, ChannelConfig>
}

interface ResourceStage {
  name: string
  days: number[]
  hidden?: boolean
}

interface NotificationResult {
  success: boolean
  message: string
  results?: Array<{ channel: string; success: boolean }>
  errors?: Array<{ channel: string; error: string }>
}


const TELEGRAM_LEVEL_EMOJIS: Record<string, string> = {
  info: 'ℹ️',
  success: '✅',
  warning: '⚠️',
  error: '❌'
};

export function formatTelegramMessage(title: string, content: string, level: string = 'info', data?: Record<string, unknown> | null, now: Date = new Date()): string {
  const emoji = TELEGRAM_LEVEL_EMOJIS[level] || TELEGRAM_LEVEL_EMOJIS.info;
  let text = `${emoji} *${title}*\n\n${content}`;

  if (data) {
    text += '\n\n📊 *详细信息*';
    Object.entries(data).forEach(([key, value]) => {
      text += `\n• ${key}: ${String(value)}`;
    });
  }

  return `${text}\n\n🕐 ${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
}

// 日常关卡开放时间表。days: 0=周日, 1=周一, ..., 6=周六
const RESOURCE_STAGES: Record<string, ResourceStage> = {
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

export function getTodayOpenStages(options: { now?: Date; clientType?: string; resourceCollectionOpen?: boolean } = {}) {
  const gameDay = getGameDay(options.now ?? new Date(), options.clientType);
  const today = gameDay.weekday;
  const allResourceStagesOpen = options.resourceCollectionOpen === true;
  const open: Array<{ stage: string; name: string; isOpen: boolean }> = [];
  const closed: Array<{ stage: string; name: string; isOpen: boolean }> = [];

  Object.entries(RESOURCE_STAGES).forEach(([stage, info]) => {
    if (info.hidden) return;

    const item: { stage: string; name: string; isOpen: boolean } = {
      stage,
      name: info.name,
      isOpen: allResourceStagesOpen || info.days.includes(today)
    };

    if (item.isOpen) {
      open.push(item);
    } else {
      closed.push(item);
    }
  });

  return {
    weekday: today,
    date: gameDay.date,
    clientType: options.clientType ?? 'Official',
    open,
    closed
  };
}

/**
 * 检查关卡是否在今天开放
 */
export function isStageOpenToday(
  stage: string,
  options: { now?: Date; clientType?: string; resourceCollectionOpen?: boolean } = {}
): { isOpen: boolean; reason: string | null; stageName?: string } {
  const stageKey = stage.toUpperCase();
  if (!RESOURCE_STAGES[stageKey]) {
    return { isOpen: true, reason: null }; // 非资源本，默认开放
  }

  const today = getGameDay(options.now ?? new Date(), options.clientType).weekday;
  const stageInfo = RESOURCE_STAGES[stageKey];
  const isOpen = options.resourceCollectionOpen === true || stageInfo.days.includes(today);

  return {
    isOpen,
    reason: isOpen ? null : `${stageInfo.name}今日未开放`,
    stageName: stageInfo.name
  };
}

// 通知配置存储
let notificationConfig: NotificationConfig = {
  enabled: false,
  channels: {
    telegram: {
      enabled: false,
      botToken: '',
      chatId: '',
    },
  }
};

/**
 * 通知接口 - 所有通知渠道都需要实现这个接口
 */
class NotificationChannel {
  config: ChannelConfig;

  constructor(config: ChannelConfig) {
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
  async send(message: NotificationMessage): Promise<unknown> {
    throw new Error('子类必须实现 send 方法');
  }

  /**
   * 测试连接
   */
  async test(configOverride: ChannelConfig | null = null): Promise<NotificationResult> {
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

  async send(message: NotificationMessage): Promise<unknown> {
    if (!this.config.botToken || !this.config.chatId) {
      throw new Error('Telegram 配置不完整');
    }

    const { title, content, level = 'info', data, image } = message;

    // 如果有图片，使用 sendPhoto API
    if (image) {
      return await this.sendPhoto(title, content, level, data, image);
    }

    const text = formatTelegramMessage(title, content, level, data);

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

    const result = await response.json() as TelegramApiResponse;

    if (!result.ok) {
      throw new Error(`Telegram 发送失败: ${result.description || '未知错误'}`);
    }

    return result;
  }

  async sendPhoto(title: string, content: string, level: string, data: Record<string, unknown> | null | undefined, imageBase64: string): Promise<unknown> {
    const caption = formatTelegramMessage(title, content, level, data);

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
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.debug('发送 Telegram 图片', { attempt, maxRetries });

        const requestInit: FetchInitWithTimeout = {
          method: 'POST',
          body: formData,
          headers: formData.getHeaders(),
          timeout: 30000, // 30秒超时
        };
        const response = await fetch(url, requestInit);

        const result = await response.json() as TelegramApiResponse;

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
          error: getErrorMessage(error)
        });

        if (attempt < maxRetries) {
          // 等待后重试
          const waitTime = attempt * 2000; // 2秒、4秒
          logger.debug('等待后重试', { waitMs: waitTime });
          await new Promise<void>(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    // 所有重试都失败，尝试发送不带图片的消息
    logger.warn('发送图片失败，改为发送纯文本消息');
    try {
      return await this.send({ title, content, level, data });
    } catch {
      throw new Error(`发送图片和文本消息都失败: ${getErrorMessage(lastError)}`);
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
      return { success: false, message: getErrorMessage(error) };
    }
  }
}

/**
 * 通知管理器
 */
class NotificationManager {
  channels: Map<string, new (config: ChannelConfig) => NotificationChannel>;

  constructor() {
    this.channels = new Map();
    this.initChannels();
  }

  initChannels() {
    // 注册 Telegram 渠道
    this.registerChannel('telegram', TelegramChannel);

  }

  registerChannel(name: string, ChannelClass: new (config: ChannelConfig) => NotificationChannel): void {
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
  async sendToAll(message: NotificationMessage): Promise<NotificationResult> {
    if (!notificationConfig.enabled) {
      logger.info('通知功能未启用');
      return { success: true, message: '通知功能未启用' };
    }

    const results: Array<{ channel: string; success: boolean }> = [];
    const errors: Array<{ channel: string; error: string }> = [];

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
        errors.push({ channel: channelName, error: getErrorMessage(error) });
        logger.error('发送通知失败', {
          channel: channelName,
          error: getErrorMessage(error)
        });
      }
    }

    return {
      success: errors.length === 0,
      results,
      errors,
      message: errors.length === 0
        ? `通知已发送到 ${results.length} 个渠道`
        : `部分渠道发送失败: ${errors.map(error => error.channel).join(', ')}`
    };
  }

  /**
   * 发送到指定渠道
   */
  async sendToChannel(channelName: string, message: NotificationMessage): Promise<NotificationResult> {
    const ChannelClass = this.channels.get(channelName);

    if (!ChannelClass) {
      throw new Error(`未知的通知渠道: ${channelName}`);
    }

    const channelConfig = notificationConfig.channels[channelName];

    if (!channelConfig || !channelConfig.enabled) {
      throw new Error(`通知渠道 ${channelName} 未启用`);
    }

    const channel = new ChannelClass(channelConfig);
    return await channel.send(message) as NotificationResult;
  }

  /**
   * 测试指定渠道
   */
  async testChannel(channelName: string, configOverride: ChannelConfig | null = null): Promise<NotificationResult> {
    const ChannelClass = this.channels.get(channelName);

    if (!ChannelClass) {
      throw new Error(`未知的通知渠道: ${channelName}`);
    }

    const channelConfig = configOverride || notificationConfig.channels[channelName];

    if (!channelConfig) {
      throw new Error(`通知渠道 ${channelName} 未配置`);
    }

    const channel = new ChannelClass(channelConfig);
    return await channel.test() as NotificationResult;
  }
}

// 创建全局通知管理器实例
const notificationManager = new NotificationManager();

/**
 * 设置通知配置
 */
export function setNotificationConfig(config: NotificationConfig): void {
  notificationConfig = { ...notificationConfig, ...config };
  logger.info('通知配置已更新');
}

/**
 * 获取通知配置
 */
export function getNotificationConfig(): NotificationConfig {
  // 返回完整配置（不隐藏敏感信息）
  // 前端需要完整的 token 才能正确保存
  return JSON.parse(JSON.stringify(notificationConfig)) as NotificationConfig;
}

export function shouldCaptureNotificationScreenshot() {
  return notificationManager.hasReadyImageChannel();
}

/**
 * 发送通知
 */
export async function sendNotification(message: NotificationMessage): Promise<NotificationResult> {
  return await notificationManager.sendToAll(message);
}

/**
 * 发送到指定渠道
 */
export async function sendToChannel(channelName: string, message: NotificationMessage): Promise<NotificationResult> {
  return await notificationManager.sendToChannel(channelName, message);
}

/**
 * 测试通知渠道
 */
export async function testNotificationChannel(channelName: string, configOverride: ChannelConfig | null = null): Promise<NotificationResult> {
  return await notificationManager.testChannel(channelName, configOverride);
}

/**
 * 发送任务完成通知
 */
export function buildTaskCompletionMessage(taskInfo: TaskInfo = {}) {
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

  const normalizedActions: TaskAction[] = Array.isArray(actions) ? actions : [];
  const normalizedReports: TaskReport[] = Array.isArray(reports) ? reports : [];
  const normalizedWarnings: unknown[] = Array.isArray(warnings) ? warnings : [];
  const normalizedSkipped: unknown[] = Array.isArray(skipped) ? skipped : [];
  const normalizedErrors: unknown[] = Array.isArray(errors) ? errors : [];
  const normalizedSummaries: TaskSummary[] = Array.isArray(summaries) ? summaries : [];
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
    const statusIcons: Record<string, string> = { success: '✅', skipped: '⏭️', failed: '❌' };
    content += '\n\n🔎 *执行结果*';
    normalizedActions.forEach(action => {
      const icon = statusIcons[action?.status || ''] || '•';
      const taskLabel = action?.task ? `${action.task}: ` : '';
      content += `\n${icon} ${taskLabel}${action?.message || '状态未知'}`;
    });
  }

  if (normalizedReports.length > 0) {
    const providerLabels: Record<string, string> = { penguin: '企鹅物流', yituliu: '一图流' };
    content += '\n\n📡 *掉落汇报*';
    normalizedReports.forEach(report => {
      const icon = report?.status === 'success' ? '✅' : '❌';
      const provider = providerLabels[report?.provider || ''] || report?.provider || '未知平台';
      content += `\n${icon} ${provider}: ${report?.message || '状态未知'}`;
    });
  }

  if (normalizedWarnings.length > 0) {
    content += '\n\n⚠️ *执行提示*';
    normalizedWarnings.forEach(warning => {
      content += `\n• ${String(warning)}`;
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
    const task = typeof item === 'string' ? item : isRecord(item) && typeof item.task === 'string' ? item.task : null;
    return !task || !representedTasks.has(task);
  });
  if (remainingSkipped.length > 0) {
    content += `\n\n⏭️ *跳过任务*`;
    remainingSkipped.forEach(s => {
      if (typeof s === 'string') content += `\n• ${s}`;
      else if (isRecord(s)) content += `\n• ${String(s.task || '')}${s.reason ? ` - ${String(s.reason)}` : ''}`;
    });
  }

  // 失败的任务
  const remainingErrors = normalizedErrors.filter(item => {
    const task = typeof item === 'string' ? item : isRecord(item) && typeof item.task === 'string' ? item.task : null;
    return !task || !representedTasks.has(task);
  });
  if (remainingErrors.length > 0) {
    content += `\n\n❌ *失败任务*`;
    remainingErrors.forEach(e => {
      // 处理对象格式 { task: '任务名', error: '错误信息' } 或字符串格式
      if (isRecord(e) && e.task) {
        content += `\n• ${String(e.task)}${e.error ? ` - ${String(e.error)}` : ''}`;
      } else {
        content += `\n• ${String(e)}`;
      }
    });
  }

  const data: Record<string, string | number> = {
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
    image: screenshot ?? undefined
  };
}

export async function sendTaskCompletionNotification(taskInfo: TaskInfo) {
  return await sendNotification(buildTaskCompletionMessage(taskInfo));
}
