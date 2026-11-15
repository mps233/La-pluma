import type { HtmlTagDescriptor } from 'vite'
import { BOOT_THEME_COLORS, createBootScript } from '../../src/shared/theme/bootTheme.ts'

/**
 * 把首帧主题 meta 与脚本依次注入 index.html 的 head 末尾（dev 与 build 都生效）。
 * 用 'head' 而不是 'head-prepend'：同一 injectTo 下按数组顺序输出，因此两个
 * meta 必然排在脚本之前，applyTheme 首次运行才能覆写它们。
 * 初始值取深色：<html> 静态就是 class="dark"，index.html 的默认主题也是深色；
 * 脚本随后按 localStorage 中的偏好改写。meta content 与脚本内容都由
 * shared/theme/bootTheme.ts 单一生成，index.html 里不再内联副本。
 */
export const createBootThemeTags = (): HtmlTagDescriptor[] => [
  {
    tag: 'meta',
    attrs: { name: 'theme-color', content: BOOT_THEME_COLORS.dark.themeColor },
    injectTo: 'head',
  },
  {
    tag: 'meta',
    attrs: { name: 'apple-mobile-web-app-status-bar-style', content: BOOT_THEME_COLORS.dark.statusBar },
    injectTo: 'head',
  },
  {
    tag: 'script',
    children: createBootScript(),
    injectTo: 'head',
  },
]
