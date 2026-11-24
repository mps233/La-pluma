import {
  API_BASE_URL,
  fetchWithAuth,
  isRecord,
  parseJsonResponse,
  readApiResponse,
  type ApiResponse,
} from '@/shared/api'

/**
 * 解析并保存仓库数据
 *
 * 解析端点读取 MAA 已写入的日志，不是设备命令；调用方可以在识别完成后轮询，
 * 直到返回可用快照。`signal` 只放弃本次本地等待，不撤销已完成的服务端解析。
 */
export async function parseDepotData(signal?: AbortSignal): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/depot-recognition`, {
    method: 'POST',
    signal,
  })
  return parseJsonResponse(response)
}

export async function parseOperBoxData(signal?: AbortSignal): Promise<ApiResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/operbox-recognition`, {
    method: 'POST',
    signal,
  })
  return parseJsonResponse(response)
}

const isTodayDropsPayload = (payload: unknown): boolean =>
  Array.isArray(payload)
  || (isRecord(payload)
    && payload.success !== false
    && Array.isArray(payload.records)
    && isRecord(payload.summary))

const isDropStatisticsTotal = (value: unknown): boolean =>
  isRecord(value)
  && typeof value.sanity === 'number'
  && typeof value.battles === 'number'
  && typeof value.medicine === 'number'
  && typeof value.stone === 'number'

const isDropStatisticsStage = (value: unknown): boolean =>
  isRecord(value)
  && typeof value.battles === 'number'
  && isRecord(value.items)

/**
 * `dailyTrend` 不由掉落面板消费；旧服务端/固定数据可能省略，不能据此判坏。
 */
const isDropStatisticsPayload = (payload: unknown): boolean =>
  isRecord(payload)
  && payload.success !== false
  && isDropStatisticsTotal(payload.total)
  && isRecord(payload.items)
  && isRecord(payload.stages)
  && Object.values(payload.stages).every(isDropStatisticsStage)
  && (payload.dailyTrend === undefined || Array.isArray(payload.dailyTrend))

const isOpenTodayStagesPayload = (payload: unknown): boolean =>
  isRecord(payload)
  && Array.isArray(payload.open)
  && Array.isArray(payload.closed)

export async function getTodayDrops(signal?: AbortSignal): Promise<ApiResponse> {
  return readApiResponse(`${API_BASE_URL}/agent/drops/today`, {
    signal,
    validate: isTodayDropsPayload,
    invalidPayloadMessage: '今日掉落记录格式不正确',
  })
}

export async function getDropStatistics(days: number = 7, signal?: AbortSignal): Promise<ApiResponse> {
  return readApiResponse(`${API_BASE_URL}/agent/drops/statistics?days=${days}`, {
    signal,
    validate: isDropStatisticsPayload,
    invalidPayloadMessage: '掉落统计数据格式不正确',
  })
}

export async function getOpenTodayStages(signal?: AbortSignal): Promise<ApiResponse> {
  return readApiResponse(`${API_BASE_URL}/agent/stages/open-today`, {
    signal,
    validate: isOpenTodayStagesPayload,
    invalidPayloadMessage: '今日开放关卡数据格式不正确',
  })
}
