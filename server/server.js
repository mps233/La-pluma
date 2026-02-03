import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import maaRoutes from './routes/maa.js';
import notificationRoutes from './routes/notification.js';
import { setSocketIO } from './services/schedulerService.js';
import { networkInterfaces } from 'os';
import { printPathConfig } from './config/paths.js';

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

// 允许的来源列表
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174', 
  'http://localhost:5175',
  `http://${localIp}:5173`,
  `http://${localIp}:5174`,
  `http://${localIp}:5175`
];

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST']
  }
});

app.use(cors({
  origin: (origin, callback) => {
    // 允许没有 origin 的请求（比如移动应用、Postman 等）
    if (!origin) return callback(null, true);
    
    // 检查是否在允许列表中，或者是否来自本地网络
    if (allowedOrigins.includes(origin) || origin.match(/^http:\/\/192\.168\.\d+\.\d+:517[3-5]$/)) {
      callback(null, true);
    } else {
      callback(null, true); // 开发环境允许所有来源
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.use(express.json());

// API 路由
app.use('/api/maa', maaRoutes);
app.use('/api/notification', notificationRoutes);

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
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`服务器运行在:`);
  console.log(`  - 本地: http://localhost:${PORT}`);
  console.log(`  - 网络: http://${localIp}:${PORT}`);
  console.log(`\n手机访问请使用: http://${localIp}:5173`);
  console.log('');
  printPathConfig();
});

export { io };

