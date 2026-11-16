import { expect, test } from '@playwright/test'
import { expectNoBrowserErrors, recordBrowserErrors } from './browser-errors'
import { apiFixtures, ok, type ApiFixture } from './fixtures'
import {
  THEMES,
  installDeterministicEnvironment,
  readMotionDurations,
  removeMotionFreeze,
  themeSeedScript,
  waitForPageReady,
} from './harness'

const shortFlowFixtures: ApiFixture[] = apiFixtures.map(fixture =>
  fixture.path === '/agent/config/user/automation-tasks'
    ? {
        ...fixture,
        payload: ok({
          taskFlow: [
            {
              id: 'startup-visual-1',
              commandId: 'startup',
              name: '启动游戏',
              description: '启动游戏客户端',
              defaultParams: { clientType: 'Official' },
              params: { clientType: 'Official', address: '127.0.0.1:5555' },
              enabled: true,
            },
          ],
          schedule: { enabled: true, entries: [] },
        }),
      }
    : fixture)

const longFlowFixtures: ApiFixture[] = apiFixtures.map(fixture =>
  fixture.path === '/agent/config/user/automation-tasks'
    ? {
        ...fixture,
        payload: ok({
          taskFlow: Array.from({ length: 12 }, (_, index) => ({
            id: index === 0 ? 'startup-visual-long' : `award-visual-long-${index}`,
            commandId: index === 0 ? 'startup' : 'award',
            name: index === 0 ? '启动游戏' : `领取奖励 ${index}`,
            description: index === 0 ? '启动游戏客户端' : '领取每日奖励',
            defaultParams: index === 0 ? { clientType: 'Official' } : { award: true },
            params: index === 0
              ? { clientType: 'Official', address: '127.0.0.1:5555' }
              : { award: true, mail: true, recruit: true },
            enabled: true,
          })),
          schedule: { enabled: false, entries: [] },
        }),
      }
    : fixture)

test.describe('compact shell sticky flow panel', () => {
  test.use({ viewport: { width: 960, height: 800 } })

  test('keeps the flow panel below the navbar and above the tabbar while scrolling', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'the compact shell geometry is measured under a dedicated viewport')

    recordBrowserErrors(page)
    await page.addInitScript(themeSeedScript('dark'))
    const environment = await installDeterministicEnvironment(page, { fixtures: longFlowFixtures })

    await page.goto('/app/automation')
    await waitForPageReady(page, 'automation')

    const panel = page.locator('.automation-sequence-panel')
    await expect(panel).toBeVisible()

    const scrollHost = page.locator('[data-region="scroll"]')
    const readGeometry = () => page.evaluate(() => {
      const navbar = document.querySelector<HTMLElement>('[data-region="navbar"]')
      const tabbar = document.querySelector<HTMLElement>('[data-region="tabbar"]')
      const sequencePanel = document.querySelector<HTMLElement>('.automation-sequence-panel')
      const host = document.querySelector<HTMLElement>('[data-region="scroll"]')
      if (!navbar || !tabbar || !sequencePanel || !host) throw new Error('compact shell geometry anchors are missing')
      const navbarRect = navbar.getBoundingClientRect()
      const tabbarRect = tabbar.getBoundingClientRect()
      const panelRect = sequencePanel.getBoundingClientRect()
      return {
        scrollTop: host.scrollTop,
        navbarBottom: navbarRect.bottom,
        tabbarTop: tabbarRect.top,
        panelTop: panelRect.top,
        panelBottom: panelRect.bottom,
      }
    })

    await scrollHost.evaluate(host => {
      const maxScroll = host.scrollHeight - host.clientHeight
      host.scrollTop = Math.max(200, Math.floor(maxScroll / 2))
    })

    const midway = await readGeometry()
    expect(midway.scrollTop).toBeGreaterThan(0)
    expect(midway.panelTop).toBeGreaterThanOrEqual(midway.navbarBottom + 8)
    expect(midway.panelBottom).toBeLessThanOrEqual(midway.tabbarTop - 8)

    await scrollHost.evaluate(host => { host.scrollTop += 120 })
    const scrolled = await readGeometry()
    expect(scrolled.scrollTop).toBeGreaterThan(midway.scrollTop)
    expect(Math.abs(scrolled.panelTop - midway.panelTop)).toBeLessThanOrEqual(1)

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })
})

test.describe('task flow scroll containment', () => {
  test('keeps a long task flow scrollable inside the viewport', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'the flow containment regression is measured on desktop')

    recordBrowserErrors(page)
    await page.addInitScript(themeSeedScript('dark'))
    const environment = await installDeterministicEnvironment(page, { fixtures: longFlowFixtures })

    await page.goto('/app/automation')
    await waitForPageReady(page, 'automation')

    const panel = page.locator('.automation-sequence-panel')
    const list = page.locator('.automation-sequence-list')
    await expect(panel).toBeVisible()
    await expect(list).toBeVisible()

    await panel.evaluate(node => {
      const host = document.querySelector<HTMLElement>('[data-region="scroll"]')
      if (!host) throw new Error('application scroll host is missing')
      const panelTop = node.getBoundingClientRect().top - host.getBoundingClientRect().top
      host.scrollTop += panelTop - 16
    })

    const metrics = await page.evaluate(() => {
      const hostNode = document.querySelector<HTMLElement>('[data-region="scroll"]')
      const panelNode = document.querySelector<HTMLElement>('.automation-sequence-panel')
      const listNode = document.querySelector<HTMLElement>('.automation-sequence-list')
      if (!hostNode || !panelNode || !listNode) throw new Error('automation sequence panel is missing')
      return {
        scrollportTop: hostNode.getBoundingClientRect().top,
        scrollportBottom: hostNode.getBoundingClientRect().bottom,
        panelTop: panelNode.getBoundingClientRect().top,
        panelBottom: panelNode.getBoundingClientRect().bottom,
        scrollHeight: listNode.scrollHeight,
        clientHeight: listNode.clientHeight,
        overflowY: getComputedStyle(listNode).overflowY,
      }
    })

    expect(metrics.panelTop).toBeGreaterThanOrEqual(metrics.scrollportTop - 1)
    expect(metrics.panelBottom).toBeLessThanOrEqual(metrics.scrollportBottom + 1)
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)
    expect(metrics.overflowY).toBe('auto')

    const before = await list.evaluate(element => element.scrollTop)
    await list.evaluate(element => { element.scrollTop = element.scrollHeight })
    const after = await list.evaluate(element => element.scrollTop)
    expect(after).toBeGreaterThan(before)

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })
})

for (const theme of THEMES) {
  test.describe(`task picker: ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      recordBrowserErrors(page)
      await page.addInitScript(themeSeedScript(theme))
    })

    test(`shows the add-task options without clipping the menu or its options ${theme}`, async ({ page }) => {
      const environment = await installDeterministicEnvironment(page, { fixtures: shortFlowFixtures })

      await page.goto('/app/automation')
      await waitForPageReady(page, 'automation')

      const trigger = page.getByRole('button', { name: /添加任务/ })
      await trigger.click()
      const menu = page.getByRole('menu', { name: '可添加任务' })
      await expect(menu).toBeVisible()
      await expect(menu).toHaveCSS('opacity', '1')

      const viewport = page.viewportSize()!
      const triggerBox = await trigger.boundingBox()
      const menuBox = await menu.boundingBox()
      expect(triggerBox).not.toBeNull()
      expect(menuBox).not.toBeNull()
      expect(menuBox!.y).toBeGreaterThanOrEqual(0)
      expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(viewport.height)
      expect(Math.abs(menuBox!.width - triggerBox!.width)).toBeLessThanOrEqual(1)
      expect(menuBox!.height).toBeLessThanOrEqual(225)

      const clippedOptions = await menu.evaluate((picker) => {
        const menuRect = picker.getBoundingClientRect()

        return Array.from(picker.querySelectorAll<HTMLElement>('[role="menuitem"]')).flatMap(option => {
          const rect = option.getBoundingClientRect()
          const insideMenu = rect.top >= menuRect.top && rect.bottom <= menuRect.bottom
          if (!insideMenu) return []

          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          return hit === option || option.contains(hit) ? [] : [option.textContent ?? '']
        })
      })

      expect(clippedOptions).toEqual([])

      environment.assertNoUnmatchedApi()
      await expectNoBrowserErrors(page)
    })

    test(`keeps the menu open for presses inside the footer and closes outside it ${theme}`, async ({ page }) => {
      const environment = await installDeterministicEnvironment(page, { fixtures: shortFlowFixtures })

      await page.goto('/app/automation')
      await waitForPageReady(page, 'automation')

      await page.getByRole('button', { name: /添加任务/ }).click()
      const menu = page.getByRole('menu', { name: '可添加任务' })
      await expect(menu).toBeVisible()

      const footerBox = await page.locator('.automation-sequence-footer').boundingBox()
      expect(footerBox).not.toBeNull()
      await page.mouse.click(footerBox!.x + 4, footerBox!.y + footerBox!.height - 4)
      await expect(menu).toBeVisible()

      await page.mouse.click(8, 400)
      await expect(menu).toBeHidden()

      environment.assertNoUnmatchedApi()
      await expectNoBrowserErrors(page)
    })

    test(`flips the menu below when the footer sits near the top edge ${theme}`, async ({ page }) => {
      const environment = await installDeterministicEnvironment(page, { fixtures: shortFlowFixtures })

      await page.goto('/app/automation')
      await waitForPageReady(page, 'automation')

      const trigger = page.getByRole('button', { name: /添加任务/ })
      const scrollTop = await page.locator('[data-region="scroll"]')
        .evaluate(host => host.getBoundingClientRect().top)
      const initialBox = await trigger.boundingBox()
      expect(initialBox).not.toBeNull()

      await page.evaluate((delta) => {
        const panel = document.querySelector<HTMLElement>('.automation-sequence-panel')
        if (!panel) throw new Error('automation sequence panel is missing')
        panel.style.transform = `translateY(${delta}px)`
      }, scrollTop + 96 - initialBox!.y)

      await expect.poll(async () => (await trigger.boundingBox())!.y)
        .toBeLessThan(scrollTop + 160)

      await trigger.click()
      const menu = page.getByRole('menu', { name: '可添加任务' })
      await expect(menu).toBeVisible()
      await expect(menu).toHaveAttribute('data-side', 'bottom')

      const viewport = page.viewportSize()!
      const triggerBox = await trigger.boundingBox()
      const menuBox = await menu.boundingBox()
      expect(triggerBox).not.toBeNull()
      expect(menuBox).not.toBeNull()
      expect(menuBox!.y).toBeGreaterThanOrEqual(triggerBox!.y + triggerBox!.height)
      expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(viewport.height)

      environment.assertNoUnmatchedApi()
      await expectNoBrowserErrors(page)
    })
  })
}

test.describe('task picker reduced motion', () => {
  test('disables the portal menu animation', async ({ page }) => {
    recordBrowserErrors(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const environment = await installDeterministicEnvironment(page, { fixtures: shortFlowFixtures })

    await page.goto('/app/automation')
    await waitForPageReady(page, 'automation')
    await removeMotionFreeze(page)

    await page.getByRole('button', { name: /添加任务/ }).click()
    const menu = page.getByRole('menu', { name: '可添加任务' })
    await expect(menu).toBeVisible()

    const motion = await readMotionDurations(menu)
    expect(motion.animation.every(duration => duration <= 0.000011)).toBe(true)
    expect(motion.transition.every(duration => duration <= 0.000011)).toBe(true)

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })
})
