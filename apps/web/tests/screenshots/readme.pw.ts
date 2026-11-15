import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectNoBrowserErrors, recordBrowserErrors } from '../visual/browser-errors'
import { installDeterministicEnvironment, themeSeedScript } from '../visual/harness'
import { readmeApiFixtures } from './fixtures'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_NAMES: Record<string, string> = {
  web: 'automation-web-light.png',
  mobile: 'automation-mobile-light.png',
}
// 侧栏头像走同源 /game-assets 路由，共享 harness 会把它替换成 1×1 占位图；
// README 截图针对阿米娅头像单独覆盖回仓库内的真实资产（180×180）。
const AMIYA_AVATAR_ROUTE = '**/game-assets/avatar/char_002_amiya.png*'
const AMIYA_AVATAR = readFileSync(path.resolve(__dirname, 'assets', 'amiya.png'))

async function waitForImages(page: Page) {
  await page.evaluate(async () => {
    const pending = Array.from(document.images).filter(image => !image.complete)
    await Promise.all(pending.map(image => new Promise<void>(resolve => {
      image.addEventListener('load', () => resolve(), { once: true })
      image.addEventListener('error', () => resolve(), { once: true })
    })))
  })
}

test('README automation screenshot', async ({ page }, testInfo) => {
  const outputName = OUTPUT_NAMES[testInfo.project.name]
  if (!outputName) throw new Error(`未配置项目 ${testInfo.project.name} 的输出文件名`)

  recordBrowserErrors(page)
  await page.addInitScript(themeSeedScript('light'))
  const environment = await installDeterministicEnvironment(page, { fixtures: readmeApiFixtures })
  // 侧栏身份固定为阿米娅，在共享 harness 的占位路由之后注册，头像由仓库内资产应答。
  await page.route(AMIYA_AVATAR_ROUTE, route => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: AMIYA_AVATAR,
  }))

  await page.goto('/app/automation')

  // 等任务流、定时设置和通知都完成固定数据渲染，避免截到加载中间态。
  await page.getByText('任务流程', { exact: true }).first().waitFor({ state: 'visible' })
  await page.getByText('7/7', { exact: true }).first().waitFor({ state: 'visible' })
  await page.getByText('关闭游戏', { exact: true }).first().waitFor({ state: 'visible' })
  await page.getByLabel('第 3 个执行时间').waitFor({ state: 'visible' })
  await page.getByText('博士，情报已经同步完毕', { exact: false }).first().waitFor({ state: 'visible' })
  await expect(page.getByText('最近执行', { exact: true })).toHaveCount(0)

  if (testInfo.project.name === 'web') {
    // 移动端不渲染侧栏身份；桌面端校验头像仍是原始请求且按 180×180 解码，
    // 防止共享 harness 的 1×1 占位图或 onError fallback 的 logo 图蒙混过关。
    const sidebarIdentity = page.getByLabel('阿米娅：今天也请多指教')
    await sidebarIdentity.waitFor({ state: 'visible' })
    await expect.poll(
      () => sidebarIdentity.locator('img').evaluate(image => ({
        src: image.currentSrc,
        complete: image.complete,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
      })),
    ).toEqual({
      src: expect.stringContaining('/game-assets/avatar/char_002_amiya.png'),
      complete: true,
      naturalWidth: 180,
      naturalHeight: 180,
    })
  }

  await page.evaluate(() => document.fonts.ready)
  await waitForImages(page)
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))

  // 先确认 fixture 与浏览器错误都干净，避免失败运行仍覆盖入库图片。
  environment.assertNoUnmatchedApi()
  await expectNoBrowserErrors(page)

  await page.screenshot({
    path: path.resolve(__dirname, '..', '..', '..', '..', 'screenshots', outputName),
    fullPage: false,
    animations: 'disabled',
    caret: 'hide',
  })
})
