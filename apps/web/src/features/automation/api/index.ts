import {
  API_BASE_URL,
  fetchWithAuth,
  isRecord,
  parseJsonResponse,
  readApiResponse,
  type ApiResponse,
} from '@/shared/api'
import type { TaskFlowWireItem } from '../types'

const isActivityPayload = (payload: unknown): boolean => isRecord(payload)

const isScheduleExecutionPayload = (payload: unknown): boolean => isRecord(payload)

const isInfrastScheduleListPayload = (payload: unknown): boolean => (
  isRecord(payload) && typeof payload.directory === 'string' && Array.isArray(payload.schedules)
)

const isInfrastScheduleDocumentPayload = (payload: unknown): boolean => (
  isRecord(payload) && typeof payload.name === 'string' && isRecord(payload.document)
)

/**
 * 获取当前活动信息
 *
 * `clientType` 省略时不拼查询串，由服务端按连接 profile 的 `client_type`
 * 解析；显式传入仍作为请求级覆盖。
 */
export async function getActivity(clientType?: string, signal?: AbortSignal): Promise<ApiResponse> {
  const query = clientType ? `?clientType=${encodeURIComponent(clientType)}` : ''
  return readApiResponse(`${API_BASE_URL}/agent/activity${query}`, {
    signal,
    validate: isActivityPayload,
    invalidPayloadMessage: '活动信息格式不正确',
  })
}

export async function setupSchedule(
  scheduleId: string = 'default',
  times: string[],
  taskFlow: TaskFlowWireItem[]
): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/schedules`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ scheduleId, times, taskFlow }),
  })
  return parseJsonResponse(response)
}

export async function stopSchedule(scheduleId: string = 'default'): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/schedules/${scheduleId}`, {
    method: 'DELETE',
  })
  return parseJsonResponse(response)
}

export async function getScheduleExecutionStatus(signal?: AbortSignal): Promise<ApiResponse> {
  return readApiResponse(`${API_BASE_URL}/agent/schedules/execution`, {
    signal,
    validate: isScheduleExecutionPayload,
    invalidPayloadMessage: '定时任务执行状态格式不正确',
  })
}

/**
 * 立即执行定时任务
 *
 * 默认保持旧同步行为；传 `waitForCompletion: false` 时服务端在流程获得执行权后
 * 返回 202，调用方改为观察 Run。`idempotencyKey` 由执行控制器为一次逻辑提交生成。
 */
export interface ScheduleExecutionOptions {
  waitForCompletion?: boolean
  idempotencyKey?: string
  signal?: AbortSignal
}

export async function executeScheduleNow(
  scheduleId: string = 'default',
  taskFlow: TaskFlowWireItem[],
  options: ScheduleExecutionOptions = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey

  const body: Record<string, unknown> = { taskFlow }
  if (options.waitForCompletion !== undefined) body.waitForCompletion = options.waitForCompletion

  const response = await fetchWithAuth(`${API_BASE_URL}/agent/schedules/${scheduleId}/execute`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: options.signal,
  })
  return parseJsonResponse(response)
}

/**
 * 通知配置读取。配置是自动化域的只读资源，由 Query 缓存持有；载荷形状
 * 交给 `normalizeNotificationConfig` 归一，这里只校验对象信封。
 */
export async function getNotificationConfig(signal?: AbortSignal): Promise<ApiResponse> {
  return readApiResponse(`${API_BASE_URL}/agent/notifications/config`, {
    signal,
    validate: payload => payload === null || isRecord(payload),
    invalidPayloadMessage: '通知配置格式不正确',
  })
}

/**
 * 保存通知配置。请求不绑定页面生命周期：Activity 隐藏或组件卸载后仍应完成
 * 落盘，成功后由调用方写回 Query 缓存。
 */
export async function saveNotificationConfig(
  config: unknown,
  signal?: AbortSignal,
): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/notifications/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
    signal,
  })
  return parseJsonResponse(response)
}

/** 测试单个通知渠道；失败返回可展示的错误信封。 */
export async function testNotificationChannel(
  channel: string,
  config: unknown,
  signal?: AbortSignal,
): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/test-notification-channel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, config }),
    signal,
  })
  return parseJsonResponse(response)
}

/**
 * 自定义基建排班文件列表。文件位于 MAA 配置目录的 `infrast/` 下，
 * 相对路径与 maa-cli 解析 `filename` 的规则一致。
 */
export async function listInfrastSchedules(signal?: AbortSignal): Promise<ApiResponse> {
  return readApiResponse(`${API_BASE_URL}/agent/infrast-schedules`, {
    signal,
    validate: isInfrastScheduleListPayload,
    invalidPayloadMessage: '排班文件列表格式不正确',
  })
}

/** 读取单个排班文件原文；文件不存在返回 404 失败信封。 */
export async function readInfrastSchedule(name: string, signal?: AbortSignal): Promise<ApiResponse> {
  return readApiResponse(
    `${API_BASE_URL}/agent/infrast-schedules/document?name=${encodeURIComponent(name)}`,
    {
      signal,
      validate: isInfrastScheduleDocumentPayload,
      invalidPayloadMessage: '排班文件格式不正确',
    },
  )
}

/** 保存排班文件；服务端按 Core 协议校验后原子写入。 */
export async function saveInfrastSchedule(name: string, document: unknown): Promise<ApiResponse> {
  return readApiResponse(`${API_BASE_URL}/agent/infrast-schedules/document`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, document }),
  })
}
