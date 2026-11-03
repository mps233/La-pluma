import { getErrorMessage } from './utils/errors.ts';
import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { printPathConfig } from './config/paths.ts';
import operatorQuotesRoutes from './routes/operatorQuotes.ts';
import maaAssetsRoutes from './routes/maaAssets.ts';
import agentRoutes from './routes/agent.ts';
import {
  getAgentRunStoreStatus,
  initializeAgentRunStore
} from './services/agentRunService.ts';
import { initializeRuntimeState } from './services/runtimeInitializationService.ts';
import { shutdownBattleOcr } from './services/battleOcrService.ts';
import { cleanupStaleDynamicTaskFiles } from './services/maaService.ts';
import {
  createWebrtcSignalingGateway,
  WEBRTC_SIGNALING_PATH
} from './services/webrtcSignalingGateway.ts';
import { agentError, sendError } from './utils/apiHelper.ts';
import { closeMaaExecutionLeaseAdmission } from './services/executionCoordinatorService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getLocalIpAddress(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    const entries = nets[name];
    if (!entries) continue;
    for (const net of entries) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

export function normalizeBasePath(value: unknown = '/'): string {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed === '/') return '/';
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${withLeadingSlash.replace(/\/+$/, '')}/`;
}

function createOptionalApiAuth(apiToken = ''): express.RequestHandler {
  return function optionalApiAuth(req: Request, res: Response, next: NextFunction) {
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

interface CreateAppOptions {
  env?: NodeJS.ProcessEnv;
  signalingGateway?: ReturnType<typeof createWebrtcSignalingGateway>;
  clientDistPath?: string;
}

export function createLaPlumaApp({
  env = process.env,
  signalingGateway = createWebrtcSignalingGateway(),
  clientDistPath = join(__dirname, '..', 'client', 'dist')
}: CreateAppOptions = {}): Express {
  const app = express();
  const optionalApiAuth = createOptionalApiAuth(env.LA_PLUMA_TOKEN || '');
  const signalingPath = signalingGateway.proxyPath || WEBRTC_SIGNALING_PATH;
  const basePath = normalizeBasePath(env.LA_PLUMA_BASE_PATH);

  // Only ticket issuance is exposed over HTTP. The signaling admin UI and
  // device endpoints remain inaccessible through the public application port.
  app.post(`${signalingPath}/api/login`, optionalApiAuth, signalingGateway.handleLogin);
  app.all(signalingPath, (_req: Request, res: Response) => res.status(404).json({ error: 'Not Found' }));
  app.all(`${signalingPath}/*`, (_req: Request, res: Response) => res.status(404).json({ error: 'Not Found' }));

  app.use(cors({
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }));
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ success: true, status: 'ok' });
  });

  if (env.NODE_ENV === 'production') {
    const staticMountPath = basePath === '/' ? '/' : basePath.slice(0, -1);
    const reservedPaths: string[] = ['/api', '/health', signalingPath];
    const sendAppShell = (req: Request, res: Response, next: NextFunction) => {
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

  // Read-only MaaResource images are loaded by <img> tags, which cannot attach
  // the bearer token. Mount the allowlisted asset router before API auth.
  app.use('/api/maa-assets', maaAssetsRoutes);
  app.use('/api', optionalApiAuth);
  app.use('/api/agent', agentRoutes);
  app.use('/api/operator-quotes', operatorQuotesRoutes);
  return app;
}

export function loadHttpsOptions(
  env: NodeJS.ProcessEnv = process.env,
  readFile: (path: string) => Buffer | string = readFileSync
) {
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

interface TransportOptions {
  app: Express;
  signalingGateway: ReturnType<typeof createWebrtcSignalingGateway>;
  env?: NodeJS.ProcessEnv;
  readFile?: (path: string) => Buffer | string;
}

function createLaPlumaTransportServer({
  app,
  signalingGateway,
  env = process.env,
  readFile = readFileSync
}: TransportOptions) {
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
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close(error => error ? rejectClose(error) : resolveClose());
    });
  };

  return {
    server,
    protocol: httpsOptions ? 'https' : 'http',
    close
  };
}

interface StartServerOptions {
  env?: NodeJS.ProcessEnv;
  host?: string;
  port?: number;
  signalingGateway?: ReturnType<typeof createWebrtcSignalingGateway>;
  initializeRunStore?: typeof initializeAgentRunStore;
  initializeRuntime?: typeof initializeRuntimeState;
  logger?: Pick<Console, 'log' | 'error'>;
}

export async function startLaPlumaServer({
  env = process.env,
  host = '0.0.0.0',
  port = Number(env.PORT || 3000),
  signalingGateway = createWebrtcSignalingGateway(),
  initializeRunStore = initializeAgentRunStore,
  initializeRuntime = initializeRuntimeState,
  logger = console
}: StartServerOptions = {}) {
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
      error: status.error || getErrorMessage(error)
    });
  }

  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      const onError = (error: Error) => rejectListen(error);
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
    const removedTaskFiles = await cleanupStaleDynamicTaskFiles();
    if (removedTaskFiles > 0) {
      logger.log(`[MAA] 已清理 ${removedTaskFiles} 个残留动态任务文件`);
    }
  } catch (error) {
    logger.error('[MAA] 清理残留动态任务文件失败:', getErrorMessage(error));
  }

  try {
    await initializeRuntime();
  } catch (error) {
    logger.error('[Runtime] 初始化失败:', getErrorMessage(error));
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
      closeMaaExecutionLeaseAdmission('server_shutdown');
      await runtime.close().catch((error: unknown) => console.error('[Server] 关闭失败:', getErrorMessage(error)));
      await shutdownBattleOcr().catch((error: unknown) => console.error('[BattleOcr] 关闭失败:', getErrorMessage(error)));
      process.exit(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (error) {
    console.error('[Server] 启动失败:', getErrorMessage(error));
    process.exitCode = 1;
  }
}
