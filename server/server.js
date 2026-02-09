import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import maaRoutes from './routes/maa.js';
import notificationRoutes, { loadConfig as loadNotificationConfig } from './routes/notification.js';
import operatorTrainingRoutes from './routes/operatorTraining.js';
import { setSocketIO } from './services/schedulerService.js';
import { initTelegramBot } from './services/telegramBotService.js';
import { getNotificationConfig } from './services/notificationService.js';
import { networkInterfaces } from 'os';
import { printPathConfig } from './config/paths.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);

// 获取本机 IP 地址
const getLocalIpAddress = () => {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // 跳过内部地址和非 IPv4 地址
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
};

const localIp = getLocalIpAddress();

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE']
}));
app.use(express.json());

// 生产环境：服务前端静态文件
if (process.env.NODE_ENV === 'production') {
  const { fileURLToPath } = await import('url');
  const { dirname, join } = await import('path');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const clientDistPath = join(__dirname, '..', 'client', 'dist');
  
  app.use(express.static(clientDistPath));
  
  // 所有非 API 路由都返回 index.html（支持前端路由）
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return next();
    }
    res.sendFile(join(clientDistPath, 'index.html'));
  });
}

// API 路由
app.use('/api/maa', maaRoutes);
app.use('/api/notification', notificationRoutes);
app.use('/api/operator-training', operatorTrainingRoutes);

// WebSocket 连接
io.on('connection', (socket) => {
  console.log('客户端已连接');
  
  socket.on('disconnect', () => {
    console.log('客户端已断开');
  });
});

// 设置 Socket.io 到 schedulerService
setSocketIO(io);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', async () => {
  console.log(`服务器运行在:`);
  console.log(`  - 本地: http://localhost:${PORT}`);
  console.log(`  - 网络: http://${localIp}:${PORT}`);
  console.log('');
  printPathConfig();
  
  // 先加载通知配置
  await loadNotificationConfig();
  
  // 初始化 Telegram Bot
  try {
    const notifConfig = getNotificationConfig();
    if (notifConfig.channels?.telegram) {
      // 尝试从自动化任务配置中读取 ADB 配置
      let adbPath = '/opt/homebrew/bin/adb';
      let adbAddress = '127.0.0.1:16384';
      
      try {
        const { readFile } = await import('fs/promises');
        const { join } = await import('path');
        const configPath = join(__dirname, 'data/user-configs/automation-tasks.json');
        const configData = await readFile(configPath, 'utf-8');
        const config = JSON.parse(configData);
        
        // 从启动游戏任务中获取 ADB 配置
        const startupTask = config.taskFlow?.find(t => t.commandId === 'startup');
        if (startupTask?.params) {
          adbPath = startupTask.params.adbPath || adbPath;
          adbAddress = startupTask.params.address || adbAddress;
        }
      } catch (error) {
        console.log('[Telegram Bot] 无法读取 ADB 配置，使用默认值');
      }
      
      initTelegramBot({
        enabled: notifConfig.channels.telegram.enabled,
        botToken: notifConfig.channels.telegram.botToken,
        chatId: notifConfig.channels.telegram.chatId,
        adbPath,
        adbAddress
      });
    }
  } catch (error) {
    console.error('[Telegram Bot] 初始化失败:', error.message);
  }
});

export { io };

