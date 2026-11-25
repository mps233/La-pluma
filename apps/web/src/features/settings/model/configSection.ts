export const CONFIG_SECTION_IDS = ['connection', 'resource', 'instance'] as const

export type ConfigSectionId = (typeof CONFIG_SECTION_IDS)[number]

/** 兼容既有本地存储键；改名会让外部读取的上次停留记录失效。 */
export const CONFIG_SECTION_STORAGE_KEY = 'laPlumaConfigSection'

/** 兼容既有 window 事件；外部代码可据此把设置页滚到指定 section。 */
export const CONFIG_SECTION_EVENT = 'la-pluma-config-section'

export const isConfigSectionId = (value: unknown): value is ConfigSectionId => (
  typeof value === 'string' && (CONFIG_SECTION_IDS as readonly string[]).includes(value)
)

const defaultStorage = (): Pick<Storage, 'setItem'> | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

const defaultTarget = (): Pick<Window, 'addEventListener' | 'removeEventListener'> | null => {
  try {
    return typeof window === 'undefined' ? null : window
  } catch {
    return null
  }
}

/** 记录当前停留的配置 section；存储失败不应阻断页面内滚动。 */
export function writeConfigSection(
  section: ConfigSectionId,
  storage: Pick<Storage, 'setItem'> | null = defaultStorage(),
): void {
  if (!storage) return
  try {
    storage.setItem(CONFIG_SECTION_STORAGE_KEY, section)
  } catch {
    // 本地存储不可用时只保留当前页面内的高亮状态。
  }
}

/**
 * 订阅外部 section 定位请求。忽略非法 detail；返回注销函数，调用方必须在
 * Effect cleanup 中执行，避免 Activity 隐藏或页面卸载后遗留监听。
 */
export function subscribeConfigSection(
  listener: (section: ConfigSectionId) => void,
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> | null = defaultTarget(),
): () => void {
  if (!target) return () => {}

  const handleSectionChange = (event: Event) => {
    if (!isConfigSectionId((event as CustomEvent).detail)) return
    listener((event as CustomEvent).detail as ConfigSectionId)
  }

  target.addEventListener(CONFIG_SECTION_EVENT, handleSectionChange)
  return () => {
    target.removeEventListener(CONFIG_SECTION_EVENT, handleSectionChange)
  }
}
