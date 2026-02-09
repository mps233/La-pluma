/**
 * API 辅助工具 - 统一的响应格式和错误处理
 */

/**
 * 成功响应
 */
export function successResponse(data, message = '操作成功') {
  return {
    success: true,
    message,
    data
  };
}

/**
 * 错误响应
 */
export function errorResponse(error, message) {
  return {
    success: false,
    message: message || error.message || '操作失败',
    error: error.message
  };
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
      res.status(500).json(errorResponse(error));
    }
  };
}

/**
 * 验证必需参数
 */
export function validateRequired(data, requiredFields) {
  const missing = requiredFields.filter(field => !data[field]);
  if (missing.length > 0) {
    throw new Error(`缺少必需参数: ${missing.join(', ')}`);
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
