import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectNoBrowserErrors, recordBrowserErrors } from './browser-errors'
import { installDeterministicEnvironment, waitForPageReady } from './harness'

async function layoutZIndex(page: Page, token: string) {
  return page.evaluate(
    name => Number(getComputedStyle(document.documentElement).getPropertyValue(name)),
    token,
  )
}

async function computedZIndex(locator: Locator) {
  return locator.evaluate(element => Number(getComputedStyle(element).zIndex))
}

async function expectHitsInside(locator: Locator, point?: { x: number; y: number }) {
  const hitInside = await locator.evaluate((element, targetPoint) => {
    const box = element.getBoundingClientRect()
    const x = targetPoint?.x ?? box.left + box.width / 2
    const y = targetPoint?.y ?? box.top + box.height / 2
    const hit = document.elementFromPoint(x, y)
    return hit !== null && (hit === element || element.contains(hit))
  }, point)

  expect(hitInside).toBe(true)
}

async function openGallery(page: Page) {
  const environment = await installDeterministicEnvironment(page)
  await page.goto('/dev/theme-gallery')
  await waitForPageReady(page, 'gallery')
  return environment
}

test.describe('z-index stacking', () => {
  test.beforeEach(async ({ page }) => {
    recordBrowserErrors(page)
  })

  test('mobile shell regions follow the layout scale', async ({ page }) => {
    test.skip(test.info().project.name !== 'mobile', 'shell stacking is checked on the mobile projection')

    const environment = await openGallery(page)
    const regions = [
      { locator: page.locator('[data-region="navbar"]'), token: '--layout-z-chrome', value: 20 },
      { locator: page.locator('[data-region="tabbar"]'), token: '--layout-z-tabbar', value: 30 },
      {
        locator: page.getByRole('link', { name: '跳到主要内容', exact: true }),
        token: '--layout-z-raised',
        value: 40,
      },
    ]

    for (const { locator, token, value } of regions) {
      expect(await layoutZIndex(page, token)).toBe(value)
      expect(await computedZIndex(locator)).toBe(value)
    }

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('portal dropdown uses the portal layer and stays hittable', async ({ page }) => {
    const environment = await openGallery(page)
    const group = page.locator('[data-region="gallery-overlays"]')
    await group.scrollIntoViewIfNeeded()

    await page.getByRole('button', { name: '筛选排序', exact: true }).click()
    const menu = page.getByRole('menu', { name: '筛选排序', exact: true })
    await expect(menu).toBeVisible()

    const portalZ = await layoutZIndex(page, '--layout-z-portal')
    expect(await computedZIndex(menu)).toBe(portalZ)
    expect(await menu.evaluate(element => (
      element.parentElement ? Number(getComputedStyle(element.parentElement).zIndex) : NaN
    ))).toBe(portalZ)
    await expectHitsInside(menu)

    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('portal sheet covers the tabbar and stays hittable', async ({ page }) => {
    test.skip(test.info().project.name !== 'mobile', 'the tabbar is present on the mobile projection')

    const environment = await openGallery(page)
    const tabbar = page.locator('[data-region="tabbar"]')
    await page.getByRole('button', { name: '更多页面', exact: true }).click()

    const sheet = page.getByRole('dialog', { name: '更多工作区', exact: true })
    await expect(sheet).toBeVisible()

    const [sheetBox, tabbarBox] = await Promise.all([
      sheet.boundingBox(),
      tabbar.boundingBox(),
    ])
    expect(sheetBox).not.toBeNull()
    expect(tabbarBox).not.toBeNull()

    const overlap = {
      left: Math.max(sheetBox!.x, tabbarBox!.x),
      right: Math.min(sheetBox!.x + sheetBox!.width, tabbarBox!.x + tabbarBox!.width),
      top: Math.max(sheetBox!.y, tabbarBox!.y),
      bottom: Math.min(sheetBox!.y + sheetBox!.height, tabbarBox!.y + tabbarBox!.height),
    }
    expect(overlap.right).toBeGreaterThan(overlap.left)
    expect(overlap.bottom).toBeGreaterThan(overlap.top)

    expect(await computedZIndex(sheet)).toBe(await layoutZIndex(page, '--layout-z-portal'))
    await expectHitsInside(sheet, {
      x: (overlap.left + overlap.right) / 2,
      y: (overlap.top + overlap.bottom) / 2,
    })

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('toasts use the toast layer', async ({ page }) => {
    test.skip(test.info().project.name !== 'mobile', 'toast stacking is checked on the mobile projection')

    const environment = await openGallery(page)
    const group = page.locator('[data-region="gallery-overlays"]')
    await group.scrollIntoViewIfNeeded()

    await page.getByRole('button', { name: '显示可撤销提示', exact: true }).click()
    await expect(page.locator('[data-sonner-toast]')).toBeVisible()

    const toaster = page.locator('[data-sonner-toaster]')
    await expect(toaster).toHaveCount(1)
    expect(await computedZIndex(toaster)).toBe(await layoutZIndex(page, '--layout-z-toast'))

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })
})
