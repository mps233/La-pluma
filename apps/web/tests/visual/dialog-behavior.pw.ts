import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectNoBrowserErrors, recordBrowserErrors } from './browser-errors'
import { apiFixtures, ok } from './fixtures'
import { installDeterministicEnvironment, waitForPageReady } from './harness'

const combatDiscoveryFixtures = [
  { path: '/agent/copilot/stages', payload: ok([]) },
  {
    path: '/agent/copilot/search',
    payload: ok({
      copilots: [{
        id: '42',
        uri: 'prts://42',
        views: 120,
        hotScore: 9,
        title: '测试作业',
        uploader: '测试作者',
        stageName: '1-7',
        stageId: 'main_01-07',
      }],
      total: 1,
      page: 1,
      hasNext: false,
    }),
  },
  {
    path: '/agent/copilots/42',
    payload: ok({
      status_code: 200,
      data: {
        content: JSON.stringify({ doc: { title: '测试作业' }, stage_name: '1-7' }),
      },
    }),
  },
  ...apiFixtures,
]

const combatSetFixtures = [
  { path: '/agent/copilot/stages', payload: ok([]) },
  {
    path: '/agent/copilot/search',
    payload: ok({
      copilots: [{
        id: '48990',
        uri: 'prts://s48990',
        views: 120,
        hotScore: 9,
        title: '测试作业集',
        uploader: '测试作者',
        stageName: '1-7',
        stageId: 'main_01-07',
      }],
      total: 1,
      page: 1,
      hasNext: false,
    }),
  },
  {
    path: '/agent/copilot-sets/48990/plan',
    payload: ok({
      setId: '48990',
      name: '测试作业集',
      items: [{ id: 101, stage: '1-7', stageId: 'main_01-07' }],
      entries: [],
    }),
  },
  ...apiFixtures,
]

const combatSingleFixtures = [
  { path: '/agent/copilot/stages', payload: ok([]) },
  {
    path: '/agent/copilots/10086',
    payload: ok({
      status_code: 200,
      data: {
        content: JSON.stringify({ doc: { title: '单作业' }, stage_name: '1-7' }),
      },
    }),
  },
  ...apiFixtures,
]

async function expectPopupCoversItsCenter(popup: Locator) {
  const box = await popup.boundingBox()
  expect(box).not.toBeNull()
  const hitInside = await popup.evaluate((element, point) => {
    const hit = document.elementFromPoint(point.x, point.y)
    return Boolean(hit && (hit === element || element.contains(hit)))
  }, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 })
  expect(hitInside, '弹层中心应命中弹层自身而不是被下层的遮罩挡住').toBe(true)
}

async function openGallery(page: Page) {
  const environment = await installDeterministicEnvironment(page)
  await page.goto('/dev/theme-gallery')
  await waitForPageReady(page, 'gallery')
  return environment
}

async function expectModalBackground(page: Page, modal: boolean) {
  const navbar = page.locator('.la-pluma-navbar')
  if (modal) await expect(navbar).toHaveAttribute('aria-hidden', 'true')
  else await expect(navbar).not.toHaveAttribute('aria-hidden', 'true')
}

async function expectParentLayerInert(parent: Locator, control: Locator) {
  await expect(parent).toHaveAttribute('data-nested-dialog-open', '')
  await expect.poll(() => parent.evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none')
  const box = await control.boundingBox()
  expect(box).not.toBeNull()
  const point = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
  const hitControl = await control.evaluate((element, target) => {
    const hit = document.elementFromPoint(target.x, target.y)
    return Boolean(hit && (hit === element || element.contains(hit)))
  }, point)
  expect(hitControl, '父层控件不应命中 pointer-events').toBe(false)
  return point
}

async function expectParentLayerInteractive(parent: Locator) {
  await expect.poll(() => parent.getAttribute('data-nested-dialog-open')).toBeNull()
  await expect.poll(() => parent.evaluate(element => getComputedStyle(element).pointerEvents)).toBe('auto')
}

async function expectBackgroundScrollBlocked(page: Page) {
  const host = page.locator('[data-region="scroll"]')
  await host.evaluate(element => { element.scrollTop = 200 })
  const before = await host.evaluate(element => element.scrollTop)
  await page.mouse.move(700, 300)
  await page.mouse.wheel(0, 400)
  await page.waitForTimeout(100)
  expect(await host.evaluate(element => element.scrollTop)).toBe(before)
}

async function expectBackgroundScrollable(page: Page) {
  const host = page.locator('[data-region="scroll"]')
  const before = await host.evaluate(element => element.scrollTop)
  await page.mouse.move(700, 300)
  await page.mouse.wheel(0, 400)
  await expect.poll(() => host.evaluate(element => element.scrollTop)).toBeGreaterThan(before)
}

test.describe('dialog overlay behavior', () => {
  test.beforeEach(async ({ page }) => {
    recordBrowserErrors(page)
  })

  test('stacks an alert dialog over a dialog without leaving the parent interactive', async ({ page }) => {
    const environment = await openGallery(page)
    const trigger = page.getByRole('button', { name: '打开标准对话框', exact: true })
    await trigger.focus()
    await trigger.click()

    const dialog = page.locator('#gallery-dialog-standard')
    await expect(dialog).toBeVisible()
    await expectModalBackground(page, true)
    if (test.info().project.name !== 'mobile') await expectBackgroundScrollBlocked(page)

    const opener = dialog.getByRole('button', { name: '在对话框上打开确认框', exact: true })
    await opener.click()
    const alert = page.locator('#gallery-nested-alert-dialog')
    await expect(alert).toBeVisible()
    await expect(dialog).toBeVisible()
    const parentControl = dialog.locator('#gallery-standard-done')
    const controlPoint = await expectParentLayerInert(dialog, parentControl)
    if (test.info().project.name !== 'mobile') {
      await page.mouse.click(controlPoint.x, controlPoint.y)
      await expect(alert).toBeVisible()
      await expect(dialog).toBeVisible()
    }

    await page.mouse.click(8, 400)
    await expect(alert).toBeVisible()
    await expect(dialog).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(alert).toBeHidden()
    await expect(dialog).toBeVisible()
    await expect(opener).toBeFocused()
    await expectParentLayerInteractive(dialog)

    await opener.click()
    await expect(alert).toBeVisible()
    await alert.getByRole('button', { name: '保留更改', exact: true }).click()
    await expect(alert).toBeHidden()
    await expect(dialog).toBeVisible()
    await expect(opener).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expectModalBackground(page, false)
    if (test.info().project.name !== 'mobile') await expectBackgroundScrollable(page)
    await expect(trigger).toBeFocused()

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('stacks a sheet over a dialog without leaving the parent interactive', async ({ page }) => {
    const environment = await openGallery(page)
    const trigger = page.getByRole('button', { name: '打开标准对话框', exact: true })
    await trigger.focus()
    await trigger.click()

    const dialog = page.locator('#gallery-dialog-standard')
    await expect(dialog).toBeVisible()

    const opener = dialog.getByRole('button', { name: '在对话框上打开抽屉', exact: true })
    await opener.click()
    const sheet = page.locator('#gallery-nested-sheet')
    await expect(sheet).toBeVisible()
    await expect(dialog).toBeVisible()
    const parentControl = dialog.locator('#gallery-dialog-order')
    const controlPoint = await expectParentLayerInert(dialog, parentControl)

    const clickPoint = test.info().project.name === 'mobile' ? { x: 20, y: 300 } : controlPoint
    await page.mouse.click(clickPoint.x, clickPoint.y)
    await expect(sheet).toBeHidden()
    await expect(dialog).toBeVisible()
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await expect(opener).toBeFocused()
    await expectParentLayerInteractive(dialog)

    await opener.click()
    await expect(sheet).toBeVisible()
    await page.mouse.click(8, 400)
    await expect(sheet).toBeHidden()
    await expect(dialog).toBeVisible()
    await expect(opener).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('stacks a dialog over a sheet without leaving the parent interactive', async ({ page }) => {
    const environment = await openGallery(page)
    const trigger = page.getByRole('button', { name: '打开右侧抽屉', exact: true })
    await trigger.focus()
    await trigger.click()

    const sheet = page.locator('#gallery-sheet-right')
    await expect(sheet).toBeVisible()
    await expectModalBackground(page, true)
    if (test.info().project.name !== 'mobile') await expectBackgroundScrollBlocked(page)

    const opener = sheet.getByRole('button', { name: '在抽屉上打开对话框', exact: true })
    await opener.click()
    const dialog = page.locator('#gallery-sheet-nested-dialog')
    await expect(dialog).toBeVisible()
    await expect(sheet).toBeVisible()
    const parentControl = sheet.locator('#gallery-sheet-right-close')
    const controlPoint = await expectParentLayerInert(sheet, parentControl)

    await page.mouse.click(controlPoint.x, controlPoint.y)
    await expect(dialog).toBeHidden()
    await expect(sheet).toBeVisible()
    await expect(opener).toBeFocused()
    await expectParentLayerInteractive(sheet)

    await opener.click()
    await expect(dialog).toBeVisible()
    await page.mouse.click(8, 400)
    await expect(dialog).toBeHidden()
    await expect(sheet).toBeVisible()
    await expect(opener).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    await expectModalBackground(page, false)
    if (test.info().project.name !== 'mobile') await expectBackgroundScrollable(page)
    await expect(trigger).toBeFocused()

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('closes a select popup before its dialog on Escape', async ({ page }) => {
    const environment = await openGallery(page)
    const trigger = page.getByRole('button', { name: '打开标准对话框', exact: true })
    await trigger.focus()
    await trigger.click()

    const dialog = page.locator('#gallery-dialog-standard')
    await expect(dialog).toBeVisible()

    await dialog.getByRole('combobox', { name: '画廊排序', exact: true }).click()
    const listbox = page.getByRole('listbox')
    await expect(listbox).toBeVisible()
    await expectPopupCoversItsCenter(listbox)

    await page.keyboard.press('Escape')
    await expect(listbox).toBeHidden()
    await expect(dialog).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('stacks the combat detail sheet over the discovery dialog', async ({ page }) => {
    const environment = await installDeterministicEnvironment(page, { fixtures: combatDiscoveryFixtures })
    await page.goto('/app/combat')
    await waitForPageReady(page, 'combat')

    const trigger = page.getByRole('button', { name: '发现', exact: true })
    await trigger.focus()
    await trigger.click()

    const discovery = page.locator('#combat-copilot-discovery-dialog')
    await expect(discovery).toBeVisible()
    const card = discovery.locator('button[aria-label="查看作业 测试作业"]')
    await card.click()

    const detail = page.locator('#combat-copilot-detail-panel')
    await expect(detail).toBeVisible()
    await expect(detail).toHaveAttribute('aria-modal', 'true')
    await expect(detail).toHaveAttribute('data-side', test.info().project.name === 'mobile' ? 'bottom' : 'right')
    await expect(discovery).toBeVisible()
    await expectModalBackground(page, true)
    await expectParentLayerInert(discovery, card)

    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()
    await expect(discovery).toBeVisible()
    await expectParentLayerInteractive(discovery)
    await expect(card).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(discovery).toBeHidden()
    await expectModalBackground(page, false)
    await expect(trigger).toBeFocused()

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('keeps the preview detail sheet non-modal when discovery is closed', async ({ page }) => {
    const environment = await installDeterministicEnvironment(page, { fixtures: combatSingleFixtures })
    await page.goto('/app/combat')
    await waitForPageReady(page, 'combat')

    const trigger = page.getByRole('button', { name: '预览', exact: true })
    await trigger.focus()
    await trigger.click()

    const isMobile = test.info().project.name === 'mobile'
    const detail = page.locator('#combat-copilot-detail-panel')
    await expect(detail).toBeVisible()
    await expect(detail).toHaveAttribute('aria-modal', isMobile ? 'true' : 'false')
    await expectModalBackground(page, isMobile)
    if (!isMobile) await expect(page.locator('[data-slot="sheet-overlay"]')).toHaveCount(0)

    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()
    await expect(trigger).toBeFocused()

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('stacks the reset alert dialog over the combat detail sheet', async ({ page }) => {
    const environment = await installDeterministicEnvironment(page, { fixtures: combatSetFixtures })
    await page.goto('/app/combat')
    await waitForPageReady(page, 'combat')

    await page.getByRole('button', { name: '发现', exact: true }).click()
    const discovery = page.locator('#combat-copilot-discovery-dialog')
    await expect(discovery).toBeVisible()
    await discovery.getByRole('button', { name: '查看作业 测试作业集', exact: true }).click()

    const detail = page.locator('#combat-copilot-detail-panel')
    await expect(detail).toBeVisible()
    const reset = detail.locator('button').filter({ hasText: '重置进度' })
    await expect(reset).toBeVisible()
    await reset.click()

    const alert = page.locator('[data-slot="alert-dialog-content"]')
    await expect(alert).toBeVisible()
    const closeDetail = detail.locator('button[aria-label="关闭详情"]')
    const controlPoint = await expectParentLayerInert(detail, closeDetail)

    await page.mouse.click(controlPoint.x, controlPoint.y)
    await expect(alert).toBeHidden()
    await expect(detail).toBeVisible()
    await expect(reset).toBeFocused()

    await reset.click()
    await expect(alert).toBeVisible()
    await page.mouse.click(8, 400)
    await expect(alert).toBeHidden()
    await expect(detail).toBeVisible()

    await closeDetail.click()
    await expect(detail).toBeHidden()
    await expect(discovery).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(discovery).toBeHidden()

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('opens and closes the mobile bottom sheet', async ({ page }) => {
    test.skip(test.info().project.name !== 'mobile', 'the bottom sheet is a mobile surface')

    const environment = await openGallery(page)
    const trigger = page.getByRole('button', { name: '打开底部抽屉', exact: true })
    await trigger.focus()
    await trigger.click()

    const sheet = page.locator('#gallery-sheet-bottom')
    await expect(sheet).toBeVisible()
    await expectModalBackground(page, true)

    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    await expectModalBackground(page, false)
    await expect(trigger).toBeFocused()

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })
})
