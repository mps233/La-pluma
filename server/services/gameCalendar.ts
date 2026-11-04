/**
 * 游戏日与客户端服务区时区。
 *
 * “今日”按客户端服务区的游戏日计算：服务区时区 + 每日 04:00 日界。
 * 这里使用固定偏移，不读取宿主进程时区，也不依赖夏令时；调度注册使用
 * 对应 IANA 时区，资源本开放判断使用同一份游戏日。
 */

export const GAME_DAY_START_HOUR = 4;

const HOUR_MS = 3_600_000;

export interface GameZone {
  clientType: string;
  utcOffsetHours: number;
  timeZone: string;
}

export interface GameDay {
  date: string;
  weekday: number;
}

const GAME_ZONES: Record<string, GameZone> = {
  official: { clientType: 'Official', utcOffsetHours: 8, timeZone: 'Asia/Shanghai' },
  bilibili: { clientType: 'Bilibili', utcOffsetHours: 8, timeZone: 'Asia/Shanghai' },
  txwy: { clientType: 'txwy', utcOffsetHours: 8, timeZone: 'Asia/Shanghai' },
  yostaren: { clientType: 'YoStarEN', utcOffsetHours: -7, timeZone: 'Etc/GMT+7' },
  yostarjp: { clientType: 'YoStarJP', utcOffsetHours: 9, timeZone: 'Asia/Tokyo' },
  yostarkr: { clientType: 'YoStarKR', utcOffsetHours: 9, timeZone: 'Asia/Seoul' },
};

export function resolveGameZone(clientType?: string | null): GameZone {
  const key = typeof clientType === 'string' ? clientType.trim().toLowerCase() : '';
  return GAME_ZONES[key] ?? GAME_ZONES.official;
}

export function gameTimeZoneForClientType(clientType?: string | null): string {
  return resolveGameZone(clientType).timeZone;
}

/** 计算 `now` 所属的游戏日；固定偏移折算后读取 UTC 日期与星期。 */
export function getGameDay(now: Date, clientType?: string | null): GameDay {
  const { utcOffsetHours } = resolveGameZone(clientType);
  const shifted = new Date(now.getTime() + (utcOffsetHours - GAME_DAY_START_HOUR) * HOUR_MS);
  return {
    date: shifted.toISOString().slice(0, 10),
    weekday: shifted.getUTCDay(),
  };
}
