/**
 * Telegram Bot 服务 - 接收命令控制任务
 */

import fetch from 'node-fetch';
import { executeScheduleNow } from './schedulerService.js';
import { execMaaCommand, getTaskStatus, stopCurrentTask, captureScreen } from './maaService.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('TelegramBot');

let botConfig = {
  enabled: false,
  botToken: '',
  chatId: '',
  allowedUserIds: [], // 新增：允许的用户 ID 列表
  adbPath: '/opt/homebrew/bin/adb',
  adbAddress: '127.0.0.1:16384',
  allowedCommands: ['start', 'stop', 'status', 'fight', 'roguelike', 'copilot', 'startup', 'closedown', 'screenshot', 'help']
};

let isPolling = false;
let lastUpdateId = 0;

/**
 * 初始化 Telegram Bot
 */
export function initTelegramBot(config) {
  if (!config || !config.botToken || !config.chatId) {
    logger.debug('配置不完整，跳过初始化');
    return;
  }

  botConfig = { ...botConfig, ...config };
  
  if (botConfig.enabled && !isPolling) {
    startPolling();
    setupBotCommands(); // 设置 Bot 命令菜单
    logger.info('已启动，等待命令');
  }
}

/**
 * 停止 Telegram Bot
 */
export function stopTelegramBot() {
  isPolling = false;
  logger.info('已停止');
}

/**
 * 开始轮询消息
 */
async function startPolling() {
  isPolling = true;
  
  while (isPolling) {
    try {
      const updates = await getUpdates();
      
      if (updates && updates.length > 0) {
        for (const update of updates) {
          // 不等待 handleUpdate 完成，让它在后台异步执行
          handleUpdate(update).catch(error => {
            logger.error('处理消息错误', { error: error.message });
          });
          lastUpdateId = update.update_id + 1;
        }
      }
      
      // 等待 2 秒后继续轮询
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      // 忽略多实例冲突错误（通常是因为开发时热重载导致）
      if (!error.message?.includes('Conflict: terminated by other getUpdates')) {
        logger.error('轮询错误', { error: error.message });
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

/**
 * 获取更新
 */
async function getUpdates() {
  const url = `https://api.telegram.org/bot${botConfig.botToken}/getUpdates`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      offset: lastUpdateId,
      timeout: 30,
      allowed_updates: ['message']
    })
  });
  
  const data = await response.json();
  
  if (!data.ok) {
    throw new Error(data.description || 'Failed to get updates');
  }
  
  return data.result;
}

/**
 * 处理更新
 */
async function handleUpdate(update) {
  if (!update.message || !update.message.text) {
    return;
  }
  
  const message = update.message;
  const chatId = message.chat.id.toString();
  const userId = message.from.id.toString();
  
  // 忽略 Bot 自己发送的消息
  if (message.from.is_bot) {
    return;
  }
  
  // 验证授权
  // 1. 如果配置了 allowedUserIds，检查用户 ID 是否在列表中
  // 2. 如果配置的是群组 ID（负数），验证 chat ID
  // 3. 如果配置的是个人 ID（正数），验证 user ID
  const configuredId = botConfig.chatId;
  const allowedUserIds = botConfig.allowedUserIds || [];
  
  let isAuthorized = false;
  
  // 优先检查 allowedUserIds 列表
  if (allowedUserIds.length > 0) {
    isAuthorized = allowedUserIds.includes(userId);
  } else {
    // 兼容旧的单 ID 配置
    isAuthorized = (chatId === configuredId) || (userId === configuredId);
  }
  
  if (!isAuthorized) {
    logger.warn('拒绝未授权的请求', { chatId, userId, configuredId, allowedUserIds });
    return;
  }
  
  const text = message.text.trim();
  
  // 检查是否是 maa:// URI（直接发送作业链接）
  if (text.startsWith('maa://')) {
    logger.debug('检测到作业 URI', { uri: text });
    await handleCommand(chatId, 'copilot', [text]);
    return;
  }
  
  // 关键词映射表（只包含不带参数的命令）
  const keywordMap = {
    '截图': 'screenshot',
    '截屏': 'screenshot',
    'screenshot': 'screenshot',
    '帮助': 'help',
    '命令': 'help',
    'help': 'help',
    '状态': 'status',
    'status': 'status',
    '停止': 'stop',
    '停止任务': 'stop',
    'stop': 'stop',
    // 不带参数的启动/关闭/肉鸽（使用默认值）
    '启动游戏': 'startup',
    '开启游戏': 'startup',
    '打开游戏': 'startup',
    '关闭游戏': 'closedown',
    '肉鸽': 'roguelike',
    // 不带参数的任务流程（使用默认 automation）
    '运行': 'run',
    '运行流程': 'run',
    '执行流程': 'run',
    '日常': 'run'
  };
  
  // 检查是否是关键词（不带参数的命令）
  if (keywordMap[text]) {
    logger.debug('检测到关键词', { keyword: text, command: keywordMap[text] });
    await handleCommand(chatId, keywordMap[text], []);
    return;
  }
  
  // 检查是否是带参数的关键词命令
  const words = text.split(' ');
  const firstWord = words[0];
  const restWords = words.slice(1);
  
  // 刷关卡：刷 1-7, 刷关卡 1-7, fight 1-7
  if ((firstWord === '刷' || firstWord === '刷关卡' || firstWord === 'fight') && restWords.length > 0) {
    logger.debug('检测到刷关卡命令', { text });
    await handleCommand(chatId, 'fight', restWords);
    return;
  }
  
  // 肉鸽：肉鸽 Sami, 刷肉鸽 Sami, roguelike Sami
  if ((firstWord === '肉鸽' || firstWord === '刷肉鸽' || firstWord === 'roguelike') && restWords.length > 0) {
    logger.debug('检测到肉鸽命令', { text });
    await handleCommand(chatId, 'roguelike', restWords);
    return;
  }
  
  // 启动游戏：启动 Official, 启动游戏 Official, 开启 Official, 打开 Official
  if ((firstWord === '启动' || firstWord === '启动游戏' || firstWord === '开启' || firstWord === '打开' || firstWord === '开启游戏' || firstWord === '打开游戏' || firstWord === 'startup') && restWords.length > 0) {
    logger.debug('检测到启动游戏命令', { text });
    await handleCommand(chatId, 'startup', restWords);
    return;
  }
  
  // 关闭游戏：关闭 Official, 关闭游戏 Official
  if ((firstWord === '关闭' || firstWord === '关闭游戏' || firstWord === 'closedown') && restWords.length > 0) {
    logger.debug('检测到关闭游戏命令', { text });
    await handleCommand(chatId, 'closedown', restWords);
    return;
  }
  
  // 运行流程：运行 automation, 运行流程 automation, run automation
  if ((firstWord === '运行' || firstWord === '运行流程' || firstWord === '执行流程' || firstWord === 'run' || firstWord === 'flow') && restWords.length > 0) {
    logger.debug('检测到运行流程命令', { text });
    await handleCommand(chatId, 'run', restWords);
    return;
  }
  
  // 检查是否是命令（以 / 开头）
  if (!text.startsWith('/')) {
    return;
  }
  
  const command = text.split(' ')[0].replace('/', '');
  const args = text.split(' ').slice(1);
  
  logger.info('收到命令', { command, args: args.join(' ') });
  
  await handleCommand(chatId, command, args);
}

/**
 * 处理命令
 */
async function handleCommand(chatId, command, args) {
  let response = '';
  
  try {
    // 如果是执行新任务的命令，先停止当前任务
    const taskCommands = ['startup', 'fight', 'copilot', 'roguelike'];
    if (taskCommands.includes(command)) {
      const status = getTaskStatus();
      if (status.isRunning) {
        logger.info('检测到新任务命令，停止当前任务', { currentTask: status.taskName, newCommand: command });
        const stopResult = stopCurrentTask();
        
        if (stopResult.success) {
          await sendMessage(chatId, `⏹️ 已强制停止当前任务: ${status.taskName}\n\n✅ 开始执行新任务...`);
          
          // 等待 2 秒让进程完全释放
          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          await sendMessage(chatId, `⚠️ ${stopResult.message}\n\n继续执行新任务...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    switch (command) {
      case 'start':
      case 'help':
        response = getHelpMessage();
        break;
        
      case 'status':
        response = await getStatus();
        break;
        
      case 'startup':
        const clientType = args[0] || 'Official';
        response = await executeStartup(clientType);
        break;
        
      case 'closedown':
        const closeClient = args[0] || 'Official';
        response = await executeClosedown(closeClient);
        break;
        
      case 'screenshot':
        await executeScreenshot(chatId);
        return; // 截图命令直接返回，不发送文本消息
        
      case 'setcommands':
        await setupBotCommands();
        response = '✅ 命令菜单已更新\n\n请重新打开聊天窗口查看新菜单';
        break;
        
      case 'fight':
        if (args.length === 0) {
          response = '❌ 请指定关卡，例如：/fight 1-7';
        } else {
          response = await executeFight(args[0]);
        }
        break;
        
      case 'roguelike':
        const theme = args[0] || 'Sami';
        response = await executeRoguelike(theme);
        break;
        
      case 'copilot':
        if (args.length === 0) {
          response = '❌ 请指定作业 URI，例如：/copilot maa://12345';
        } else {
          response = await executeCopilot(args[0]);
        }
        break;
        
      case 'schedule':
        response = await executeScheduleTask();
        break;
        
      case 'stop':
        response = await stopTask();
        break;
        
      case 'run':
      case 'flow':
        const flowType = args[0] || 'automation';
        response = await executeTaskFlow(flowType);
        break;
        
      default:
        response = `❌ 未知命令: ${command}\n\n使用 /help 查看可用命令`;
    }
  } catch (error) {
    response = `❌ 执行失败: ${error.message}`;
  }
  
  // 如果 response 不为 null，才发送消息
  if (response !== null) {
    await sendMessage(chatId, response);
  }
}

/**
 * 获取帮助信息
 */
function getHelpMessage() {
  return `🤖 La Pluma Bot 命令列表

📋 基础命令：
/help 或 帮助 - 显示此帮助信息
/status 或 状态 - 查看当前任务状态
/screenshot 或 截图 - 截取当前屏幕

🎮 游戏控制：
/startup 客户端 或 启动/开启/打开 客户端 - 启动游戏
  客户端：Official, Bilibili（默认 Official）
  例如：打开 Official 或 /startup Official
  
/closedown 客户端 或 关闭 客户端 - 关闭游戏
  例如：关闭 Official 或 /closedown Official

⚔️ 任务命令：
/fight 关卡 或 刷 关卡 - 执行理智作战
  例如：刷 1-7 或 /fight 1-7
  
/copilot URI - 执行抄作业（自动导航）
  例如：/copilot maa://12345
  或直接发送：maa://12345
  ✨ 会自动导航到关卡界面
  
/roguelike 主题 或 肉鸽 主题 - 执行肉鸽任务
  主题：Sami, Sarkaz, Mizuki, Phantom
  例如：肉鸽 Sami 或 /roguelike Sami

⏹️ 控制命令：
/stop 或 停止 - 停止当前任务

🔄 任务流程：
/run 流程类型 或 运行 流程类型 - 运行任务流程
  流程类型：automation（日常）, combat（作战）, roguelike（肉鸽）
  例如：运行 automation 或 /run automation
  不指定类型默认运行日常流程

💡 提示：
- 所有命令都支持中文关键词，更方便输入
- 执行任务前需要先"启动"游戏
- 任务完成后建议"关闭"游戏
- 可以直接发送 maa://12345 快速抄作业
- 可以直接发送"截图"快速截图
- 任务执行完成后会自动发送通知

📝 中文命令示例：
• 截图
• 状态
• 打开 Official
• 刷 1-7
• 肉鸽 Sami
• 运行 automation（或直接发送"日常"）
• 停止
• 关闭`;
}

/**
 * 获取状态
 */
async function getStatus() {
  try {
    const status = getTaskStatus();
    
    // 同时导入 schedulerService 的状态
    const { getScheduleExecutionStatus } = await import('./schedulerService.js');
    const scheduleStatus = getScheduleExecutionStatus();
    
    let statusText = `📊 系统状态\n\n`;
    statusText += `✅ Bot 运行中\n`;
    
    // 检查是否有任务流程在运行
    if (scheduleStatus.isRunning) {
      statusText += `🎮 正在执行任务流程\n`;
      statusText += `📝 流程: ${scheduleStatus.scheduleId || '未知'}\n`;
      statusText += `📍 当前任务: ${scheduleStatus.currentTask || '未知'}\n`;
      statusText += `📊 进度: ${scheduleStatus.currentStep + 1}/${scheduleStatus.totalSteps}\n`;
      const duration = Math.floor((Date.now() - scheduleStatus.startTime) / 1000);
      statusText += `⏱️ 运行时间: ${duration} 秒\n`;
    }
    // 检查是否有单个任务在运行
    else if (status.isRunning) {
      statusText += `🎮 正在执行任务\n`;
      statusText += `📝 当前任务: ${status.taskName || '未知'}\n`;
      const duration = Math.floor((Date.now() - status.startTime) / 1000);
      statusText += `⏱️ 运行时间: ${duration} 秒\n`;
    }
    // 没有任务在运行
    else {
      statusText += `⏰ 等待命令...\n`;
    }
    
    statusText += `\n使用 /help 查看可用命令`;
    
    return statusText;
  } catch (error) {
    return `📊 系统状态\n\n✅ Bot 运行中\n⏰ 等待命令...\n\n使用 /help 查看可用命令`;
  }
}

/**
 * 执行启动游戏
 */
async function executeStartup(clientType) {
  try {
    await execMaaCommand('startup', [clientType], '启动游戏', 'startup');
    return `✅ 已开始启动游戏
📱 客户端：${clientType}

游戏启动需要约 15-30 秒
请稍后再执行其他任务`;
  } catch (error) {
    throw new Error(`启动失败: ${error.message}`);
  }
}

/**
 * 执行关闭游戏
 */
async function executeClosedown(clientType) {
  try {
    await execMaaCommand('closedown', [clientType], '关闭游戏', 'closedown');
    return `✅ 已关闭游戏
📱 客户端：${clientType}`;
  } catch (error) {
    throw new Error(`关闭失败: ${error.message}`);
  }
}

/**
 * 执行截图
 */
async function executeScreenshot(chatId) {
  try {
    // 先发送提示消息
    await sendMessage(chatId, '📸 正在截图...');
    
    // 执行截图
    const result = await captureScreen(botConfig.adbPath, botConfig.adbAddress);
    
    if (result.image) {
      // 发送图片
      await sendPhoto(chatId, '📸 当前屏幕截图', result.image);
    } else {
      await sendMessage(chatId, '❌ 截图失败：未获取到图片数据');
    }
  } catch (error) {
    await sendMessage(chatId, `❌ 截图失败: ${error.message}\n\n请检查 ADB 连接是否正常`);
  }
}

/**
 * 执行理智作战
 */
async function executeFight(stage) {
  try {
    await execMaaCommand('fight', [stage], `刷关卡 ${stage}`, 'combat');
    return `✅ 已开始执行理智作战
📍 关卡：${stage}

任务完成后会自动发送通知`;
  } catch (error) {
    throw new Error(`执行失败: ${error.message}`);
  }
}

/**
 * 执行肉鸽任务
 */
async function executeRoguelike(theme) {
  try {
    await execMaaCommand('roguelike', [theme], `肉鸽 ${theme}`, 'roguelike');
    return `✅ 已开始执行肉鸽任务
🎯 主题：${theme}

任务完成后会自动发送通知`;
  } catch (error) {
    throw new Error(`执行失败: ${error.message}`);
  }
}

/**
 * 执行抄作业
 */
async function executeCopilot(uri) {
  try {
    // 1. 获取关卡信息
    const stageInfo = await getStageInfoFromCopilot(uri);
    const displayName = stageInfo?.displayName || '对应关卡';
    
    // 2. 提示用户手动导航
    await sendMessage(botConfig.chatId, `✅ 准备执行抄作业
📋 作业 URI：${uri}
📍 关卡：${displayName}

⚠️ 请在 15 秒内手动进入关卡界面

倒计时开始...`);
    
    // 3. 在后台执行倒计时和作业（不阻塞）
    (async () => {
      try {
        // 倒计时提醒
        for (let i = 15; i > 0; i--) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          if (i === 10 || i === 5 || i === 3 || i === 1) {
            await sendMessage(botConfig.chatId, `⏰ ${i} 秒...`);
          }
        }
        
        // 执行作业
        await sendMessage(botConfig.chatId, `🚀 开始执行作业！`);
        await execMaaCommand('copilot', [uri, '--formation'], `抄作业 ${uri}`, 'copilot');
      } catch (error) {
        await sendMessage(botConfig.chatId, `❌ 作业执行失败: ${error.message}`);
      }
    })();
    
    // 立即返回，不等待倒计时完成
    return `✅ 倒计时已开始

任务完成后会自动发送通知`;
  } catch (error) {
    throw new Error(`执行失败: ${error.message}`);
  }
}

/**
 * 内部关卡代号到显示名称的映射表
 * 用于无法从标题获取关卡名的情况
 */
const STAGE_NAME_MAP = {
  // 活动关卡示例（需要根据实际情况补充）
  'act40side_ex08': 'OR-EX-8',
  'act40side_ex07': 'OR-EX-7',
  'act40side_ex06': 'OR-EX-6',
  'act40side_ex05': 'OR-EX-5',
  'act40side_ex04': 'OR-EX-4',
  'act40side_ex03': 'OR-EX-3',
  'act40side_ex02': 'OR-EX-2',
  'act40side_ex01': 'OR-EX-1',
  // 可以继续添加其他活动关卡...
};

/**
 * 从作业 URI 获取关卡信息
 */
async function getStageInfoFromCopilot(uri) {
  try {
    if (uri.startsWith('maa://')) {
      const code = uri.replace('maa://', '').replace(/s$/, '');
      const apiUrl = `https://prts.maa.plus/copilot/get/${code}`;
      
      const response = await fetch(apiUrl);
      if (!response.ok) {
        logger.error('Copilot API 请求失败', { status: response.statusText });
        return null;
      }
      
      const data = await response.json();
      
      if (data.data?.content) {
        const content = JSON.parse(data.data.content);
        
        // 标题在 content.doc.title 里面（不是 data.data.doc.title）
        const title = content.doc?.title || '';
        logger.debug('Copilot 作业标题', { title });
        
        // 从标题提取显示名称（最重要）
        let displayName = null;
        if (title) {
          // 尝试多种格式匹配
          // 格式1: "OR-EX-8 xxx" 或 "OR-EX-8"
          let titleMatch = title.match(/^([A-Z]{1,3}-[A-Z]{1,3}-\d+)/);
          if (!titleMatch) {
            // 格式2: "1-7 xxx" 或 "1-7"
            titleMatch = title.match(/^(\d+-\d+)/);
          }
          if (!titleMatch) {
            // 格式3: "CE-6 xxx" 或 "CE-6"
            titleMatch = title.match(/^([A-Z]{1,3}-\d+)/);
          }
          if (!titleMatch) {
            // 格式4: 标题中包含关卡名，如 "【OR-EX-8】xxx" 或 "[OR-EX-8] xxx"
            titleMatch = title.match(/[【\[]([A-Z]{1,3}-[A-Z]{1,3}-\d+)[】\]]/);
          }
          if (!titleMatch) {
            // 格式5: 标题中包含关卡名，如 "【1-7】xxx"
            titleMatch = title.match(/[【\[](\d+-\d+)[】\]]/);
          }
          if (!titleMatch) {
            // 格式6: 任何位置的关卡名模式
            titleMatch = title.match(/([A-Z]{1,3}-[A-Z]{1,3}-\d+)/);
          }
          if (!titleMatch) {
            titleMatch = title.match(/(\d+-\d+)/);
          }
          
          if (titleMatch) {
            displayName = titleMatch[1];
          }
        }
        
        // 如果标题中没有找到，尝试从映射表查找
        if (!displayName && content.stage_name) {
          displayName = STAGE_NAME_MAP[content.stage_name] || null;
          if (displayName) {
            logger.debug('从映射表找到关卡名', { displayName });
          }
        }
        
        logger.debug('Copilot 关卡信息', { displayName, stageName: content.stage_name });
        
        return {
          stageName: content.stage_name,  // 内部代号
          displayName: displayName         // 显示名称（用于导航）
        };
      }
    } else if (uri.endsWith('.json')) {
      const { readFile } = await import('fs/promises');
      const fileContent = await readFile(uri, 'utf-8');
      const data = JSON.parse(fileContent);
      return {
        stageName: data.stage_name,
        displayName: null
      };
    }
    
    return null;
  } catch (error) {
    logger.error('Copilot 获取关卡信息失败', { error: error.message });
    return null;
  }
}

/**
 * 执行定时任务
 */
async function executeScheduleTask(scheduleId) {
  try {
    // 注意：这里需要传入 taskFlow，但 Bot 无法获取
    // 建议用户通过 WebUI 配置定时任务，Bot 只用于执行预定义任务
    return `❌ 暂不支持通过 Bot 执行定时任务

请使用以下命令：
/fight <关卡> - 执行理智作战
/roguelike [主题] - 执行肉鸽任务`;
  } catch (error) {
    throw new Error(`执行失败: ${error.message}`);
  }
}

/**
 * 停止当前任务
 */
async function stopTask() {
  try {
    const result = stopCurrentTask();
    if (result.success) {
      return `⏹️ 已发送停止信号

当前任务将在完成当前步骤后停止`;
    } else {
      return `ℹ️ ${result.message || '当前没有正在运行的任务'}`;
    }
  } catch (error) {
    throw new Error(`停止失败: ${error.message}`);
  }
}

/**
 * 执行任务流程
 */
async function executeTaskFlow(flowType = 'automation') {
  try {
    // 验证流程类型
    const validTypes = ['automation', 'combat', 'roguelike'];
    if (!validTypes.includes(flowType)) {
      return `❌ 无效的流程类型: ${flowType}

支持的流程类型：
• automation - 日常流程
• combat - 作战流程
• roguelike - 肉鸽流程`;
    }
    
    // 获取流程名称
    const flowNames = {
      'automation': '日常流程',
      'combat': '作战流程',
      'roguelike': '肉鸽流程'
    };
    
    const flowName = flowNames[flowType];
    
    // 读取任务流程配置
    const { readFile } = await import('fs/promises');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    
    // 获取当前文件所在目录
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    
    const configFileName = flowType === 'automation' ? 'automation-tasks.json' : 
                          flowType === 'combat' ? 'combat-tasks.json' : 
                          'roguelike-tasks.json';
    
    // 从 services 目录向上两级到项目根目录，然后进入 data/user-configs
    const configPath = join(__dirname, '..', 'data', 'user-configs', configFileName);
    logger.debug('读取配置文件', { configPath });
    
    const configContent = await readFile(configPath, 'utf-8');
    const config = JSON.parse(configContent);
    
    // 获取任务流程
    const taskFlow = config.taskFlow;
    
    if (!taskFlow || taskFlow.length === 0) {
      return `❌ ${flowName}未配置任何任务

请先在 WebUI 中配置任务流程`;
    }
    
    // 发送初始状态消息
    const initialMessage = await sendMessage(botConfig.chatId, `✅ 已开始执行${flowName}

📊 准备执行 ${taskFlow.filter(t => t.enabled).length} 个任务...`);
    
    // 获取消息 ID 用于后续编辑
    const messageId = initialMessage?.result?.message_id;
    
    // 在后台执行流程并实时更新状态
    if (messageId) {
      (async () => {
        try {
          // 导入状态查询函数
          const { getScheduleExecutionStatus } = await import('./schedulerService.js');
          
          // 启动状态更新循环
          const updateInterval = setInterval(async () => {
            const scheduleStatus = getScheduleExecutionStatus();
            
            if (!scheduleStatus.isRunning) {
              // 任务完成，停止更新
              clearInterval(updateInterval);
              await editMessage(botConfig.chatId, messageId, `✅ ${flowName}执行完成

任务已全部完成
详细结果请查看通知消息`);
              return;
            }
            
            // 构建状态文本
            const duration = Math.floor((Date.now() - scheduleStatus.startTime) / 1000);
            const minutes = Math.floor(duration / 60);
            const seconds = duration % 60;
            const timeStr = minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;
            
            const statusText = `🔄 正在执行${flowName}

📍 当前任务: ${scheduleStatus.currentTask || '准备中...'}
📊 进度: ${scheduleStatus.currentStep + 1}/${scheduleStatus.totalSteps}
⏱️ 运行时间: ${timeStr}

请稍候...`;
            
            await editMessage(botConfig.chatId, messageId, statusText);
          }, 3000); // 每3秒更新一次
          
        } catch (error) {
          logger.error('状态更新失败', { error: error.message });
        }
      })();
    }
    
    // 执行流程（不等待完成）
    executeScheduleNow(flowType, taskFlow).catch(error => {
      logger.error('任务流程执行失败', { error: error.message });
      if (messageId) {
        editMessage(botConfig.chatId, messageId, `❌ ${flowName}执行失败

错误: ${error.message}`);
      }
    });
    
    return null; // 不返回消息，因为已经发送了初始消息
  } catch (error) {
    throw new Error(`执行失败: ${error.message}`);
  }
}

/**
 * 发送消息
 */
async function sendMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${botConfig.botToken}/sendMessage`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'  // 改用 Markdown 而不是 HTML
      })
    });
    
    const data = await response.json();
    
    if (!data.ok) {
      logger.error('发送消息失败', { description: data.description });
    }
    
    return data; // 返回完整响应，包含 message_id
  } catch (error) {
    logger.error('发送消息错误', { error: error.message });
  }
}

/**
 * 编辑消息
 */
async function editMessage(chatId, messageId, text) {
  const url = `https://api.telegram.org/bot${botConfig.botToken}/editMessageText`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: text,
        parse_mode: 'Markdown'
      })
    });
    
    const data = await response.json();
    
    if (!data.ok) {
      // 如果消息内容没有变化，Telegram 会返回错误，这是正常的
      if (!data.description.includes('message is not modified')) {
        logger.error('编辑消息失败', { description: data.description });
      }
    }
    
    return data;
  } catch (error) {
    logger.error('编辑消息错误', { error: error.message });
  }
}

/**
 * 发送图片
 */
async function sendPhoto(chatId, caption, imageBase64) {
  const url = `https://api.telegram.org/bot${botConfig.botToken}/sendPhoto`;
  
  try {
    // 将 base64 转换为 Buffer
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    
    // 使用 FormData 发送图片
    const FormData = (await import('form-data')).default;
    const formData = new FormData();
    
    // 增加事件监听器限制，避免内存泄漏警告
    formData.setMaxListeners(20);
    
    formData.append('chat_id', chatId);
    formData.append('photo', imageBuffer, { filename: 'screenshot.png' });
    formData.append('caption', caption);
    
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders(),
    });
    
    const data = await response.json();
    
    if (!data.ok) {
      logger.error('发送图片失败', { description: data.description });
      throw new Error(data.description);
    }
  } catch (error) {
    logger.error('发送图片错误', { error: error.message });
    throw error;
  }
}

/**
 * 设置 Bot 命令菜单
 */
async function setupBotCommands() {
  // 先删除所有旧命令
  const deleteUrl = `https://api.telegram.org/bot${botConfig.botToken}/deleteMyCommands`;
  
  try {
    await fetch(deleteUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    logger.debug('已删除旧命令');
  } catch (error) {
    logger.error('删除旧命令失败', { error: error.message });
  }
  
  // 设置新命令
  const url = `https://api.telegram.org/bot${botConfig.botToken}/setMyCommands`;
  
  const commands = [
    { command: 'help', description: '显示帮助信息' },
    { command: 'status', description: '查看当前任务状态' },
    { command: 'screenshot', description: '截取当前屏幕' },
    { command: 'startup', description: '启动游戏 (例: /startup Official)' },
    { command: 'closedown', description: '关闭游戏' },
    { command: 'fight', description: '执行理智作战 (例: /fight 1-7)' },
    { command: 'roguelike', description: '执行肉鸽任务 (例: /roguelike Sami)' },
    { command: 'run', description: '运行任务流程 (例: /run automation)' },
    { command: 'stop', description: '停止当前任务' }
  ];
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands })
    });
    
    const data = await response.json();
    
    if (data.ok) {
      logger.debug('命令菜单设置成功');
    } else {
      logger.error('命令菜单设置失败', { description: data.description });
    }
  } catch (error) {
    logger.error('设置命令菜单错误', { error: error.message });
  }
}

export { botConfig };
