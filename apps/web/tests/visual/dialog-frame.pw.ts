import { expect, test, type Locator } from '@playwright/test'
import { expectNoBrowserErrors, recordBrowserErrors } from './browser-errors'
import { apiFixtures, ok, type ApiFixture } from './fixtures'
import { installDeterministicEnvironment, waitForPageReady } from './harness'

const DIALOG_MAX_HEIGHT_INSET = 32

const manyOperators = Array.from({ length: 48 }, (_, index) => ({
  id: `char_dialog_frame_${index}`,
  name: `视口干员${index + 1}`,
  rarity: 5,
  profession: 'CASTER',
  currentElite: 0,
  targetElite: 2,
  owned: true,
  hasMaterialData: true,
  canTrain: true,
  progress: 0.1,
}))

const dialogFrameFixtures: ApiFixture[] = [
  { path: '/agent/training/operators', payload: ok({ operators: manyOperators }) },
  ...apiFixtures,
]

async function elementGeometry(element: Locator) {
  return element.evaluate(node => {
    const rect = node.getBoundingClientRect()
    return {
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height,
      viewportHeight: window.innerHeight,
    }
  })
}

test.describe('dialog frame', () => {
  test.beforeEach(async ({ page }) => {
    recordBrowserErrors(page)
  })

  test('keeps a long four-column dialog inside the viewport with fixed header and footer', async ({ page }) => {
    test.skip(test.info().project.name === 'tablet', 'the dialog frame is verified at desktop and mobile widths')

    const environment = await installDeterministicEnvironment(page, { fixtures: dialogFrameFixtures })
    await page.goto('/app/training')
    await waitForPageReady(page, 'training')
    await page.getByRole('button', { name: '继续添加', exact: true }).click()

    const dialog = page.getByRole('dialog', { name: '添加干员', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('aria-modal', 'true')

    const dialogGeometry = await elementGeometry(dialog)
    expect(dialogGeometry.height).toBeGreaterThan(0)
    expect(dialogGeometry.height).toBeLessThanOrEqual(dialogGeometry.viewportHeight - DIALOG_MAX_HEIGHT_INSET + 0.5)
    expect(dialogGeometry.top).toBeGreaterThanOrEqual(0)
    expect(dialogGeometry.bottom).toBeLessThanOrEqual(dialogGeometry.viewportHeight + 0.5)

    const body = dialog.locator('[data-slot="dialog-body"]')
    await expect.poll(() => body.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)

    const header = dialog.locator('[data-slot="dialog-header"]')
    const footer = dialog.locator('[data-slot="dialog-footer"]')
    const headerBefore = await header.boundingBox()
    const footerBefore = await footer.boundingBox()

    await body.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    const headerAfter = await header.boundingBox()
    const footerAfter = await footer.boundingBox()
    expect(headerBefore).not.toBeNull()
    expect(footerBefore).not.toBeNull()
    expect(headerAfter!.y).toBeCloseTo(headerBefore!.y, 0)
    expect(headerAfter!.height).toBeCloseTo(headerBefore!.height, 0)
    expect(footerAfter!.y).toBeCloseTo(footerBefore!.y, 0)
    expect(footerAfter!.height).toBeCloseTo(footerBefore!.height, 0)

    await dialog.getByRole('button', { name: '关闭对话框', exact: true }).click()
    await expect(dialog).toBeHidden()

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })
})
