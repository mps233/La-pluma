import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { printPathConfig } from './config/paths.js';
import operatorQuotesRoutes from './routes/operatorQuotes.js';
import agentRoutes from './routes/agent.js';
import {
  getAgentRunStoreStatus,
  initializeAgentRunStore
} from './services/agentRunService.js';
import { initializeRuntimeState } from './services/runtimeInitializationService.js';
import {
  createWebrtcSignalingGateway,
  WEBRTC_SIGNALING_PATH
} from './services/webrtcSignalingGateway.js';
import { agentError, sendError } from './utils/apiHelper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getLocalIpAddress() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

export function normalizeBasePath(value = '/') {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed === '/') return '/';
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${withLeadingSlash.replace(/\/+$/, '')}/`;
}

export function createOptionalApiAuth(apiToken = '') {
  return function optionalApiAuth(req, res, next) {
    if (!apiToken) return next();

    const authHeader = req.headers.authorization || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const headerToken = req.headers['x-la-pluma-token'];

    if (bearerToken === apiToken || headerToken === apiToken) return next();

    res.set('WWW-Authenticate', 'Bearer realm="la-pluma"');
    return sendError(res, req, agentError(
      'AGENT_AUTH_REQUIRED',
      '需要有效的 LA_PLUMA_TOKEN',
      { statusCode: 401, retryable: false }
    ));
  };
}

export function createLaPlumaApp({
  env = process.env,
  signalingGateway = createWebrtcSignalingGateway(),
  clientDistPath = join(__dirname, '..', 'client', 'dist')
} = {}) {
  const app = express();
  const optionalApiAuth = createOptionalApiAuth(env.LA_PLUMA_TOKEN || '');
  const signalingPath = signalingGateway.proxyPath || WEBRTC_SIGNALING_PATH;
  const basePath = normalizeBasePath(env.LA_PLUMA_BASE_PATH);

  // Only ticket issuance is exposed over HTTP. The signaling admin UI and
  // device endpoints remain inaccessible through the public application port.
  app.post(`${signalingPath}/api/login`, optionalApiAuth, signalingGateway.handleLogin);
  app.all(signalingPath, (_req, res) => res.status(404).json({ error: 'Not Found' }));
  app.all(`${signalingPath}/*`, (_req, res) => res.status(404).json({ error: 'Not Found' }));

  app.use(cors({
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }));
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ success: true, status: 'ok' });
  });

  if (env.NODE_ENV === 'production') {
    const staticMountPath = basePath === '/' ? '/' : basePath.slice(0, -1);
    const reservedPaths = ['/api', '/health', signalingPath];
    const sendAppShell = (req, res, next) => {
      const appPath = staticMountPath === '/'
        ? req.path
        : req.path.slice(staticMountPath.length) || '/';
      if (reservedPaths.some(path => appPath === path || appPath.startsWith(`${path}/`))) {
        return next();
      }
      if (extname(req.path)) return next();
      res.sendFile(join(clientDistPath, 'index.html'));
    };

    app.use(staticMountPath, express.static(clientDistPath));
    if (basePath === '/') app.get('*', sendAppShell);
    else app.get(`${staticMountPath}/*`, sendAppShell);
  }

  app.use('/api', optionalApiAuth);
  app.use('/api/agent', agentRoutes);
  app.use('/api/operator-quotes', operatorQuotesRoutes);
  return app;
}

export function loadHttpsOptions(env = process.env, readFile = readFileSync) {
  const certPath = env.LA_PLUMA_HTTPS_CERT_PATH?.trim();
  const keyPath = env.LA_PLUMA_HTTPS_KEY_PATH?.trim();
  if (!certPath && !keyPath) return null;
  if (!certPath || !keyPath) {
    throw new Error('LA_PLUMA_HTTPS_CERT_PATH 和 LA_PLUMA_HTTPS_KEY_PATH 必须同时配置');
  }
  return {
    cert: readFile(certPath),
    key: readFile(keyPath)
  };
}

export function createLaPlumaTransportServer({
  app,
  signalingGateway,
  env = process.env,
  readFile = readFileSync
}) {
  const httpsOptions = loadHttpsOptions(env, readFile);
  const server = httpsOptions
    ? createHttpsServer(httpsOptions, app)
    : createHttpServer(app);
  signalingGateway.attach(server);

  const close = async () => {
    signalingGateway.close();
    if (!server.listening) return;
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    await new Promise((resolveClose, rejectClose) => {
      server.close(error => error ? rejectClose(error) : resolveClose());
    });
  };

  return {
    server,
    protocol: httpsOptions ? 'https' : 'http',
    close
  };
}

export async function startLaPlumaServer({
  env = process.env,
  host = '0.0.0.0',
  port = Number(env.PORT || 3000),
  signalingGateway = createWebrtcSignalingGateway(),
  initializeRunStore = initializeAgentRunStore,
  initializeRuntime = initializeRuntimeState,
  logger = console
} = {}) {
  const app = createLaPlumaApp({ env, signalingGateway });
  const transport = createLaPlumaTransportServer({ app, signalingGateway, env });

  try {
    const summary = await initializeRunStore();
    logger.log('[AgentRun] 存储已就绪:', {
      filePath: summary.filePath,
      restoredRuns: summary.restoredRuns,
      interruptedRuns: summary.interruptedRuns,
      prunedRuns: summary.prunedRuns
    });
  } catch (error) {
    const status = getAgentRunStoreStatus();
    logger.error('[AgentRun] 存储初始化失败，执行接口已关闭:', {
      filePath: status.filePath,
      error: status.error || error.message
    });
  }

  try {
    await new Promise((resolveListen, rejectListen) => {
      const onError = error => rejectListen(error);
      transport.server.once('error', onError);
      transport.server.listen(port, host, () => {
        transport.server.off('error', onError);
        resolveListen();
      });
    });
  } catch (error) {
    await transport.close();
    throw error;
  }

  const address = transport.server.address();
  const listeningPort = typeof address === 'object' && address ? address.port : port;
  const localIp = getLocalIpAddress();
  logger.log('服务器运行在:');
  logger.log(`  - 本地: ${transport.protocol}://localhost:${listeningPort}`);
  logger.log(`  - 网络: ${transport.protocol}://${localIp}:${listeningPort}`);
  logger.log('');
  printPathConfig();

  try {
    await initializeRuntime();
  } catch (error) {
    logger.error('[Runtime] 初始化失败:', error.message);
  }

  return { app, ...transport, port: listeningPort };
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === __filename;
if (isMainModule) {
  try {
    const runtime = await startLaPlumaServer();
    let closing = false;
    const shutdown = async () => {
      if (closing) return;
      closing = true;
      await runtime.close().catch(error => console.error('[Server] 关闭失败:', error.message));
      process.exit(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (error) {
    console.error('[Server] 启动失败:', error.message);
    process.exitCode = 1;
  }
}
