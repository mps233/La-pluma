import { asErrorWithCode } from './errors.ts';
/**
 * API 辅助工具 - 统一的响应格式和错误处理
 */

export interface ApiRequestLike {
  headers?: Record<string, unknown>;
  id?: string;
}

export interface ApiResponseWriter {
  json(body: unknown): unknown;
  status(code: number): ApiResponseWriter;
}

export interface AgentErrorOptions {
  statusCode?: number;
  status?: number;
  details?: unknown;
  retryable?: boolean;
}

export interface AgentError extends Error {
  code: string;
  statusCode: number;
  details: unknown;
  retryable: boolean;
}

export interface ApiErrorResponse {
  success: false;
  message: string;
  error: ApiErrorDetail;
  meta: Record<string, unknown>;
}

export interface ApiErrorDetail {
  code: string;
  details: unknown;
  retryable: boolean;
  statusCode?: number;
}

function getRequestId(req: ApiRequestLike | null): string | null {
  const header = req?.headers?.['x-request-id'];
  if (typeof header === 'string' && header) return header;
  return req?.id || null;
}

function responseMeta(req: ApiRequestLike | null = null, extra: Record<string, unknown> = {}) {
  return {
    requestId: getRequestId(req),
    dryRun: false,
    ...extra
  };
}

export function agentError(
  code: string,
  message?: string,
  options: AgentErrorOptions = {}
): AgentError {
  const error = new Error(message || code || '操作失败') as AgentError;
  error.code = code || 'AGENT_INTERNAL_ERROR';
  error.statusCode = options.statusCode || options.status || 500;
  error.details = options.details || {};
  asErrorWithCode(error).retryable = options.retryable ?? false;
  return error;
}

export function isAgentError(value: unknown): value is AgentError {
  return value instanceof Error && typeof (value as { code?: unknown }).code === 'string';
}

/**
 * 成功响应
 */
export function successResponse(
  data: unknown,
  message = '操作成功',
  meta: Record<string, unknown> = {}
) {
  return {
    success: true,
    message,
    data,
    meta: responseMeta(null, meta)
  };
}

/**
 * 错误响应
 */
export function errorResponse(
  error: unknown,
  message?: string,
  meta: Record<string, unknown> = {}
): ApiErrorResponse {
  const normalized = typeof error === 'string'
    ? agentError('AGENT_INTERNAL_ERROR', error)
    : (error as Partial<AgentError> | null);

  return {
    success: false,
    message: message || normalized?.message || '操作失败',
    error: {
      code: normalized?.code || 'AGENT_INTERNAL_ERROR',
      details: normalized?.details || {},
      retryable: normalized?.retryable ?? false,
      ...(normalized?.statusCode ? { statusCode: normalized.statusCode } : {})
    },
    meta: responseMeta(null, meta)
  };
}

export function sendSuccess(
  res: ApiResponseWriter,
  req: ApiRequestLike | null,
  data: unknown,
  message = '操作成功',
  meta: Record<string, unknown> = {}
): void {
  res.json({
    success: true,
    message,
    data,
    meta: responseMeta(req, meta)
  });
}

export function sendDryRun(
  res: ApiResponseWriter,
  req: ApiRequestLike | null,
  plan: unknown,
  message = 'Dry run only',
  meta: Record<string, unknown> = {}
): void {
  sendSuccess(res, req, { plan }, message, { ...meta, dryRun: true });
}

export function sendError(
  res: ApiResponseWriter,
  req: ApiRequestLike | null,
  error: unknown,
  fallbackMessage?: string,
  meta: Record<string, unknown> = {}
): void {
  const normalized = typeof error === 'string'
    ? agentError('AGENT_INTERNAL_ERROR', error)
    : (error as Partial<AgentError> | null);
  const status = normalized?.statusCode || (normalized as { status?: number } | null)?.status || 500;
  res.status(status).json({
    success: false,
    message: fallbackMessage || normalized?.message || '操作失败',
    error: {
      code: normalized?.code || 'AGENT_INTERNAL_ERROR',
      details: normalized?.details || {},
      retryable: normalized?.retryable ?? false,
      ...(normalized?.statusCode ? { statusCode: normalized.statusCode } : {})
    },
    meta: responseMeta(req, meta)
  });
}

/**
 * 异步处理器包装 - 自动捕获错误
 */
export function asyncHandler<Req extends ApiRequestLike, Res extends ApiResponseWriter>(
  fn: (req: Req, res: Res, next: () => void) => unknown
) {
  return async (req: Req, res: Res, next: () => void): Promise<void> => {
    try {
      await fn(req, res, next);
    } catch (error) {
      console.error('API 错误:', error);
      sendError(res, req, error);
    }
  };
}

/**
 * 验证必需参数
 */
export function validateRequired(
  data: Record<string, unknown>,
  requiredFields: string[]
): void {
  const missing = requiredFields.filter(field => !data[field]);
  if (missing.length > 0) {
    throw agentError('AGENT_VALIDATION_MISSING_FIELDS', `缺少必需参数: ${missing.join(', ')}`, {
      statusCode: 400,
      details: { missingFields: missing },
      retryable: false
    });
  }
}

/**
 * 安全的 JSON 解析
 */
export function safeJsonParse<T = unknown>(str: string, defaultValue: T | null = null): T | null {
  try {
    return JSON.parse(str) as T;
  } catch (error) {
    console.error('JSON 解析失败:', (error as Error).message);
    return defaultValue;
  }
}
