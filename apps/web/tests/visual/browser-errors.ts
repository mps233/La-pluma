import { expect, type Page } from '@playwright/test'

const browserErrors = new WeakMap<Page, string[]>()

/** 从页面加载前开始记录脚本异常；截图通过不能掩盖初始化错误。 */
export function recordBrowserErrors(page: Page): void {
  const errors: string[] = []
  browserErrors.set(page, errors)
  page.on('pageerror', error => errors.push(error.stack || error.message))
}

export async function expectNoBrowserErrors(page: Page): Promise<void> {
  // 等两帧让入口模块与首屏 Effect 的异常进入事件队列，再统一给出全部错误。
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  expect(browserErrors.get(page) ?? [], '浏览器页面脚本异常').toEqual([])
}
