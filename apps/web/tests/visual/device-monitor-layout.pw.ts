import { expect, test, type Page } from '@playwright/test'
import { expectNoBrowserErrors, recordBrowserErrors } from './browser-errors'
import {
  installDeterministicEnvironment,
  themeSeedScript,
  waitForPageReady,
} from './harness'

async function openTab(page: Page, tab: string) {
  await page.goto(`/app/${tab}`)
  await waitForPageReady(page, tab)
}

async function singleBox(page: Page, selector: string) {
  const locator = page.locator(selector)
  await expect(locator).toHaveCount(1)
  const box = await locator.boundingBox()
  expect(box, `${selector} has a bounding box`).not.toBeNull()
  return box!
}

test.describe('device monitor layout', () => {
  test.beforeEach(async ({ page }) => {
    recordBrowserErrors(page)
    await page.addInitScript(themeSeedScript('dark'))
  })

  test('standard layout places the monitor beside the main column on desktop', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'wide layout is checked on desktop')

    const environment = await installDeterministicEnvironment(page)
    await openTab(page, 'logs')

    const main = await singleBox(page, '[data-device-monitor-layout="standard"] [data-monitor-area="main"]')
    const monitor = await singleBox(page, '[data-device-monitor-layout="standard"] [data-monitor-area="monitor"]')

    expect(monitor.x).toBeGreaterThanOrEqual(main.x + main.width)
    expect(Math.abs(monitor.y - main.y)).toBeLessThanOrEqual(1)

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('workbench exposes sequence, editor and support as separate columns', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'wide layout is checked on desktop')

    const environment = await installDeterministicEnvironment(page)
    await openTab(page, 'automation')

    const sequence = await singleBox(page, '[data-device-monitor-layout="workbench"] [data-monitor-area="sequence"]')
    const editor = await singleBox(page, '[data-device-monitor-layout="workbench"] [data-monitor-area="editor"]')
    const support = await singleBox(page, '[data-device-monitor-layout="workbench"] [data-monitor-area="support"]')

    expect(editor.x).toBeGreaterThanOrEqual(sequence.x + sequence.width)
    expect(support.x).toBeGreaterThanOrEqual(editor.x + editor.width)
    expect(Math.abs(editor.y - sequence.y)).toBeLessThanOrEqual(1)
    await expect(page.locator('[data-monitor-area="support"] [data-region="monitor"]')).toHaveCount(1)

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('mode layout keeps the monitor spanning both rows on the right', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'wide layout is checked on desktop')

    const environment = await installDeterministicEnvironment(page)
    await openTab(page, 'roguelike')

    const mode = await singleBox(page, '[data-device-monitor-layout="mode"] [data-monitor-area="mode"]')
    const main = await singleBox(page, '[data-device-monitor-layout="mode"] [data-monitor-area="main"]')
    const settings = await singleBox(page, '[data-device-monitor-layout="mode"] [data-monitor-area="settings"]')
    const monitor = await singleBox(page, '[data-device-monitor-layout="mode"] [data-monitor-area="monitor"]')

    expect(main.y).toBeGreaterThan(mode.y)
    expect(Math.abs(main.y - settings.y)).toBeLessThanOrEqual(1)
    expect(monitor.x).toBeGreaterThanOrEqual(settings.x + settings.width)
    expect(Math.abs(monitor.y - mode.y)).toBeLessThanOrEqual(1)
    expect(monitor.y + monitor.height).toBeGreaterThan(main.y)

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('workspace layouts keep reading order below the wide breakpoint', async ({ page }) => {
    test.skip(test.info().project.name === 'desktop', 'narrow layout is checked on tablet and mobile')
    const isTablet = test.info().project.name === 'tablet'

    const environment = await installDeterministicEnvironment(page)

    await openTab(page, 'automation')
    const sequence = await singleBox(page, '[data-monitor-area="sequence"]')
    const editor = await singleBox(page, '[data-monitor-area="editor"]')
    const support = await singleBox(page, '[data-monitor-area="support"]')
    expect(editor.y).toBeGreaterThanOrEqual(sequence.y + sequence.height)
    expect(support.y).toBeGreaterThanOrEqual(editor.y + editor.height)

    await openTab(page, 'roguelike')
    const mode = await singleBox(page, '[data-monitor-area="mode"]')
    const main = await singleBox(page, '[data-monitor-area="main"]')
    const settings = await singleBox(page, '[data-monitor-area="settings"]')
    const monitor = await singleBox(page, '[data-monitor-area="monitor"]')
    if (isTablet) {
      expect(settings.x).toBeGreaterThanOrEqual(main.x + main.width)
      expect(monitor.y).toBeGreaterThanOrEqual(settings.y + settings.height)
      expect(monitor.width).toBeGreaterThan(settings.width)
    } else {
      expect(main.y).toBeGreaterThanOrEqual(mode.y + mode.height)
      expect(settings.y).toBeGreaterThanOrEqual(main.y + main.height)
      expect(monitor.y).toBeGreaterThanOrEqual(settings.y + settings.height)
    }

    await openTab(page, 'logs')
    const standardMain = await singleBox(page, '[data-monitor-area="main"]')
    const standardMonitor = await singleBox(page, '[data-monitor-area="monitor"]')
    expect(standardMonitor.y).toBeGreaterThanOrEqual(standardMain.y + standardMain.height)

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('combat caps the standard monitor at 48rem and centers it at 1280', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'intermediate width is checked on desktop')

    await page.setViewportSize({ width: 1280, height: 900 })
    const environment = await installDeterministicEnvironment(page)
    await openTab(page, 'combat')

    const layout = await singleBox(page, '[data-device-monitor-layout="standard"]')
    const main = await singleBox(page, '[data-device-monitor-layout="standard"] [data-monitor-area="main"]')
    const monitor = await singleBox(page, '[data-device-monitor-layout="standard"] [data-monitor-area="monitor"]')

    expect(monitor.y).toBeGreaterThanOrEqual(main.y + main.height)
    expect(monitor.width).toBeLessThan(main.width)
    expect(monitor.width).toBeLessThanOrEqual(768 + 0.5)
    expect(Math.abs(monitor.x + monitor.width / 2 - (layout.x + layout.width / 2))).toBeLessThanOrEqual(1)

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('dashboard and config expose no device monitor layout', async ({ page }) => {
    const environment = await installDeterministicEnvironment(page)

    for (const tab of ['dashboard', 'config']) {
      await openTab(page, tab)
      await expect(page.locator('[data-device-monitor-layout]')).toHaveCount(0)
      await expect(page.locator('[data-region="monitor"]')).toHaveCount(0)
    }

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })
})
