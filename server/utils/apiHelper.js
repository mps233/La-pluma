/**
 * API 辅助工具 - 统一的响应格式和错误处理
 */

function getRequestId(req) {
  return req?.headers?.['x-request-id'] || req?.id || null;
}

export function responseMeta(req = null, extra = {}) {
  return {
    requestId: getRequestId(req),
    dryRun: false,
    ...extra
  };
}

export function agentError(code, message, options = {}) {
  const error = new Error(message || code || '操作失败');
  error.code = code || 'AGENT_INTERNAL_ERROR';
  error.statusCode = options.statusCode || options.status || 500;
  error.details = options.details || {};
  error.retryable = options.retryable ?? false;
  return error;
}

/**
 * 成功响应
 */
export function successResponse(data, message = '操作成功', meta = {}) {
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
export function errorResponse(error, message, meta = {}) {
  const normalized = typeof error === 'string'
    ? agentError('AGENT_INTERNAL_ERROR', error)
    : error;

  return {
    success: false,
    message: message || normalized?.message || '操作失败',
    error: {
      code: normalized?.code || 'AGENT_INTERNAL_ERROR',
      details: normalized?.details || {},
      retryable: normalized?.retryable ?? false
    },
    meta: responseMeta(null, meta)
  };
}

export function sendSuccess(res, req, data, message = '操作成功', meta = {}) {
  res.json({
    success: true,
    message,
    data,
    meta: responseMeta(req, meta)
  });
}

export function sendDryRun(res, req, plan, message = 'Dry run only', meta = {}) {
  sendSuccess(res, req, { plan }, message, { ...meta, dryRun: true });
}

export function sendError(res, req, error, fallbackMessage) {
  const normalized = typeof error === 'string'
    ? agentError('AGENT_INTERNAL_ERROR', error)
    : error;
  const status = normalized?.statusCode || normalized?.status || 500;
  res.status(status).json({
    success: false,
    message: fallbackMessage || normalized?.message || '操作失败',
    error: {
      code: normalized?.code || 'AGENT_INTERNAL_ERROR',
      details: normalized?.details || {},
      retryable: normalized?.retryable ?? false
    },
    meta: responseMeta(req)
  });
}

/**
 * 异步处理器包装 - 自动捕获错误
 */
export function asyncHandler(fn) {
  return async (req, res, next) => {
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
export function validateRequired(data, requiredFields) {
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
export function safeJsonParse(str, defaultValue = null) {
  try {
    return JSON.parse(str);
  } catch (error) {
    console.error('JSON 解析失败:', error.message);
    return defaultValue;
  }
}
