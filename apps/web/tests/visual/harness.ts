import { expect, type Page, type Route } from '@playwright/test'
import { THEME_STORAGE_KEY } from '../../src/shared/theme/bootTheme'
import { DEFAULT_THEME_ID } from '../../src/shared/theme/registry'
import {
  apiFixtures,
  FIXED_NOW,
  installPlaceholderAssetRoutes,
  type ApiFixture,
} from './fixtures'

/**
 * 视觉基线 harness：固定数据、外部资源、时间、动效与主题种子。未匹配的 /api 请求
 * 视为 harness 缺口直接失败，防止静默假状态；Service Worker 注册在文档起点被替换为
 * 永久挂起的 promise；page.clock.setFixedTime 不暂停/推进时钟，保持真实时间速率。
 */

export const THEMES = ['dark', 'light'] as const
export type Theme = (typeof THEMES)[number]

export const READY_MARKER: Record<string, { text?: string; input?: string }> = {
  dashboard: { text: '春厦限定纪行' },
  automation: { text: '启动游戏客户端' },
  combat: { input: 'maa://10086' },
  roguelike: { input: 'Mizuki' },
  training: { text: '艾雅法拉' },
  logs: { text: '任务执行完成' },
  statistics: { text: '能天使' },
  config: { text: 'v5.12.3' },
  gallery: { text: '主题画廊' },
}

/** 主题种子：key 与默认主题 id 取自 shared/theme 单一来源。 */
export function themeSeedScript(theme: Theme) {
  return `
    localStorage.setItem(${JSON.stringify(THEME_STORAGE_KEY)}, JSON.stringify({
      themeId: ${JSON.stringify(DEFAULT_THEME_ID)},
      mode: ${JSON.stringify(theme)},
    }))
  `
}

/** 禁用 CSS 动画/过渡的兜底样式：framer-motion 已由 reduced motion 覆盖，这里覆盖纯 CSS keyframes/transition，避免截图截在动画中间态。 */
const MOTION_FREEZE_CSS = `
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    transition-delay: 0ms !important;
    scroll-behavior: auto !important;
    caret-color: transparent !important;
  }
`

const NO_SW_SCRIPT = `
  // 阻断 service worker 注册（单页应用在基线环境下无需离线缓存）。
  // 注册 promise 永久挂起：既不触发 PWAInstallPrompt 的注册失败提示，
  // 也不触发 offlineReady 提示（success 消息 1.5s 自动收起会造成时序抖动）。
  if (navigator.serviceWorker) {
    navigator.serviceWorker.register = () => new Promise(() => {})
  }
`

const MOTION_FREEZE_SCRIPT = `
  (() => {
    const appendMotionFreezeStyle = () => {
      const root = document.documentElement
      if (!root || root.querySelector('style[data-la-pluma-motion-freeze]')) return
      const style = document.createElement('style')
      style.dataset.laPlumaMotionFreeze = ''
      style.textContent = ${JSON.stringify(MOTION_FREEZE_CSS)}
      root.appendChild(style)
    }
    // addInitScript 可能早于 <html> 创建；等文档根可用再插入，不能把
    // 启动壳或页面加载期的空 documentElement 当成可append节点。
    if (document.documentElement) appendMotionFreezeStyle()
    else document.addEventListener('DOMContentLoaded', appendMotionFreezeStyle, { once: true })
  })()
`

function matchFixture(method: string, pathname: string, fixtures: ApiFixture[]): ApiFixture['payload'] | undefined {
  for (const fixture of fixtures) {
    if ((fixture.method ?? 'GET') !== method) continue
    const pattern = fixture.path.split('/').filter(Boolean)
    const actual = pathname.split('/').filter(Boolean)
    if (pattern.length !== actual.length) continue
    const matched = pattern.every((segment, index) =>
      segment.startsWith(':') ? actual[index] !== '' : segment === actual[index])
    if (matched) return fixture.payload
  }
  return undefined
}

/** 安装确定性环境；`fixtures` 可替换整套 `/api` 响应（README 截图使用）。 */
export async function installDeterministicEnvironment(
  page: Page,
  options: { nativeClock?: boolean; fixtures?: ApiFixture[] } = {},
) {
  const fixtures = options.fixtures ?? apiFixtures
  const unmatchedApiCalls: string[] = []

  await page.addInitScript(NO_SW_SCRIPT)
  await page.addInitScript(MOTION_FREEZE_SCRIPT)

  // 双保险：即便 SW 脚本请求发生，也直接 404（register 已在文档起点被替换为挂起 promise）。
  await page.route('**/sw.js', route => route.fulfill({ status: 404, body: 'sw disabled' }))

  await installPlaceholderAssetRoutes(page)

  let deviceStatsCalls = 0
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const pathname = url.pathname.replace(/^\/api/, '') || '/'
    const payload = matchFixture(request.method(), pathname, fixtures)
    if (payload === undefined) {
      unmatchedApiCalls.push(`${request.method()} /api${pathname}`)
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
      return
    }
    // 温度历史随每次轮询累积（5s 间隔）：只应答挂载后的首次请求，
    // 后续请求 abort（组件 catch 后保留既有样本），截图不受真实耗时影响。
    if (pathname === '/agent/device-stats') {
      deviceStatsCalls += 1
      if (deviceStatsCalls > 1) {
        await route.abort()
        return
      }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
  })

  if (options.nativeClock) {
    // Performance sampling needs native sub-ms performance.now(), rAF and timers.
    // Playwright setFixedTime installs a real-time advancing clock facade which
    // rounds its performance clock to whole milliseconds in this pinned version.
    await page.addInitScript(`
      (() => {
        const NativeDate = Date
        const fixed = ${FIXED_NOW.getTime()}
        function FixedDate(...args) {
          if (!new.target) return new NativeDate(fixed).toString()
          return Reflect.construct(NativeDate, args.length ? args : [fixed], new.target)
        }
        Object.setPrototypeOf(FixedDate, NativeDate)
        FixedDate.prototype = NativeDate.prototype
        FixedDate.now = () => fixed
        window.Date = FixedDate
      })()
    `)
  } else {
    await page.clock.setFixedTime(FIXED_NOW)
  }

  return {
    assertNoUnmatchedApi() {
      expect(unmatchedApiCalls, '未匹配 fixture 的 /api 请求（需补 fixtures.ts）').toEqual([])
    },
  }
}

export async function waitForPageReady(page: Page, tab: string) {
  const marker = READY_MARKER[tab]
  if (!marker) throw new Error(`缺少 ${tab} 的就绪标记`)
  if (marker.text) {
    await page.getByText(marker.text, { exact: false }).first().waitFor({ state: 'visible', timeout: 20_000 })
  } else if (marker.input) {
    await page.waitForFunction(
      expected => Array.from(document.querySelectorAll('input')).some(input => input.value === expected),
      marker.input,
      { timeout: 20_000 },
    )
  }
  await page.evaluate(() => document.fonts.ready)
}
