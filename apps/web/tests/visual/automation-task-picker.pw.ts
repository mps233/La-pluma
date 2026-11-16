import { expect, test } from '@playwright/test'
import { expectNoBrowserErrors, recordBrowserErrors } from './browser-errors'
import { apiFixtures, ok, type ApiFixture } from './fixtures'
import {
  THEMES,
  installDeterministicEnvironment,
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

    test(`shows the add-task options above a short flow without clipping ${theme}`, async ({ page }) => {
      const environment = await installDeterministicEnvironment(page, { fixtures: shortFlowFixtures })

      await page.goto('/app/automation')
      await waitForPageReady(page, 'automation')

      await page.getByRole('button', { name: '添加任务' }).click()
      const menu = page.getByRole('menu', { name: '可添加任务' })
      await expect(menu).toBeVisible()
      await expect(menu).toHaveCSS('opacity', '1')

      const viewport = page.viewportSize()!
      const menuBox = await menu.boundingBox()
      expect(menuBox).not.toBeNull()
      expect(menuBox!.y).toBeGreaterThanOrEqual(0)
      expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(viewport.height)

      const clippedOptions = await page.evaluate(() => {
        const picker = document.querySelector('#automation-task-picker')
        if (!picker) throw new Error('task picker menu is missing')
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
  })
}
