import express from 'express';
import { execMaaCommand, getMaaVersion, getMaaConfigDir, getConfig, saveConfig, execDynamicTask, captureScreen, getDebugScreenshots, getTaskStatus, getCurrentActivity, replaceActivityCode, stopCurrentTask, getLogFiles, readLogFile, getRealtimeLogs, clearRealtimeLogs, cleanupLogs, testAdbConnection } from '../services/maaService.js';
import { setupSchedule, stopSchedule, getScheduleStatus, executeScheduleNow, setupAutoUpdate, getAutoUpdateStatus, getScheduleExecutionStatus, stopScheduleExecution } from '../services/schedulerService.js';
import { saveUserConfig, loadUserConfig, getAllUserConfigs, deleteUserConfig } from '../services/configStorageService.js';
import { parseDepotData, parseOperBoxData, getDepotData, getOperBoxData, getAllOperators } from '../services/dataParserService.js';
import { getTodayDrops, getRecentDrops, getDropStatistics } from '../services/dropRecordService.js';
import { asyncHandler, successResponse, errorResponse } from '../utils/apiHelper.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const logger = createLogger('MaaRoutes');

// 检查关卡是否今日开放的辅助函数
function isStageOpenToday(stage) {
  // 这个函数的实现需要从 maaService 导入
  // 暂时返回默认值
  return { isOpen: true, reason: '' };
}

// 获取任务执行状态
router.get('/task-status', asyncHandler(async (req, res) => {
  const status = getTaskStatus();
  res.json(successResponse(status));
}));

// 获取实时日志
router.get('/realtime-logs', asyncHandler(async (req, res) => {
  const { lines = 100 } = req.query;
  const logs = getRealtimeLogs(parseInt(lines));
  res.json(successResponse(logs));
}));

// 清空实时日志
router.post('/realtime-logs/clear', asyncHandler(async (req, res) => {
  clearRealtimeLogs();
  res.json(successResponse(null, '实时日志已清空'));
}));

// 终止当前任务
router.post('/stop-task', asyncHandler(async (req, res) => {
  // 1. 停止当前正在运行的 MAA 命令
  const taskStopped = stopCurrentTask();
  
  // 2. 停止整个定时任务流程
  const scheduleStopped = stopScheduleExecution();
  
  if (taskStopped || scheduleStopped) {
    const message = taskStopped && scheduleStopped 
      ? '已终止当前任务并停止任务流程' 
      : taskStopped 
        ? '已终止当前任务' 
        : '已设置停止标志，将在当前任务完成后终止流程';
    res.json(successResponse(null, message));
  } else {
    res.json(errorResponse('没有正在运行的任务'));
  }
}));

// 获取 MAA 版本信息
router.get('/version', asyncHandler(async (req, res) => {
  // 健康检查请求不输出日志
  const isHealthCheck = req.headers['user-agent']?.includes('curl');
  const version = await getMaaVersion(isHealthCheck);
  res.json(successResponse(version));
}));

// 获取配置目录
router.get('/config-dir', asyncHandler(async (req, res) => {
  const configDir = await getMaaConfigDir();
  res.json(successResponse(configDir));
}));

// 获取配置
router.get('/config/:profileName', asyncHandler(async (req, res) => {
  const { profileName } = req.params;
  const config = await getConfig(profileName);
  res.json(successResponse(config));
}));

// 保存配置
router.post('/config/:profileName', asyncHandler(async (req, res) => {
  const { profileName } = req.params;
  const config = req.body;
  await saveConfig(profileName, config);
  res.json(successResponse(null, '配置保存成功'));
}));

// 执行 MAA 命令
router.post('/execute', asyncHandler(async (req, res) => {
  let { command, args = [], taskConfig, taskName, taskType, waitForCompletion = false } = req.body;
  
  logger.debug('收到执行请求', { command, argsCount: args.length, hasTaskConfig: !!taskConfig });
  
  // 对于需要交互式输入的命令，自动添加 --batch 参数
  const batchCommands = ['copilot', 'ssscopilot', 'paradoxcopilot'];
  if (batchCommands.includes(command) && !args.includes('--batch')) {
    args.unshift('--batch');
    logger.debug('添加 --batch 参数', { command });
  }
  
  // 如果是 fight 命令，检查并替换活动代号，并检查资源本是否开放
  if (command === 'fight' && args.length > 0) {
    const stageInput = args[0];
    logger.debug('处理 fight 命令', { originalStage: stageInput });
    
    const stages = stageInput.split(',').map(s => s.trim()).filter(s => s);
    
    if (stages.length > 1) {
      logger.debug('检测到多个关卡', { stages });
      const validStages = [];
      
      for (const stage of stages) {
        const { isStageOpenToday } = await import('../services/notificationService.js');
        const openCheck = isStageOpenToday(stage);
        if (!openCheck.isOpen) {
          logger.debug('关卡未开放，跳过', { stage, reason: openCheck.reason });
          continue;
        }
        
        const clientType = 'Official';
        const realStage = await replaceActivityCode(stage, clientType);
        validStages.push(realStage);
        
        if (realStage !== stage) {
          logger.debug('关卡代号已替换', { from: stage, to: realStage });
        }
      }
      
      if (validStages.length === 0) {
        return res.json(errorResponse(
          new Error('所有关卡今日均未开放'),
          '所有关卡今日均未开放，已全部跳过'
        ));
      }
      
      args[0] = validStages.join(',');
      logger.debug('有效关卡列表', { validStages: args[0] });
    } else {
      const stage = stages[0];
      
      const { isStageOpenToday } = await import('../services/notificationService.js');
      const openCheck = isStageOpenToday(stage);
      if (!openCheck.isOpen) {
        logger.debug('关卡未开放', { stage, reason: openCheck.reason });
        return res.json(errorResponse(
          new Error(openCheck.reason),
          `${openCheck.reason}，已跳过`
        ));
      }
      
      const clientType = 'Official';
      const realStage = await replaceActivityCode(stage, clientType);
      if (realStage !== stage) {
        args[0] = realStage;
        logger.debug('关卡代号已替换', { from: stage, to: realStage });
      }
    }
  }
  
  logger.debug('执行命令', { command, args });
  
  // 如果有 taskConfig，说明是动态任务，需要创建临时文件
  if (taskConfig) {
    const taskId = args[0];
    const result = await execDynamicTask(taskId, taskConfig, taskName, taskType, waitForCompletion);
    res.json(successResponse(result));
  } else {
    const result = await execMaaCommand(command, args, taskName, taskType, waitForCompletion);
    res.json(successResponse(result));
  }
}));

// 获取当前活动信息
router.get('/activity', asyncHandler(async (req, res) => {
  const { clientType = 'Official' } = req.query;
  const activityInfo = await getCurrentActivity(clientType);
  res.json(successResponse({ 
    code: activityInfo.code,
    name: activityInfo.name,
    available: !!activityInfo.code,
    message: activityInfo.code 
      ? `当前活动: ${activityInfo.name || activityInfo.code}` 
      : '当前没有活动或无法获取活动信息'
  }));
}));

// 获取模拟器截图 (GET)
router.get('/screenshot', asyncHandler(async (req, res) => {
  const { adbPath, address } = req.query;
  const screenshot = await captureScreen(adbPath, address);
  res.json({ success: true, screenshot });
}));

// 获取模拟器截图 (POST)
router.post('/screenshot', asyncHandler(async (req, res) => {
  const { adbPath, address } = req.body;
  const screenshot = await captureScreen(adbPath, address);
  res.json({ success: true, data: screenshot });
}));

// 测试 ADB 连接
router.post('/test-connection', asyncHandler(async (req, res) => {
  const { adbPath, address } = req.body;
  const result = await testAdbConnection(adbPath, address);
  res.json(result);
}));

// 获取 MAA 调试截图列表
router.get('/debug-screenshots', asyncHandler(async (req, res) => {
  const screenshots = await getDebugScreenshots();
  res.json(successResponse(screenshots));
}));

// 设置定时任务
router.post('/schedule', asyncHandler(async (req, res) => {
  const { scheduleId = 'default', times, taskFlow } = req.body;
  const result = setupSchedule(scheduleId, times, taskFlow);
  res.json(result);
}));

// 停止定时任务
router.delete('/schedule/:scheduleId', asyncHandler(async (req, res) => {
  const { scheduleId } = req.params;
  const result = stopSchedule(scheduleId);
  res.json(result);
}));

// 获取定时任务状态
router.get('/schedule/status', asyncHandler(async (req, res) => {
  const status = getScheduleStatus();
  res.json(successResponse(status));
}));

// 获取定时任务执行状态
router.get('/schedule/execution-status', asyncHandler(async (req, res) => {
  const status = getScheduleExecutionStatus();
  res.json(successResponse(status));
}));

// 立即执行定时任务（测试用）
router.post('/schedule/:scheduleId/execute', asyncHandler(async (req, res) => {
  const { scheduleId } = req.params;
  const { taskFlow } = req.body;
  const result = await executeScheduleNow(scheduleId, taskFlow);
  res.json(result);
}));

// 获取日志文件列表
router.get('/logs', asyncHandler(async (req, res) => {
  const files = await getLogFiles();
  res.json(successResponse(files));
}));

// 读取日志文件内容
router.get('/logs/:filePath(*)', asyncHandler(async (req, res) => {
  const { filePath } = req.params;
  const { lines = 1000 } = req.query;
  const decodedPath = decodeURIComponent(filePath);
  const result = await readLogFile(decodedPath, parseInt(lines));
  res.json(successResponse(result));
}));

// 手动清理日志文件
router.post('/logs/cleanup', asyncHandler(async (req, res) => {
  const { maxSizeMB = 10 } = req.body;
  const result = await cleanupLogs(maxSizeMB);
  res.json(successResponse(
    result,
    `已清理 ${result.deletedCount} 个日志文件，释放 ${(result.freedSpace / 1024 / 1024).toFixed(2)} MB 空间`
  ));
}));

// 更新 MaaCore
router.post('/update-core', asyncHandler(async (req, res) => {
  const result = await execMaaCommand('update', []);
  res.json(successResponse(result));
}));

// 更新 MAA CLI
router.post('/update-cli', asyncHandler(async (req, res) => {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const os = await import('os');
  const execAsync = promisify(exec);
  
  const MAA_CLI_PATH = process.env.MAA_CLI_PATH || (process.env.DOCKER_ENV ? '/usr/local/bin/maa' : 'maa');
  
  const isDocker = process.env.NODE_ENV === 'production' && 
                   await execAsync('test -f /.dockerenv').then(() => true).catch(() => false);
  
  if (isDocker) {
    const { stdout, stderr } = await execAsync(`${MAA_CLI_PATH} self update`);
    res.json(successResponse(
      { output: stdout || stderr },
      'MAA CLI 更新完成（Docker 环境）\n更新已持久化到 volume，重启容器后仍然有效'
    ));
  } else {
    const platform = os.platform();
    let command;
    
    if (platform === 'darwin') {
      command = 'brew upgrade maa-cli';
    } else if (platform === 'linux' || platform === 'win32') {
      command = `${MAA_CLI_PATH} self update`;
    } else {
      throw new Error(`不支持的操作系统: ${platform}`);
    }
    
    const { stdout, stderr } = await execAsync(command);
    res.json(successResponse(
      { output: stdout || stderr },
      `MAA CLI 更新完成 (${platform})`
    ));
  }
}));

// 设置自动更新
router.post('/auto-update', asyncHandler(async (req, res) => {
  const config = req.body;
  const result = setupAutoUpdate(config);
  res.json(result);
}));

// 获取自动更新状态
router.get('/auto-update/status', asyncHandler(async (req, res) => {
  const status = getAutoUpdateStatus();
  res.json(successResponse(status));
}));

// ========== 用户配置存储 API ==========

// 保存用户配置
router.post('/user-config/:configType', asyncHandler(async (req, res) => {
  const { configType } = req.params;
  const data = req.body;
  const result = await saveUserConfig(configType, data);
  res.json(result);
}));

// 读取用户配置
router.get('/user-config/:configType', asyncHandler(async (req, res) => {
  const { configType } = req.params;
  const result = await loadUserConfig(configType);
  res.json(result);
}));

// 获取所有用户配置
router.get('/user-configs', asyncHandler(async (req, res) => {
  const result = await getAllUserConfigs();
  res.json(result);
}));

// 删除用户配置
router.delete('/user-config/:configType', asyncHandler(async (req, res) => {
  const { configType } = req.params;
  const result = await deleteUserConfig(configType);
  res.json(result);
}));

// ========== 数据统计 API ==========

// 解析并保存仓库数据
router.post('/data/depot/parse', asyncHandler(async (req, res) => {
  const result = await parseDepotData();
  if (result) {
    res.json(successResponse(
      {
        path: result.path,
        itemCount: result.itemCount,
        items: result.items || []
      },
      `仓库数据已保存，共 ${result.itemCount} 种物品`
    ));
  } else {
    res.json(errorResponse(
      new Error('未找到仓库识别数据'),
      '未找到仓库识别数据，请先执行仓库识别任务'
    ));
  }
}));

// 解析并保存干员数据
router.post('/data/operbox/parse', asyncHandler(async (req, res) => {
  const result = await parseOperBoxData();
  if (result) {
    res.json(successResponse(
      {
        path: result.path,
        operCount: result.operCount
      },
      `干员数据已保存，共 ${result.operCount} 名干员`
    ));
  } else {
    res.json(errorResponse(
      new Error('未找到干员识别数据'),
      '未找到干员识别数据，请先执行干员识别任务'
    ));
  }
}));

// 获取已保存的仓库数据
router.get('/data/depot', asyncHandler(async (req, res) => {
  const data = await getDepotData();
  if (data) {
    res.json(successResponse(data));
  } else {
    res.json(errorResponse(new Error('暂无仓库数据')));
  }
}));

// 获取已保存的干员数据
router.get('/data/operbox', asyncHandler(async (req, res) => {
  const data = await getOperBoxData();
  if (data) {
    res.json(successResponse(data));
  } else {
    res.json(errorResponse(new Error('暂无干员数据')));
  }
}));

// 获取所有干员列表
router.get('/data/all-operators', asyncHandler(async (req, res) => {
  const operators = await getAllOperators();
  res.json(successResponse(operators));
}));

// 图片代理接口 - 干员头像
router.get('/operator-avatar/:charId', asyncHandler(async (req, res) => {
  const { charId } = req.params;
  
  const imageUrls = [
    `https://raw.githubusercontent.com/Aceship/Arknight-Images/main/avatars/${charId}.png`,
    `https://cdn.jsdelivr.net/gh/Aceship/Arknight-Images@main/avatars/${charId}.png`,
    `https://raw.githubusercontent.com/yuanyan3060/Arknights-Bot-Resource/main/avatars/${charId}.png`
  ];
  
  let imageData = null;
  let contentType = 'image/png';
  const https = await import('https');
  
  for (const url of imageUrls) {
    try {
      await new Promise((resolve, reject) => {
        https.get(url, { timeout: 5000 }, (response) => {
          if (response.statusCode === 200) {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => {
              imageData = Buffer.concat(chunks);
              contentType = response.headers['content-type'] || 'image/png';
              resolve();
            });
          } else {
            reject(new Error(`HTTP ${response.statusCode}`));
          }
        }).on('error', reject).on('timeout', () => {
          reject(new Error('Timeout'));
        });
      });
      
      if (imageData) break;
    } catch (err) {
      logger.debug('图片获取失败', { url, error: err.message });
      continue;
    }
  }
  
  if (imageData) {
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(imageData);
  } else {
    res.status(404).json(errorResponse(new Error('图片未找到')));
  }
}));

// 图片代理接口 - 物品图标
router.get('/item-icon/:iconId', asyncHandler(async (req, res) => {
  const { iconId } = req.params;
  const url = `https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/refs/heads/main/item/${iconId}.png`;
  const https = await import('https');
  
  await new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: 10000 }, (response) => {
      if (response.statusCode === 200) {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const imageData = Buffer.concat(chunks);
          const contentType = response.headers['content-type'] || 'image/png';
          res.set('Content-Type', contentType);
          res.set('Cache-Control', 'public, max-age=86400');
          res.send(imageData);
          resolve();
        });
      } else {
        reject(new Error(`HTTP ${response.statusCode}`));
      }
    });
    
    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Timeout'));
    });
  });
}));

// 代理 PRTS 作业 API（解决 CORS 问题）
router.get('/copilot/get/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const response = await fetch(`https://prts.maa.plus/copilot/get/${id}`);
  const data = await response.json();
  res.json(data);
}));

// 搜索悖论模拟作业
router.get('/paradox/search', asyncHandler(async (req, res) => {
  const { name } = req.query;
  
  if (!name) {
    return res.status(400).json(errorResponse(new Error('请提供干员名字')));
  }
  
  const fs = await import('fs/promises');
  const path = await import('path');
  const { fileURLToPath } = await import('url');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  
  const paradoxFile = path.join(__dirname, '../data/paradox-operators.json');
  const paradoxData = JSON.parse(await fs.readFile(paradoxFile, 'utf-8'));
  
  const operator = paradoxData.find(op => op.name.includes(name) || name.includes(op.name));
  
  if (!operator) {
    return res.json(errorResponse(
      new Error(`未找到干员"${name}"的悖论模拟关卡`),
      `未找到干员"${name}"的悖论模拟关卡`
    ));
  }
  
  const stageKeyword = operator.stage_id.replace('mem_', '').replace('_1', '');
  const response = await fetch(`https://prts.maa.plus/copilot/query?level_keyword=${stageKeyword}&page=1&limit=10&order_by=hot`);
  const data = await response.json();
  
  if (data.status_code === 200 && data.data && data.data.data && data.data.data.length > 0) {
    const copilots = data.data.data.map(item => ({
      id: item.id,
      uri: `maa://${item.id}`,
      views: item.views,
      hotScore: item.hot_score,
      uploader: item.uploader_id,
      title: item.doc?.title || '无标题'
    }));
    
    res.json(successResponse({
      operator: operator.name,
      stageId: operator.stage_id,
      copilots,
      recommended: copilots[0]
    }));
  } else {
    res.json(errorResponse(
      new Error(`未找到干员"${operator.name}"的作业`),
      `未找到干员"${operator.name}"的作业`
    ));
  }
}));

// 搜索普通关卡作业
router.get('/copilot/search', asyncHandler(async (req, res) => {
  const { stage } = req.query;
  
  if (!stage) {
    return res.status(400).json(errorResponse(new Error('请提供关卡名称')));
  }
  
  const response = await fetch(`https://prts.maa.plus/copilot/query?level_keyword=${encodeURIComponent(stage)}&page=1&limit=10&order_by=hot`);
  const data = await response.json();
  
  if (data.status_code === 200 && data.data && data.data.data && data.data.data.length > 0) {
    const copilots = data.data.data.map(item => ({
      id: item.id,
      uri: `maa://${item.id}`,
      views: item.views,
      hotScore: item.hot_score,
      uploader: item.uploader_id,
      title: item.doc?.title || '无标题',
      stageName: item.stage_name || stage
    }));
    
    res.json(successResponse({
      stage: stage,
      copilots,
      recommended: copilots[0]
    }));
  } else {
    res.json(errorResponse(
      new Error(`未找到关卡"${stage}"的作业`),
      `未找到关卡"${stage}"的作业`
    ));
  }
}));

// 获取所有悖论模拟干员列表
router.get('/paradox/operators', asyncHandler(async (req, res) => {
  const fs = await import('fs/promises');
  const path = await import('path');
  const { fileURLToPath } = await import('url');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  
  const paradoxFile = path.join(__dirname, '../data/paradox-operators.json');
  const paradoxData = JSON.parse(await fs.readFile(paradoxFile, 'utf-8'));
  
  res.json(successResponse(paradoxData));
}));

// ==================== 掉落记录 API ====================

// 获取今日掉落记录
router.get('/drops/today', asyncHandler(async (req, res) => {
  const result = await getTodayDrops();
  res.json(result);
}));

// 获取最近几天的掉落记录
router.get('/drops/recent', asyncHandler(async (req, res) => {
  const { days = 7 } = req.query;
  const result = await getRecentDrops(parseInt(days));
  res.json(result);
}));

// 获取掉落统计数据
router.get('/drops/statistics', asyncHandler(async (req, res) => {
  const { days = 7 } = req.query;
  const result = await getDropStatistics(parseInt(days));
  res.json(result);
}));

export default router;
