import cron from 'node-cron';
import { execMaaCommand, execDynamicTask, replaceActivityCode, captureScreen } from './maaService.js';
import { sendTaskCompletionNotification, isStageOpenToday } from './notificationService.js';
import { loadUserConfig, saveUserConfig } from './configStorageService.js';
import operatorTrainingService from './operatorTrainingService.js';
import { recordDrops } from './dropRecordService.js';
import { createLogger } from '../utils/logger.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// 创建日志记录器
const logger = createLogger('Scheduler');

// MAA CLI 路径
// Docker 环境使用完整路径，本地环境使用 'maa' 依赖 PATH
const MAA_CLI_PATH = process.env.MAA_CLI_PATH || (process.env.DOCKER_ENV ? '/usr/local/bin/maa' : 'maa');

// 存储所有定时任务
const scheduledJobs = new Map();

// 定时任务执行状态
const scheduleExecutionStatus = {
  isRunning: false,
  scheduleId: null,
  currentStep: -1,
  totalSteps: 0,
  currentTask: null,
  message: '',
  startTime: null,
  shouldStop: false  // 添加停止标志
};

/**
 * 获取定时任务执行状态
 */
export function getScheduleExecutionStatus() {
  return { ...scheduleExecutionStatus };
}

/**
 * 停止当前正在执行的任务流程
 */
export function stopScheduleExecution() {
  if (scheduleExecutionStatus.isRunning) {
    logger.warn('设置停止标志，将在当前任务完成后终止流程');
    scheduleExecutionStatus.shouldStop = true;
    return true;
  }
  return false;
}

/**
 * 更新定时任务执行状态
 */
function updateScheduleStatus(updates) {
  Object.assign(scheduleExecutionStatus, updates);
  logger.debug('定时任务状态更新', scheduleExecutionStatus);
}

// Socket.io 实例（从 server.js 导入）
let io = null;

/**
 * 设置 Socket.io 实例
 */
export function setSocketIO(socketIO) {
  io = socketIO;
  logger.info('Socket.io 已设置');
}

/**
 * 发送任务进度事件到前端
 */
function emitTaskProgress(scheduleId, data) {
  if (io) {
    io.emit('schedule-progress', {
      scheduleId,
      ...data
    });
  }
}

// 构建 MAA 命令
function buildCommand(task) {
  if (task.taskType) {
    // MaaCore 内置任务类型
    const params = task.params || {};
    const taskConfig = {
      name: task.name,
      type: task.taskType,
      params: {}
    };
    
    // 某些字段应该保持字符串格式，不要转换为数字
    const keepAsString = ['mode'];
    
    Object.keys(params).forEach(key => {
      const value = params[key];
      if (value === undefined || value === '' || value === null) return;
      
      if (typeof value === 'boolean') {
        taskConfig.params[key] = value;
      } else if (Array.isArray(value)) {
        if (value.length > 0) {
          taskConfig.params[key] = value;
        }
      } else if (typeof value === 'string' && value.trim().startsWith('[') && value.trim().endsWith(']')) {
        taskConfig.params[key] = value.trim();
      } else if (typeof value === 'string' && value.includes(',') && !value.includes('[')) {
        taskConfig.params[key] = value.split(',').map(v => v.trim()).filter(v => v);
      } else if (typeof value === 'number') {
        taskConfig.params[key] = value;
      } else if (typeof value === 'string' && !isNaN(Number(value)) && value.trim() !== '' && !keepAsString.includes(key)) {
        taskConfig.params[key] = Number(value);
      } else if (value) {
        taskConfig.params[key] = value;
      }
    });
    
    return { 
      command: 'run', 
      params: task.commandId || task.id,
      taskConfig: JSON.stringify(taskConfig)
    };
  }

  // 预定义命令
  const commandId = task.commandId || task.id.split('-')[0];
  let params = '';
  let extraArgs = [];
  
  if (commandId === 'startup' || commandId === 'closedown') {
    params = task.params.clientType || 'Official';
    if (task.params.address) {
      extraArgs.push(`-a ${task.params.address}`);
    }
    // 添加账号切换参数
    if (commandId === 'startup' && task.params.accountName) {
      extraArgs.push(`--account ${task.params.accountName}`);
    }
  } else if (commandId === 'fight') {
    // 支持多个关卡（stages 数组，每个元素是 {stage, times}）或单个关卡（stage 字符串）
    let stages = task.params.stages || [{ stage: task.params.stage || '', times: task.params.times || '' }];
    
    // 标准化格式：将所有元素转换为 {stage, times} 对象
    stages = stages.map(s => {
      if (typeof s === 'string') {
        // 字符串格式，转换为对象
        return { stage: s, times: '' };
      } else if (typeof s === 'object' && s.stage) {
        // 已经是对象格式
        return s;
      } else {
        // 无效格式，返回空对象
        return { stage: '', times: '' };
      }
    });
    
    // 构建关卡列表，格式：stage1:times1,stage2:times2
    const stageList = stages
      .filter(s => s.stage && s.stage.trim())
      .map(s => {
        const stage = s.stage.trim();
        const times = s.times ? `:${s.times}` : '';
        return `${stage}${times}`;
      })
      .join(',');
    
    params = stageList;
    
    if (task.params.medicine !== undefined && task.params.medicine !== '' && task.params.medicine !== null) {
      params += ` -m ${task.params.medicine}`;
    }
    if (task.params.expiringMedicine !== undefined && task.params.expiringMedicine !== '' && task.params.expiringMedicine !== null) {
      params += ` --expiring-medicine ${task.params.expiringMedicine}`;
    }
    if (task.params.stone !== undefined && task.params.stone !== '' && task.params.stone !== null) {
      params += ` --stone ${task.params.stone}`;
    }
    if (task.params.series !== undefined && task.params.series !== '' && task.params.series !== '1') {
      params += ` --series ${task.params.series}`;
    }
  }
  
  if (extraArgs.length > 0) {
    params = `${extraArgs.join(' ')} ${params}`;
  }
  
  return { command: commandId, params };
}

// 执行任务流程
async function executeTaskFlow(taskFlow, scheduleId) {
  logger.info('开始执行任务流程', { scheduleId });
  
  // 更新状态：开始执行
  updateScheduleStatus({
    isRunning: true,
    scheduleId,
    currentStep: -1,
    totalSteps: taskFlow.filter(t => t.enabled).length,
    currentTask: null,
    message: '开始执行任务流程',
    startTime: Date.now(),
    shouldStop: false  // 重置停止标志
  });
  
  const startTime = Date.now();
  const enabledTasks = taskFlow.filter(t => t.enabled);
  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  const errors = [];
  const skipped = [];
  const taskSummaries = []; // 收集任务总结信息
  let screenshot = null;
  let adbConfig = { adbPath: '/opt/homebrew/bin/adb', address: '127.0.0.1:16384' };
  
  for (let i = 0; i < enabledTasks.length; i++) {
    // 检查是否需要停止
    if (scheduleExecutionStatus.shouldStop) {
      logger.warn('检测到停止信号，终止任务流程', { scheduleId });
      updateScheduleStatus({
        message: '任务流程已被用户终止'
      });
      break;
    }
    
    const task = enabledTasks[i];
    const commandId = task.commandId || task.id.split('-')[0];
    
    logger.info('执行任务', { 
      scheduleId,
      taskIndex: i + 1,
      totalTasks: enabledTasks.length,
      taskName: task.name
    });
    
    // 更新状态：执行中
    updateScheduleStatus({
      currentStep: i,
      currentTask: task.name,
      currentTaskId: task.id, // 添加任务 ID
      message: `正在执行: ${task.name} (${i + 1}/${enabledTasks.length})`
    });
    
    // 保存 ADB 配置（从启动游戏任务中获取）
    if (commandId === 'startup' && task.params) {
      if (task.params.adbPath) adbConfig.adbPath = task.params.adbPath;
      if (task.params.address) adbConfig.address = task.params.address;
    }
    
    // 如果是领取奖励任务，执行后截图（此时在主界面）
    if (commandId === 'award' && !screenshot) {
      // 先执行领取奖励任务
      try {
        const { command, params, taskConfig } = buildCommand(task);
        
        if (taskConfig) {
          const taskId = params;
          const result = await execDynamicTask(taskId, taskConfig, task.name, null, true);
          
          if (result.stdout) {
            const summary = parseTaskSummary(task.name, result.stdout);
            if (summary) {
              taskSummaries.push(summary);
            }
          }
        } else {
          let args = params ? params.split(' ').filter(arg => arg) : [];
          const result = await execMaaCommand(command, args, task.name, null, true);
          
          if (result.stdout) {
            const summary = parseTaskSummary(task.name, result.stdout);
            if (summary) {
              taskSummaries.push(summary);
            }
          }
        }
        
        successCount++;
        
        // 领取奖励完成后，等待2秒再截图（确保回到主界面）
        logger.info('领取奖励完成，等待后截图', { scheduleId });
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // 截图
        try {
          logger.debug('领取奖励后截图', { scheduleId });
          const screenshotResult = await captureScreen(adbConfig.adbPath, adbConfig.address);
          screenshot = screenshotResult.image;
          logger.success('截图成功', { scheduleId });
        } catch (error) {
          logger.error('截图失败', { scheduleId, error: error.message });
        }
        
        // 任务完成后的延迟
        let delayTime = 2000;
        logger.debug('任务完成，等待后继续', { 
          scheduleId, 
          taskName: task.name, 
          delaySeconds: delayTime / 1000 
        });
        await new Promise(resolve => setTimeout(resolve, delayTime));
        
        // 跳过后面的通用任务执行逻辑
        continue;
      } catch (error) {
        failedCount++;
        errors.push(task.name);
        logger.error('任务执行失败', { 
          scheduleId, 
          taskName: task.name, 
          error: error.message 
        });
        continue;
      }
    }
    
    // 如果是关闭游戏任务，先识别仓库（不再截图）
    if (commandId === 'closedown') {
      // 识别仓库
      try {
        logger.info('关闭游戏前先识别仓库', { scheduleId });
        
        // 等待3秒确保游戏回到主界面
        logger.debug('等待游戏回到主界面', { scheduleId, waitSeconds: 3 });
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        updateScheduleStatus({
          message: '正在识别仓库...'
        });
        
        // 构建 Depot 任务配置
        const depotTaskConfig = {
          name: '仓库识别',
          type: 'Depot',
          params: {
            enable: true
          }
        };
        
        // execDynamicTask 需要 JSON 字符串
        // execDynamicTask 成功时不抛出异常，失败时抛出异常
        try {
          await execDynamicTask('Depot_temp', JSON.stringify(depotTaskConfig), '仓库识别', 'depot', true);
          logger.success('仓库识别命令执行完成', { scheduleId });
          
          // 解析并保存仓库数据
          logger.debug('开始解析仓库数据', { scheduleId });
          const { parseDepotData } = await import('./dataParserService.js');
          const parseResult = await parseDepotData();
          if (parseResult && parseResult.success) {
            logger.success('仓库数据已保存', { 
              scheduleId, 
              itemCount: parseResult.itemCount 
            });
          } else {
            logger.warn('仓库数据解析失败', { scheduleId });
          }
        } catch (depotError) {
          logger.error('仓库识别失败', { 
            scheduleId, 
            error: depotError.message 
          });
          // 即使识别失败也继续执行后续任务
        }
        
        // 等待2秒
        logger.debug('等待后继续', { scheduleId, waitSeconds: 2 });
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        logger.error('仓库识别异常', { 
          scheduleId, 
          error: error.message 
        });
        // 即使识别失败也继续
      }
    }
    
    // 如果是启动游戏任务，添加重试机制
    if (commandId === 'startup') {
      const maxRetries = 2;
      let retryCount = 0;
      let startupSuccess = false;
      
      while (retryCount <= maxRetries && !startupSuccess) {
        try {
          if (retryCount > 0) {
            logger.info('启动游戏重试', { 
              scheduleId, 
              retryCount, 
              maxRetries 
            });
            await new Promise(resolve => setTimeout(resolve, 3000)); // 重试前等待3秒
          }
          
          const { command, params, taskConfig } = buildCommand(task);
          let args = params ? params.split(' ').filter(arg => arg) : [];
          await execMaaCommand(command, args);
          
          logger.info('启动游戏命令执行完成', { scheduleId });
          
          // 检测游戏是否还在运行（通过截图）
          try {
            logger.debug('检测游戏是否运行中', { scheduleId });
            await captureScreen(adbConfig.adbPath, adbConfig.address);
            logger.success('游戏运行正常', { scheduleId });
            startupSuccess = true;
            successCount++;
          } catch (error) {
            logger.error('游戏可能已闪退', { 
              scheduleId, 
              error: error.message 
            });
            retryCount++;
            if (retryCount > maxRetries) {
              throw new Error('游戏启动后闪退，已达到最大重试次数');
            }
          }
        } catch (error) {
          if (retryCount >= maxRetries) {
            failedCount++;
            errors.push(task.name);
            logger.error('任务执行失败', { 
              scheduleId, 
              taskName: task.name, 
              error: error.message 
            });
            break;
          }
          retryCount++;
        }
      }
      
      // 启动游戏任务已处理完成，继续下一个任务
      continue;
    }
    
    try {
      const { command, params, taskConfig } = buildCommand(task);
      
      if (taskConfig) {
        const taskId = params;
        // 定时任务需要等待命令完成才能获取输出
        const result = await execDynamicTask(taskId, taskConfig, task.name, null, true);
        
        // 尝试从输出中提取任务总结
        if (result.stdout) {
          const summary = parseTaskSummary(task.name, result.stdout);
          if (summary) {
            taskSummaries.push(summary);
          }
        }
      } else {
        let args = params ? params.split(' ').filter(arg => arg) : [];
        
        // 如果是 fight 命令，处理多个关卡
        if (command === 'fight' && args.length > 0) {
          const stageInput = args[0];
          const clientType = task.params.clientType || 'Official';
          
          // 解析关卡列表，格式：stage1:times1,stage2:times2 或 stage1,stage2
          const stageEntries = stageInput.split(',').map(s => {
            const parts = s.trim().split(':');
            return {
              stage: parts[0],
              times: parts[1] || ''
            };
          }).filter(s => s.stage);
          
          if (stageEntries.length > 1) {
            // 多个关卡，依次执行
            logger.info('检测到多个关卡', { 
              scheduleId, 
              stages: stageEntries.map(e => `${e.stage}${e.times ? `:${e.times}` : ''}`).join(', ')
            });
            
            let sanityDepleted = false; // 理智耗尽标记
            
            for (let i = 0; i < stageEntries.length; i++) {
              const { stage, times } = stageEntries[i];
              
              // 如果理智已耗尽，跳过剩余关卡
              if (sanityDepleted) {
                logger.info('理智已耗尽，跳过关卡', { scheduleId, stage });
                skippedCount++;
                skipped.push({
                  task: `${task.name} (${stage})`,
                  reason: '理智已耗尽'
                });
                continue;
              }
              
              // 检查关卡是否开放
              const openCheck = isStageOpenToday(stage);
              if (!openCheck.isOpen) {
                logger.info('关卡今日未开放，跳过', { 
                  scheduleId, 
                  stage, 
                  reason: openCheck.reason 
                });
                skippedCount++;
                skipped.push({
                  task: `${task.name} (${stage})`,
                  reason: openCheck.reason
                });
                continue; // 跳过这个关卡
              }
              
              logger.info('执行关卡', { 
                scheduleId, 
                stageIndex: i + 1, 
                totalStages: stageEntries.length, 
                stage, 
                times 
              });
              
              // 替换活动代号
              const realStage = await replaceActivityCode(stage, clientType);
              if (realStage !== stage) {
                logger.debug('关卡代号已替换', { 
                  scheduleId, 
                  originalStage: stage, 
                  realStage 
                });
              }
              
              // 构建当前关卡的参数（移除第一个参数，添加当前关卡和次数）
              const currentArgs = [realStage];
              if (times) {
                currentArgs.push('--times', times);
              }
              
              // 添加其他参数（理智药、源石等）
              // 如果填了次数，排除 --series 参数；否则保留所有参数
              let otherArgs;
              if (times) {
                // 填了次数，过滤掉 --series
                otherArgs = args.slice(1).filter((arg, index, arr) => {
                  return arg !== '--series' && (index === 0 || arr[index - 1] !== '--series');
                });
              } else {
                // 没填次数，保留所有参数（包括 --series）
                otherArgs = args.slice(1);
              }
              currentArgs.push(...otherArgs);
              
              // 执行命令
              try {
                const result = await execMaaCommand(command, currentArgs, `${task.name} (${stage})`, null, true);
                
                // 检查理智状态（传入关卡名称用于排除剿灭）
                const output = (result.stdout || '') + (result.stderr || '');
                logger.debug('检查理智状态', { 
                  scheduleId, 
                  stage, 
                  outputLength: output.length 
                });
                logger.debug('输出内容预览', { 
                  scheduleId, 
                  preview: output.substring(0, 200) 
                });
                
                if (checkSanityDepleted(output, stage)) {
                  logger.info('检测到理智已耗尽', { scheduleId, stage });
                  sanityDepleted = true;
                } else {
                  logger.debug('未检测到理智耗尽', { scheduleId, stage });
                }
                
                // 提取任务总结
                if (result.stdout) {
                  const summary = parseTaskSummary(`${task.name} (${stage})`, result.stdout);
                  if (summary) {
                    taskSummaries.push(summary);
                  }
                }
              } catch (error) {
                // 检查错误信息中是否包含理智不足
                const errorMsg = error.message || '';
                const errorOutput = (error.stdout || '') + (error.stderr || '');
                
                logger.debug('任务执行出错，检查是否理智不足', { 
                  scheduleId, 
                  stage, 
                  errorMsg 
                });
                
                if (checkSanityDepleted(errorOutput, stage) || errorMsg.includes('理智不足') || errorMsg.includes('sanity')) {
                  logger.info('检测到理智已耗尽（从错误信息）', { scheduleId, stage });
                  sanityDepleted = true;
                  // 理智耗尽不算失败，跳过即可
                  skippedCount++;
                  skipped.push({
                    task: `${task.name} (${stage})`,
                    reason: '理智已耗尽'
                  });
                  continue;
                }
                
                // 检查是否是因为关卡未开放导致的错误
                if (errorMsg.includes('stage not open') || errorMsg.includes('关卡未开放') || errorMsg.includes('MaaCore returned an error')) {
                  logger.info('关卡可能未开放或不存在，跳过', { scheduleId, stage });
                  skippedCount++;
                  skipped.push({
                    task: `${task.name} (${stage})`,
                    reason: '关卡未开放或不存在'
                  });
                  continue; // 继续执行下一个关卡
                }
                
                // 检查是否是剿灭奖励已领完（MAA 无法识别剿灭入口）
                if (stage.includes('Annihilation') || stage.includes('@Annihilation')) {
                  logger.info('剿灭关卡可能奖励已领完或未找到入口，跳过', { scheduleId, stage });
                  skippedCount++;
                  skipped.push({
                    task: `${task.name} (${stage})`,
                    reason: '剿灭奖励已领完或未找到入口'
                  });
                  continue; // 继续执行下一个关卡
                }
                
                // 其他错误，记录失败但继续执行
                logger.error('关卡执行失败', { scheduleId, stage, error: errorMsg });
                failedCount++;
                errors.push({
                  task: `${task.name} (${stage})`,
                  error: errorMsg
                });
                // 不再抛出错误，继续执行下一个关卡
              }
              
              // 关卡之间等待2秒
              if (i < stageEntries.length - 1) {
                logger.debug('等待后继续下一个关卡', { scheduleId, waitSeconds: 2 });
                await new Promise(resolve => setTimeout(resolve, 2000));
              }
            }
            
            successCount++;
            
            // 所有关卡完成后的延迟
            let delayTime = 2000;
            logger.debug('任务完成，等待后继续', { 
              scheduleId, 
              taskName: task.name, 
              delaySeconds: delayTime / 1000 
            });
            await new Promise(resolve => setTimeout(resolve, delayTime));
            
            continue; // 跳过后面的单关卡处理
          } else {
            // 单个关卡，检查是否开放
            const { stage, times } = stageEntries[0];
            
            // 检查关卡是否开放
            const openCheck = isStageOpenToday(stage);
            if (!openCheck.isOpen) {
              logger.info('关卡今日未开放，跳过', { 
                scheduleId, 
                stage, 
                reason: openCheck.reason 
              });
              skippedCount++;
              skipped.push({
                task: `${task.name} (${stage})`,
                reason: openCheck.reason
              });
              
              // 跳过后的延迟
              logger.debug('任务已跳过，等待后继续', { 
                scheduleId, 
                taskName: task.name, 
                waitSeconds: 2 
              });
              await new Promise(resolve => setTimeout(resolve, 2000));
              continue; // 跳过这个任务
            }
            
            // 替换活动代号
            const realStage = await replaceActivityCode(stage, clientType);
            if (realStage !== stage) {
              args[0] = realStage; // 只保留关卡名，不要拼接次数
              logger.debug('关卡代号已替换', { 
                scheduleId, 
                originalStage: stage, 
                realStage 
              });
            } else if (times) {
              // 如果没有替换但有次数，也要更新 args[0] 为纯关卡名
              args[0] = stage;
            }
            
            // 如果有次数，添加 --times 参数，并移除 --series 参数
            if (times && !args.includes('--times')) {
              args.splice(1, 0, '--times', times);
              
              // 移除 --series 参数（填了次数的关卡不使用连战）
              const seriesIndex = args.indexOf('--series');
              if (seriesIndex !== -1) {
                args.splice(seriesIndex, 2); // 移除 --series 和它的值
              }
            }
          }
        }
        
        // 定时任务需要等待命令完成才能获取输出
        const result = await execMaaCommand(command, args, task.name, null, true);
        
        // 尝试从输出中提取任务总结
        if (result.stdout) {
          const summary = parseTaskSummary(task.name, result.stdout);
          if (summary) {
            taskSummaries.push(summary);
            
            // 如果是战斗任务且有掉落数据，记录到数据库
            if (summary.stage && summary.dropItems && summary.dropItems.length > 0) {
              try {
                // 估算理智消耗（简化计算，实际应该从关卡数据获取）
                const sanityPerRun = 20; // 默认每次20理智
                const totalSanity = parseInt(summary.times || 1) * sanityPerRun;
                
                await recordDrops({
                  stage: summary.stage,
                  times: parseInt(summary.times || 1),
                  items: summary.dropItems,
                  sanity: totalSanity,
                  medicine: parseInt(summary.medicine || 0),
                  stone: parseInt(summary.stone || 0)
                });
                logger.debug('掉落记录已保存', { 
                  scheduleId, 
                  stage: summary.stage 
                });
              } catch (error) {
                logger.error('掉落记录保存失败', { 
                  scheduleId, 
                  error: error.message 
                });
              }
            }
          }
        }
      }
      
      successCount++;
      
      // 任务完成后的延迟时间
      // 启动游戏需要更长的等待时间，确保游戏完全启动
      let delayTime = 2000;
      if (commandId === 'startup') {
        delayTime = 15000; // 启动游戏等待15秒
      } else if (commandId === 'closedown') {
        delayTime = 3000; // 关闭游戏等待3秒
      }
      
      logger.debug('任务完成，等待后继续', { 
        scheduleId, 
        taskName: task.name, 
        delaySeconds: delayTime / 1000 
      });
      await new Promise(resolve => setTimeout(resolve, delayTime));
    } catch (error) {
      failedCount++;
      errors.push(task.name);
      logger.error('任务执行失败', { 
        scheduleId, 
        taskName: task.name, 
        error: error.message 
      });
      // 继续执行下一个任务
    }
  }
  
  const duration = Date.now() - startTime;
  logger.info('任务流程执行完成', { 
    scheduleId, 
    successCount, 
    failedCount, 
    skippedCount, 
    durationSeconds: Math.floor(duration / 1000) 
  });
  
  // 更新状态：完成
  updateScheduleStatus({
    isRunning: false,
    currentStep: enabledTasks.length,
    message: '任务流程执行完成',
    scheduleId: null,
    currentTask: null
  });
  
  // 动态更新智能养成关卡
  try {
    await updateSmartTrainingStages(scheduleId);
  } catch (error) {
    logger.error('动态更新智能养成关卡失败', { 
      scheduleId, 
      error: error.message 
    });
  }
  
  // 发送完成通知
  try {
    await sendTaskCompletionNotification({
      taskName: `定时任务 ${scheduleId}`,
      totalTasks: enabledTasks.length,
      successTasks: successCount,
      failedTasks: failedCount,
      skippedTasks: skippedCount,
      duration,
      errors,
      skipped,
      summaries: taskSummaries,
      screenshot,
    });
  } catch (error) {
    logger.error('发送通知失败', { 
      scheduleId, 
      error: error.message 
    });
  }
}

/**
 * 检测理智是否耗尽
 * 通过分析 MAA 输出判断理智是否用完
 * @param {string} output - MAA 命令输出
 * @param {string} stage - 关卡名称（用于排除剿灭等特殊关卡）
 */
function checkSanityDepleted(output, stage = '') {
  if (!output) return false;
  
  const lowerOutput = output.toLowerCase();
  const lowerStage = stage.toLowerCase();
  
  // MAA 可能的理智不足提示
  const sanityDepletedPatterns = [
    'sanity is not enough',
    '理智不足',
    '理智已耗尽',
    'not enough sanity',
    'insufficient sanity',
    'no sanity',
    'sanity depleted',
  ];
  
  // 检查文本模式
  for (const pattern of sanityDepletedPatterns) {
    if (lowerOutput.includes(pattern)) {
      return true;
    }
  }
  
  // 检查是否打了 0 次（理智不足的典型表现）
  // 格式: "Fight 关卡名 0 times" 或 "Fight 0 times"
  if (/fight\s+(?:[a-z0-9-]+\s+)?0\s+times?/i.test(output)) {
    return true;
  }
  
  // 关键检测：如果有 Summary 和 [Fight] Completed，但没有 "Fight 关卡名 X times" 这一行
  // 说明理智不足，MAA 没有实际打关卡就退出了
  // 但要排除剿灭关卡（Annihilation），因为剿灭奖励领完也是这个表现
  if (output.includes('Summary') && output.includes('[Fight]') && output.includes('Completed')) {
    // 检查是否有 "Fight 关卡名 数字 times" 这样的行
    const hasFightRecord = /Fight\s+[A-Z0-9-]+\s+\d+\s+times?/i.test(output);
    if (!hasFightRecord) {
      // 如果是剿灭关卡，不判定为理智不足（可能是奖励领完了）
      if (lowerStage.includes('annihilation') || lowerStage.includes('剿灭')) {
        logger.debug('理智检测：剿灭关卡无战斗记录，可能是奖励已领完，不判定为理智不足', { stage });
        return false;
      }
      // 其他关卡没有战斗记录，说明理智不足
      logger.debug('理智检测：非剿灭关卡无战斗记录，判定为理智不足', { stage });
      return true;
    }
  }
  
  return false;
}

/**
 * 解析 MAA 任务总结信息
 */
function parseTaskSummary(taskName, output) {
  const summary = { task: taskName };
  
  // 调试：打印原始输出
  logger.debug('解析任务总结', { 
    taskName, 
    outputLength: output.length 
  });
  logger.debug('任务总结完整输出', { output });
  
  // 解析 MAA 的实际输出格式
  // 格式示例: Fight OR-7 1 times, drops:
  
  // 提取关卡和次数
  const fightMatch = output.match(/Fight\s+([A-Z0-9-]+)\s+(\d+)\s+times?/i);
  if (fightMatch) {
    summary.stage = fightMatch[1];
    summary.times = fightMatch[2];
  }
  
  // 提取掉落信息
  // 格式: total drops: "生香" × 21, 全新装置 × 1, 龙门币 × 252
  const totalDropsMatch = output.match(/total drops:\s*(.+?)(?:\n|$)/i);
  if (totalDropsMatch) {
    const dropsText = totalDropsMatch[1].trim();
    // 解析每个物品
    const itemMatches = dropsText.matchAll(/(?:"([^"]+)"|([^\s,×]+))\s*×\s*(\d+)/g);
    const drops = [];
    const dropItems = []; // 用于记录的结构化数据
    for (const match of itemMatches) {
      const itemName = match[1] || match[2];
      const count = parseInt(match[3]);
      drops.push(`${itemName} × ${count}`);
      dropItems.push({ name: itemName, count });
    }
    if (drops.length > 0) {
      summary.drops = drops.join(', ');
      summary.dropItems = dropItems; // 保存结构化数据
    }
  }
  
  // 提取理智药和源石使用（如果有的话）
  const medicineMatch = output.match(/medicine[:\s]+(\d+)/i);
  if (medicineMatch) {
    summary.medicine = medicineMatch[1];
  }
  
  const stoneMatch = output.match(/stone[:\s]+(\d+)/i);
  if (stoneMatch) {
    summary.stone = stoneMatch[1];
  }
  
  // 提取执行时间
  const timeMatch = output.match(/\[Fight\]\s+([\d:]+)\s+-\s+([\d:]+)\s+\(([^)]+)\)/);
  if (timeMatch) {
    summary.duration = timeMatch[3];
  }
  
  // 解析公招总结
  if (output.includes('Recruit')) {
    const recruitMatches = output.matchAll(/Recruit[:\s]+\[([^\]]+)\]\s*->\s*(\d+)\*/gi);
    const recruits = [];
    for (const match of recruitMatches) {
      recruits.push({
        tags: match[1],
        stars: match[2]
      });
    }
    if (recruits.length > 0) {
      summary.recruits = recruits;
    }
  }
  
  // 解析基建总结
  if (output.includes('Infrast')) {
    const infrastMatch = output.match(/Infrast[:\s]+([^\n]+)/i);
    if (infrastMatch) {
      summary.infrast = infrastMatch[1].trim();
    }
  }
  
  logger.debug('任务总结解析结果', { summary });
  
  return Object.keys(summary).length > 1 ? summary : null;
}

// 创建或更新定时任务
export function setupSchedule(scheduleId, times, taskFlow) {
  // 先停止已存在的任务（静默停止，不输出日志）
  const existingJobs = scheduledJobs.get(scheduleId);
  if (existingJobs) {
    existingJobs.forEach(({ job }) => job.stop());
    scheduledJobs.delete(scheduleId);
  }
  
  if (!times || times.length === 0) {
    return { success: false, message: '没有设置执行时间' };
  }
  
  const jobs = [];
  const failedTimes = [];
  
  times.forEach((time, index) => {
    if (!time) return;
    
    // 解析时间 (HH:MM)
    const [hour, minute] = time.split(':');
    if (!hour || !minute) return;
    
    // 创建 cron 表达式: 分 时 * * *
    const cronExpression = `${minute} ${hour} * * *`;
    
    try {
      const job = cron.schedule(cronExpression, () => {
        logger.info('定时任务触发执行', { scheduleId: `${scheduleId}-${index}`, time });
        executeTaskFlow(taskFlow, `${scheduleId}-${index}`);
      }, {
        scheduled: true,
        timezone: "Asia/Shanghai"
      });
      
      jobs.push({ time, job });
    } catch (error) {
      failedTimes.push(time);
      logger.error('定时任务设置失败', { 
        scheduleId: `${scheduleId}-${index}`, 
        time,
        error: error.message 
      });
    }
  });
  
  if (jobs.length > 0) {
    scheduledJobs.set(scheduleId, jobs);
    logger.info('定时任务已设置', { 
      scheduleId, 
      count: jobs.length,
      times: jobs.map(j => j.time).join(', ')
    });
    return { 
      success: true, 
      message: `已设置 ${jobs.length} 个定时任务`,
      times: jobs.map(j => j.time)
    };
  }
  
  return { success: false, message: '没有成功设置任何定时任务' };
}

// 停止定时任务
export function stopSchedule(scheduleId) {
  const jobs = scheduledJobs.get(scheduleId);
  if (jobs) {
    jobs.forEach(({ job }) => job.stop());
    scheduledJobs.delete(scheduleId);
    logger.debug('定时任务已停止', { 
      scheduleId, 
      count: jobs.length,
      times: jobs.map(j => j.time).join(', ')
    });
    return { success: true, message: '定时任务已停止' };
  }
  return { success: false, message: '没有找到该定时任务' };
}

// 获取所有定时任务状态
export function getScheduleStatus() {
  const status = [];
  scheduledJobs.forEach((jobs, scheduleId) => {
    status.push({
      scheduleId,
      times: jobs.map(j => j.time),
      count: jobs.length
    });
  });
  return status;
}

// 立即执行一次定时任务（用于测试）
export async function executeScheduleNow(scheduleId, taskFlow) {
  logger.info('手动触发执行', { scheduleId });
  await executeTaskFlow(taskFlow, scheduleId);
  return { success: true, message: '任务执行完成' };
}

// 自动更新任务
export function setupAutoUpdate(config) {
  const { enabled, time, updateCore, updateCli } = config;
  
  // 先停止已存在的自动更新任务（静默停止）
  const existingJobs = scheduledJobs.get('auto-update');
  if (existingJobs) {
    existingJobs.forEach(({ job }) => job.stop());
    scheduledJobs.delete('auto-update');
  }
  
  if (!enabled || !time) {
    return { success: false, message: '自动更新未启用' };
  }
  
  // 解析时间 (HH:MM)
  const [hour, minute] = time.split(':');
  if (!hour || !minute) {
    return { success: false, message: '时间格式错误' };
  }
  
  // 创建 cron 表达式: 分 时 * * *
  const cronExpression = `${minute} ${hour} * * *`;
  
  try {
    const job = cron.schedule(cronExpression, async () => {
      logger.info('自动更新触发执行', { time });
      
      try {
        if (updateCore) {
          logger.info('开始更新 MaaCore');
          await execMaaCommand('update', []);
          logger.success('MaaCore 更新完成');
        }
        
        if (updateCli) {
          logger.info('开始更新 MAA CLI');
          
          // 检查是否在 Docker 环境
          const isDocker = process.env.NODE_ENV === 'production' && 
                           await execAsync('test -f /.dockerenv').then(() => true).catch(() => false);
          
          if (isDocker) {
            // Docker 环境：支持更新，更新会持久化
            try {
              await execAsync(`${MAA_CLI_PATH} self update`);
              logger.success('MAA CLI 更新完成', { environment: 'Docker', persistent: true });
            } catch (error) {
              logger.error('MAA CLI 更新失败', { error: error.message });
            }
          } else {
            // 根据操作系统选择更新方式
            const os = await import('os');
            const platform = os.platform();
            let command;
            
            if (platform === 'darwin') {
              command = 'brew upgrade maa-cli';
            } else if (platform === 'linux' || platform === 'win32') {
              command = `${MAA_CLI_PATH} self update`;
            } else {
              throw new Error(`不支持的操作系统: ${platform}`);
            }
            
            await execAsync(command);
            logger.success('MAA CLI 更新完成', { platform });
          }
        }
        
        logger.success('所有自动更新任务完成');
      } catch (error) {
        logger.error('自动更新失败', { error: error.message });
      }
    }, {
      scheduled: true,
      timezone: "Asia/Shanghai"
    });
    
    scheduledJobs.set('auto-update', [{ time, job }]);
    logger.info('自动更新已设置', { time });
    
    return { 
      success: true, 
      message: `自动更新已设置，每天 ${time} 执行`,
      config
    };
  } catch (error) {
    logger.error('自动更新设置失败', { error: error.message });
    return { success: false, message: `设置失败: ${error.message}` };
  }
}

// 获取自动更新状态
export function getAutoUpdateStatus() {
  const jobs = scheduledJobs.get('auto-update');
  if (jobs && jobs.length > 0) {
    return {
      enabled: true,
      time: jobs[0].time
    };
  }
  return {
    enabled: false,
    time: null
  };
}

/**
 * 动态更新智能养成关卡
 * 在任务执行完成后，重新生成刷取计划并更新任务流程
 */
async function updateSmartTrainingStages(scheduleId) {
  logger.info('智能养成开始动态更新关卡', { scheduleId });
  
  try {
    // 1. 加载当前的任务流程配置
    const configResult = await loadUserConfig('automation-tasks');
    if (!configResult.success || !configResult.data || !configResult.data.taskFlow) {
      logger.info('智能养成未找到任务流程配置，跳过更新', { scheduleId });
      return;
    }
    
    const { taskFlow } = configResult.data;
    
    // 2. 查找包含智能养成关卡的任务
    let hasSmartStages = false;
    let fightTaskIndex = -1;
    
    for (let i = 0; i < taskFlow.length; i++) {
      const task = taskFlow[i];
      if (task.commandId === 'fight' && task.params && task.params.stages) {
        const stages = task.params.stages;
        const smartStages = stages.filter(s => typeof s === 'object' && s.smart);
        if (smartStages.length > 0) {
          hasSmartStages = true;
          fightTaskIndex = i;
          break;
        }
      }
    }
    
    if (!hasSmartStages) {
      logger.info('智能养成未找到智能养成关卡，跳过更新', { scheduleId });
      return;
    }
    
    logger.info('智能养成找到智能养成关卡，开始重新生成刷取计划', { scheduleId });
    
    // 3. 加载养成队列
    const queueResult = await loadUserConfig('training-queue');
    if (!queueResult.success || !queueResult.data || !queueResult.data.queue || queueResult.data.queue.length === 0) {
      logger.info('智能养成队列为空，移除所有智能养成关卡', { scheduleId });
      
      // 移除所有智能养成关卡
      const task = taskFlow[fightTaskIndex];
      const newStages = task.params.stages.filter(s => !(typeof s === 'object' && s.smart));
      task.params.stages = newStages.length > 0 ? newStages : [{ stage: '', times: '' }];
      
      // 保存更新后的配置
      await saveUserConfig('automation-tasks', { taskFlow, schedule: configResult.data.schedule });
      logger.success('智能养成已移除所有智能养成关卡', { scheduleId });
      return;
    }
    
    // 4. 重新生成刷取计划（仅当前干员）
    const plan = await operatorTrainingService.generateTrainingPlan('current');
    if (!plan || !plan.stages) {
      logger.warn('智能养成生成刷取计划失败', { scheduleId });
      return;
    }
    
    // 5. 检查是否还有需要刷的关卡
    if (plan.stages.length === 0) {
      logger.info('智能养成当前干员材料已集齐，检查是否需要切换到下一个干员', { scheduleId });
      
      // 6. 自动切换到下一个干员
      const queue = queueResult.data.queue;
      if (queue.length > 1) {
        // 移除第一个干员（已完成）
        const completedOperator = queue.shift();
        await saveUserConfig('training-queue', { queue, settings: queueResult.data.settings });
        logger.success('智能养成已切换到下一个干员', { 
          scheduleId, 
          completedOperator: completedOperator.name,
          nextOperator: queue[0].name 
        });
        
        // 重新生成刷取计划
        const newPlan = await operatorTrainingService.generateTrainingPlan('current');
        if (newPlan && newPlan.stages && newPlan.stages.length > 0) {
          const trainingOperatorNames = newPlan.operators && newPlan.operators.length > 0
            ? newPlan.operators.map(op => op.name)
            : [];
          
          // 更新智能养成关卡
          const newSmartStages = newPlan.stages.map(stage => ({
            stage: stage.stage,
            times: stage.totalTimes.toString(),
            smart: true,
            trainingOperators: trainingOperatorNames
          }));
          
          // 替换智能养成关卡
          const task = taskFlow[fightTaskIndex];
          const pinnedStages = task.params.stages.filter(s => typeof s === 'object' && s.pinned && s.stage && s.stage.trim());
          const normalStages = task.params.stages.filter(s => 
            (typeof s === 'string' && s.trim()) || 
            (typeof s === 'object' && !s.pinned && !s.smart && s.stage && s.stage.trim())
          );
          
          task.params.stages = [...pinnedStages, ...newSmartStages, ...normalStages];
          
          // 保存更新后的配置
          await saveUserConfig('automation-tasks', { taskFlow, schedule: configResult.data.schedule });
          logger.success('智能养成已更新智能养成关卡', { 
            scheduleId,
            operators: trainingOperatorNames,
            stageCount: newSmartStages.length 
          });
        } else {
          // 新干员也没有需要刷的材料，移除智能养成关卡
          const task = taskFlow[fightTaskIndex];
          const newStages = task.params.stages.filter(s => !(typeof s === 'object' && s.smart));
          task.params.stages = newStages.length > 0 ? newStages : [{ stage: '', times: '' }];
          
          await saveUserConfig('automation-tasks', { taskFlow, schedule: configResult.data.schedule });
          logger.info('智能养成新干员也无需刷取材料，已移除所有智能养成关卡', { scheduleId });
        }
      } else {
        // 队列中只有一个干员且已完成，移除智能养成关卡
        logger.info('智能养成队列已全部完成，移除所有智能养成关卡', { scheduleId });
        
        const task = taskFlow[fightTaskIndex];
        const newStages = task.params.stages.filter(s => !(typeof s === 'object' && s.smart));
        task.params.stages = newStages.length > 0 ? newStages : [{ stage: '', times: '' }];
        
        await saveUserConfig('automation-tasks', { taskFlow, schedule: configResult.data.schedule });
        logger.success('智能养成已移除所有智能养成关卡', { scheduleId });
      }
    } else {
      // 7. 还有关卡需要刷，更新关卡和次数
      logger.info('智能养成更新剩余关卡', { 
        scheduleId, 
        stageCount: plan.stages.length 
      });
      
      const trainingOperatorNames = plan.operators && plan.operators.length > 0
        ? plan.operators.map(op => op.name)
        : [];
      
      const newSmartStages = plan.stages.map(stage => ({
        stage: stage.stage,
        times: stage.totalTimes.toString(),
        smart: true,
        trainingOperators: trainingOperatorNames
      }));
      
      // 替换智能养成关卡
      const task = taskFlow[fightTaskIndex];
      const pinnedStages = task.params.stages.filter(s => typeof s === 'object' && s.pinned && s.stage && s.stage.trim());
      const normalStages = task.params.stages.filter(s => 
        (typeof s === 'string' && s.trim()) || 
        (typeof s === 'object' && !s.pinned && !s.smart && s.stage && s.stage.trim())
      );
      
      task.params.stages = [...pinnedStages, ...newSmartStages, ...normalStages];
      
      // 保存更新后的配置
      await saveUserConfig('automation-tasks', { taskFlow, schedule: configResult.data.schedule });
      logger.success('智能养成已更新智能养成关卡', { 
        scheduleId,
        stages: newSmartStages.map(s => `${s.stage}×${s.times}`)
      });
    }
    
  } catch (error) {
    logger.error('智能养成动态更新失败', { scheduleId, error: error.message });
    throw error;
  }
}
