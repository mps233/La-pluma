import express from 'express';
import cors from 'cors';
import operatorQuotesRoutes from './routes/operatorQuotes.js';
import agentRoutes from './routes/agent.js';
import { initializeRuntimeState } from './services/runtimeInitializationService.js';
import {
  getAgentRunStoreStatus,
  initializeAgentRunStore
} from './services/agentRunService.js';
import { networkInterfaces } from 'os';
import { printPathConfig } from './config/paths.js';
import { agentError, sendError } from './utils/apiHelper.js';

const app = express();

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

const API_TOKEN = process.env.LA_PLUMA_TOKEN || '';

function optionalApiAuth(req, res, next) {
  if (!API_TOKEN) return next();

  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const headerToken = req.headers['x-la-pluma-token'];

  if (bearerToken === API_TOKEN || headerToken === API_TOKEN) {
    return next();
  }

  res.set('WWW-Authenticate', 'Bearer realm="la-pluma"');
  return sendError(res, req, agentError(
    'AGENT_AUTH_REQUIRED',
    '需要有效的 LA_PLUMA_TOKEN',
    { statusCode: 401, retryable: false }
  ));
}


app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE']
}));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ success: true, status: 'ok' });
});

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
app.use('/api', optionalApiAuth);
app.use('/api/agent', agentRoutes);
app.use('/api/operator-quotes', operatorQuotesRoutes);

const PORT = process.env.PORT || 3000;

// Run 状态必须先恢复并持久化，执行接口才能安全接受新的副作用请求。
// 恢复失败时仍启动 UI 和只读接口；Run 服务会保持 fail-closed。
try {
  const summary = await initializeAgentRunStore();
  console.log('[AgentRun] 存储已就绪:', {
    filePath: summary.filePath,
    restoredRuns: summary.restoredRuns,
    interruptedRuns: summary.interruptedRuns,
    prunedRuns: summary.prunedRuns
  });
} catch (error) {
  const status = getAgentRunStoreStatus();
  console.error('[AgentRun] 存储初始化失败，执行接口已关闭:', {
    filePath: status.filePath,
    error: status.error || error.message
  });
}

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`服务器运行在:`);
  console.log(`  - 本地: http://localhost:${PORT}`);
  console.log(`  - 网络: http://${localIp}:${PORT}`);
  console.log('');
  printPathConfig();
  
  // 恢复持久化的通知、调度和自动更新运行时状态。
  try {
    await initializeRuntimeState();
  } catch (error) {
    console.error('[Runtime] 初始化失败:', error.message);
  }
});
