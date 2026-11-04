/**
 * 未知错误的窄化辅助。外部命令、JSON、HTTP 和插件都可能抛出任意值，
 * 这里集中把 unknown 收窄成可读消息、稳定错误码和常见字段。
 */

export interface ErrorWithCode extends Error {
  code?: string;
  statusCode?: number;
  status?: number;
  details?: unknown;
  retryable?: boolean;
  exitCode?: number | null;
  signal?: string | null;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  stopped?: boolean;
  stopRequested?: boolean;
  owner?: unknown;
  copilotPlan?: { results?: unknown[] };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  return String(error);
}

export function getErrorCode(error: unknown): string | null {
  if (isRecord(error) && typeof error.code === 'string') return codeOrNull(error.code);
  if (error instanceof Error) {
    const code = (error as ErrorWithCode).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

function codeOrNull(value: string | null): string | null {
  return value;
}

export function getErrorStatus(error: unknown): number | null {
  if (!isRecord(error)) {
    if (error instanceof Error) {
      const candidate = (error as ErrorWithCode).statusCode ?? (error as ErrorWithCode).status;
      return typeof candidate === 'number' ? candidate : null;
    }
    return null;
  }
  const candidate = error.statusCode ?? error.status;
  return typeof candidate === 'number' ? candidate : null;
}

export function getErrorDetails(error: unknown): Record<string, unknown> {
  if (isRecord(error) && isRecord(error.details)) return error.details;
  if (error instanceof Error && isRecord((error as ErrorWithCode).details)) {
    return (error as ErrorWithCode).details as Record<string, unknown>;
  }
  return {};
}

export function asErrorWithCode(error: unknown): ErrorWithCode {
  if (error instanceof Error) return error as ErrorWithCode;
  return new Error(getErrorMessage(error)) as ErrorWithCode;
}
