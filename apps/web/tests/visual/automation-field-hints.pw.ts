import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectNoBrowserErrors, recordBrowserErrors } from './browser-errors'
import { apiFixtures, ok, type ApiFixture } from './fixtures'
import { installDeterministicEnvironment, waitForPageReady } from './harness'

const ACCOUNT_HINT = '输入已登录账号的部分字符即可，如 "123****4567" 可输入 "4567"'
const LAUNCH_HINT = '关闭后只连接设备并进入已有游戏的主界面，不会启动游戏客户端'
const INFRAST_HINT = '一键轮换使用游戏内队列，并保留无人机、会客室等基础操作'

const infrastFixtures = [
  {
    path: '/agent/config/user/automation-tasks',
    payload: ok({
      taskFlow: [
        {
          id: 'startup-visual-1',
          commandId: 'startup',
          name: '启动游戏',
          description: '启动游戏客户端',
          enabled: true,
          params: { clientType: 'Official', accountName: '' },
        },
        {
          id: 'infrast-visual-2',
          commandId: 'infrast',
          name: '基建换班',
          description: '自动基建换班收菜',
          taskType: 'Infrast',
          enabled: true,
          params: { mode: '0', facility: ['Mfg', 'Recycle', 'AssistantChange'] },
        },
      ],
    }),
  },
  ...apiFixtures,
]

const MALL_HINTS = [
  { key: 'only_buy_discount', label: '只买折扣商品', copy: '仅影响优先购买之外的普通购物' },
  { key: 'reserve_max_credit', label: '保留 300 信用', copy: '普通购物时信用低于 300 就停止购买' },
  { key: 'credit_fight', label: '信用助战', copy: '借助战完成一次 OF-1，以便次日获得更多信用' },
] as const

const mallTaskFixture: ApiFixture = {
  path: '/agent/config/user/automation-tasks',
  payload: ok({
    taskFlow: [
      {
        id: 'mall-visual-1',
        commandId: 'mall',
        name: '信用收支',
        description: '访问好友、收取信用',
        taskType: 'Mall',
        enabled: true,
        params: {
          visit_friends: true,
          shopping: true,
          buy_first: '',
          blacklist: '',
          force_shopping_if_credit_full: false,
          only_buy_discount: false,
          reserve_max_credit: false,
          credit_fight: false,
          formation_index: 0,
        },
      },
    ],
    schedule: { enabled: false, entries: [] },
  }),
}

const RECRUIT_HINTS = {
  '无许可时仍刷新说明': '招聘许可耗尽后，仍会使用可用刷新次数',
  '招募星级说明': '支持 6 星自动公招；勾选 6 星后会保留高价值标签并自动选择对应组合',
  '确认星级说明': '建议至少保留 5/6 星确认，避免高价值标签被跳过；不勾选任何星级时只计算标签，不会确认招募',
  '招募次数说明': '设为 0 时只计算标签，不执行招募',
  '保留标签说明': '识别到任一标签时保留该公招槽位，多个标签用逗号分隔',
  '3 星保留招聘许可说明': '自动确认 3 星时保留的招聘许可数量；剩余许可小于等于该值时跳过 3 星招募，0 表示不保留',
} as const

const RECRUIT_ADVANCED_HINTS = {
  '多选 Tag 策略说明': '默认行为只选能组成有效组合的 Tag；“选 3 个 Tags”会尽量凑满 3 个；“尽量多选高星 Tag 组合”优先保留高星组合，可能包含冲突标签。',
  '三星首选说明': '仅在三星组合中优先选择，多个标签用逗号分隔。',
  '招募时长说明': '可设置 60 至 540 分钟，按 10 分钟调整；五星和六星固定为 540 分钟。',
} as const

const recruitFixtures = [
  {
    path: '/agent/config/user/automation-tasks',
    payload: ok({
      taskFlow: [
        {
          id: 'recruit-visual-1',
          commandId: 'recruit',
          name: '自动公招',
          description: '自动公开招募',
          taskType: 'Recruit',
          enabled: true,
          params: {
            refresh: true,
            force_refresh: true,
            select: [4, 5, 6],
            confirm: [3, 4],
            times: '4',
            set_time: true,
            expedite: false,
            expedite_times: 0,
            preserve_tags: '支援机械',
            first_tags: '',
            extra_tags_mode: 0,
            level3_recruitment_permit_reserve: 0,
            recruitment_time: { '3': 540, '4': 540 },
          },
        },
      ],
    }),
  },
  ...apiFixtures,
]

const labelTextRect = async (page: Page, legend: Locator) => {
  const handle = await legend.elementHandle()
  return page.evaluate((element) => {
    const textNode = element?.querySelector('span')?.firstChild
    if (!textNode) return null
    const range = document.createRange()
    range.selectNodeContents(textNode)
    const rect = range.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }, handle)
}

const hintGap = async (label: Locator, hint: Locator) => {
  const labelBox = await label.boundingBox()
  const hintBox = await hint.boundingBox()
  expect(labelBox).not.toBeNull()
  expect(hintBox).not.toBeNull()
  return {
    gap: hintBox!.x - (labelBox!.x + labelBox!.width),
    centerOffset: hintBox!.y + hintBox!.height / 2 - (labelBox!.y + labelBox!.height / 2),
  }
}

const expectTooltipNotClipped = async (tooltip: Locator) => {
  const clippedByAncestor = await tooltip.evaluate(element => {
    const rect = element.getBoundingClientRect()
    let ancestor = element.parentElement
    while (ancestor && ancestor !== document.body) {
      const style = getComputedStyle(ancestor)
      const clipsX = style.overflowX !== 'visible'
      const clipsY = style.overflowY !== 'visible'
      if (clipsX || clipsY) {
        const ancestorRect = ancestor.getBoundingClientRect()
        if (clipsX && (rect.left < ancestorRect.left || rect.right > ancestorRect.right)) return true
        if (clipsY && (rect.top < ancestorRect.top || rect.bottom > ancestorRect.bottom)) return true
      }
      ancestor = ancestor.parentElement
    }
    return false
  })
  expect(clippedByAncestor).toBe(false)
}

const isMobileProject = () => test.info().project.name === 'mobile'

const revealHint = async (hint: Locator) => {
  if (isMobileProject()) await hint.tap()
  else await hint.hover()
}

const dismissHint = async (page: Page) => {
  if (isMobileProject()) await page.touchscreen.tap(4, 4)
  else await page.mouse.move(4, 4)
}

const clickOutside = async (page: Page) => {
  if (isMobileProject()) await page.touchscreen.tap(4, 4)
  else await page.mouse.click(4, 4)
}

const FIGHT_HINTS: Array<[string, string]> = [
  ['关卡计划说明', '使用 HD-数字代表当前活动关卡；置顶关卡会优先执行。次数为该关卡的累计作战局数上限（连战中的每一局都计 1），留空表示不限制局数'],
  ['掉落目标说明', '任一物品达到目标数量后停止；格式为物品 ID=数量，多个目标用逗号分隔'],
  ['理智药说明', '使用理智药数量'],
  ['临期药天数说明', '使用将在指定天数内过期的理智药；0 表示不使用临期药'],
  ['源石说明', '使用源石数量'],
  ['连战说明', '本任务所有关卡共用的连战倍率，范围 -1 至 10（旧资源只支持 -1 至 6）；与各关卡次数同时生效：固定倍率时次数少于倍率不会开始任何一局（0 局）；指定倍率不能整除剩余次数时最后一轮连战不会开始，实际局数会少于次数；选“自动”会按剩余次数调整'],
  ['闪退重启说明', '选择客户端后，游戏闪退时会自动重新启动。'],
  ['葛朗台碎石模式说明', '使用源石前等待自然恢复 1 点理智，尽量减少碎石浪费。'],
]

const selectFightTask = async (page: Page) => {
  await page.locator('[aria-controls="automation-task-editor"]').filter({ hasText: '理智作战' }).click()
  await expect(page.getByRole('button', { name: '关卡计划说明', exact: true })).toBeVisible()

}

test.describe('automation field hints', () => {
  test.beforeEach(async ({ page }) => {
    recordBrowserErrors(page)
  })

  test('reveals the startup helper texts on hover and focus', async ({ page }) => {
    const environment = await installDeterministicEnvironment(page)
    await page.goto('/app/automation')
    await waitForPageReady(page, 'automation')

    const accountHint = page.getByRole('button', { name: '切换账号说明', exact: true })
    const launchHint = page.getByRole('button', { name: '启动游戏客户端说明', exact: true })
    await expect(accountHint).toBeVisible()
    await expect(launchHint).toBeVisible()

    const accountTooltip = page.getByRole('tooltip').filter({ hasText: ACCOUNT_HINT })
    const launchTooltip = page.getByRole('tooltip').filter({ hasText: LAUNCH_HINT })
    await expect(accountTooltip).toBeHidden()
    await expect(launchTooltip).toBeHidden()
    expect(await accountHint.getAttribute('aria-describedby')).toBeNull()

    await revealHint(accountHint)
    await expect(accountTooltip).toBeVisible()
    await expect(accountTooltip).toHaveText(ACCOUNT_HINT)
    const describedBy = await accountHint.getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    await expect(page.locator(`#${describedBy}`)).toHaveAttribute('role', 'tooltip')

    await dismissHint(page)
    await expect(accountTooltip).toBeHidden()
    expect(await accountHint.getAttribute('aria-describedby')).toBeNull()

    await launchHint.focus()
    await expect(launchHint).toBeFocused()
    await expect(launchTooltip).toBeVisible()
    await expect(launchTooltip).toHaveText(LAUNCH_HINT)
    await page.keyboard.press('Escape')
    await expect(launchTooltip).toBeHidden()

    await accountHint.click()
    await expect(accountTooltip).toBeVisible()
    await clickOutside(page)
    await expect(accountTooltip).toBeHidden()

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('hangs the mall helper icons right after their labels', async ({ page }) => {
    const environment = await installDeterministicEnvironment(page, {
      fixtures: apiFixtures.map(fixture => (
        fixture.path === mallTaskFixture.path ? mallTaskFixture : fixture
      )),
    })
    await page.goto('/app/automation')
    await page.locator('label:has(#automation-mall-visual-1-shopping)').waitFor({ state: 'visible', timeout: 20_000 })
    await page.evaluate(() => document.fonts.ready)

    const measure = async (label: Locator, hint: Locator) => {
      const labelBox = await label.boundingBox()
      const hintBox = await hint.boundingBox()
      expect(labelBox).not.toBeNull()
      expect(hintBox).not.toBeNull()
      return {
        gap: hintBox!.x - (labelBox!.x + labelBox!.width),
        centerOffset: hintBox!.y + hintBox!.height / 2 - (labelBox!.y + labelBox!.height / 2),
      }
    }

    const gaps = new Set<number>()
    for (const hint of MALL_HINTS) {
      const box = await measure(
        page.locator(`label:has(#automation-mall-visual-1-${hint.key})`),
        page.getByRole('button', { name: `${hint.label}说明`, exact: true }),
      )
      // 标签到 ⓘ 之间只留 inline 的 4px 小间距，而不是被推到行尾。
      expect(box.gap).toBeGreaterThan(0)
      expect(Math.abs(box.gap - 4)).toBeLessThanOrEqual(2)
      expect(Math.abs(box.centerOffset)).toBeLessThanOrEqual(2)
      gaps.add(Math.round(box.gap))
    }
    // 三个开关的图标与标签间距一致，观感与 startup 卡片相同。
    expect(gaps.size).toBe(1)

    for (const hint of MALL_HINTS) {
      const tooltip = page.getByRole('tooltip').filter({ hasText: hint.copy })
      await expect(tooltip).toBeHidden()
      // 常驻说明段落已删除：文案只在打开提示层时挂载。
      await expect(page.getByText(hint.copy, { exact: true })).toHaveCount(0)
    }

    const discountHint = page.getByRole('button', { name: '只买折扣商品说明', exact: true })
    const discountTooltip = page.getByRole('tooltip').filter({ hasText: MALL_HINTS[0].copy })
    await revealHint(discountHint)
    await expect(discountTooltip).toBeVisible()
    await expect(discountTooltip).toHaveText(MALL_HINTS[0].copy)
    await dismissHint(page)
    await expect(discountTooltip).toBeHidden()

    const creditFightHint = page.getByRole('button', { name: '信用助战说明', exact: true })
    const creditFightTooltip = page.getByRole('tooltip').filter({ hasText: MALL_HINTS[2].copy })
    await creditFightHint.focus()
    await expect(creditFightHint).toBeFocused()
    await expect(creditFightTooltip).toBeVisible()
    await expect(creditFightTooltip).toHaveText(MALL_HINTS[2].copy)
    await page.keyboard.press('Escape')
    await expect(creditFightTooltip).toBeHidden()

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('hands off between adjacent hints and lets pointers pass through the open tooltip', async ({ page }) => {
    test.skip(isMobileProject(), 'hover handoff is a mouse behavior; mobile tap handoff is covered by the tap cases')
    const environment = await installDeterministicEnvironment(page)
    await page.goto('/app/automation')
    await waitForPageReady(page, 'automation')

    const accountHint = page.getByRole('button', { name: '切换账号说明', exact: true })
    const launchHint = page.getByRole('button', { name: '启动游戏客户端说明', exact: true })
    const accountTooltip = page.getByRole('tooltip').filter({ hasText: ACCOUNT_HINT })
    const launchTooltip = page.getByRole('tooltip').filter({ hasText: LAUNCH_HINT })

    await accountHint.hover()
    await expect(accountTooltip).toBeVisible()

    const accountBox = await accountTooltip.boundingBox()
    const launchBox = await launchHint.boundingBox()
    expect(accountBox).not.toBeNull()
    expect(launchBox).not.toBeNull()

    const overlap = {
      x: Math.max(accountBox!.x, launchBox!.x),
      y: Math.max(accountBox!.y, launchBox!.y),
      right: Math.min(accountBox!.x + accountBox!.width, launchBox!.x + launchBox!.width),
      bottom: Math.min(accountBox!.y + accountBox!.height, launchBox!.y + launchBox!.height),
    }
    expect(overlap.right).toBeGreaterThan(overlap.x)
    expect(overlap.bottom).toBeGreaterThan(overlap.y)

    const overlapPoint = { x: (overlap.x + overlap.right) / 2, y: (overlap.y + overlap.bottom) / 2 }
    expect(await accountTooltip.evaluate((element, point) => {
      const hit = document.elementFromPoint(point.x, point.y)
      return hit !== null && !element.contains(hit)
    }, overlapPoint)).toBe(true)
    expect(await launchHint.evaluate((element, point) => {
      const hit = document.elementFromPoint(point.x, point.y)
      return hit !== null && (hit === element || element.contains(hit))
    }, overlapPoint)).toBe(true)

    const accountTriggerBox = await accountHint.boundingBox()
    const launchTriggerBox = await launchHint.boundingBox()
    expect(accountTriggerBox).not.toBeNull()
    expect(launchTriggerBox).not.toBeNull()
    await page.mouse.move(
      accountTriggerBox!.x + accountTriggerBox!.width / 2,
      accountTriggerBox!.y + accountTriggerBox!.height / 2,
    )
    await expect(accountTooltip).toBeVisible()
    await page.mouse.move(
      launchTriggerBox!.x + launchTriggerBox!.width / 2,
      launchTriggerBox!.y + launchTriggerBox!.height / 2,
    )
    await expect(accountTooltip).toBeHidden()
    await expect(launchTooltip).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(launchTooltip).toBeHidden()
    await accountHint.hover()
    await expect(accountTooltip).toBeVisible()
    await page.mouse.click(overlapPoint.x, overlapPoint.y)
    await expect(accountTooltip).toBeHidden()
    await expect(launchTooltip).toBeVisible()

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('keeps the revealed hint inside the viewport and above the panels', async ({ page }) => {
    const environment = await installDeterministicEnvironment(page)
    await page.goto('/app/automation')
    await waitForPageReady(page, 'automation')

    const accountHint = page.getByRole('button', { name: '切换账号说明', exact: true })
    const accountTooltip = page.getByRole('tooltip').filter({ hasText: ACCOUNT_HINT })

    await revealHint(accountHint)
    await expect(accountTooltip).toBeVisible()

    const viewport = page.viewportSize()!
    const box = await accountTooltip.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)

    // 提示层挂在 body 下，祖先链上没有会裁切它的 overflow 容器。
    await expectTooltipNotClipped(accountTooltip)
    // 提示层与旧实现一样位于应用 chrome（navbar 60 / tabbar 70）和模态层 80 之上。
    expect(await accountTooltip.evaluate(element => {
      const positioner = element.parentElement
      return positioner ? Number(getComputedStyle(positioner).zIndex) : 0
    })).toBeGreaterThanOrEqual(2000)
    // 纯文本提示不接收指针事件，覆盖到相邻控件时不能吞掉点击。
    expect(await accountTooltip.evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none')
    expect(await accountTooltip.evaluate(element => {
      const rect = element.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return hit !== null && !element.contains(hit)
    })).toBe(true)

    // 说明文字不再有常驻段落：打开时只有 tooltip 一处承载它。
    await expect(page.getByText(ACCOUNT_HINT, { exact: true })).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(accountTooltip).toBeHidden()
    await expect(page.getByText(ACCOUNT_HINT, { exact: true })).toHaveCount(0)

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('moves the recruit helper texts beside their labels and keeps the advanced section', async ({ page }) => {
    const environment = await installDeterministicEnvironment(page, { fixtures: recruitFixtures })
    await page.goto('/app/automation')
    await page.getByText('自动公招', { exact: false }).first().waitFor({ state: 'visible' })
    await page.evaluate(() => document.fonts.ready)

    for (const [name, copy] of Object.entries(RECRUIT_HINTS)) {
      const hint = page.getByRole('button', { name, exact: true })
      await expect(hint).toBeVisible()
      const tooltip = page.getByRole('tooltip').filter({ hasText: copy })
      await expect(tooltip).toBeHidden()
      // 说明文字不再有常驻段落：只有打开提示层时才挂载。
      await expect(page.getByText(copy, { exact: true })).toHaveCount(0)
    }

    const forceRefreshHint = page.getByRole('button', { name: '无许可时仍刷新说明', exact: true })
    await revealHint(forceRefreshHint)
    await expect(page.getByRole('tooltip').filter({ hasText: RECRUIT_HINTS['无许可时仍刷新说明'] })).toBeVisible()
    await dismissHint(page)

    const timesHint = page.getByRole('button', { name: '招募次数说明', exact: true })
    await timesHint.focus()
    await expect(timesHint).toBeFocused()
    await expect(page.getByRole('tooltip').filter({ hasText: RECRUIT_HINTS['招募次数说明'] })).toBeVisible()
    await page.keyboard.press('Escape')

    const checkboxRow = await hintGap(
      page.locator('label:has(#automation-recruit-visual-1-force_refresh)'),
      forceRefreshHint,
    )
    const numberRow = await hintGap(
      page.locator('label[for="automation-recruit-visual-1-times"]'),
      timesHint,
    )
    const longLabelRow = await hintGap(
      page.locator('label[for="automation-recruit-visual-1-level3_recruitment_permit_reserve"]'),
      page.getByRole('button', { name: '3 星保留招聘许可说明', exact: true }),
    )
    const starLegend = page.locator('#automation-task-editor legend').filter({ hasText: '招募星级' })
    const starText = await labelTextRect(page, starLegend)
    const starHintBox = await page.getByRole('button', { name: '招募星级说明', exact: true }).boundingBox()
    expect(starText).not.toBeNull()
    expect(starHintBox).not.toBeNull()

    // 图标紧贴标签文字（4–6px），而不是被推到行尾。
    for (const measured of [checkboxRow, numberRow, longLabelRow]) {
      expect(measured.gap).toBeGreaterThanOrEqual(3)
      expect(measured.gap).toBeLessThanOrEqual(6)
      expect(Math.abs(measured.centerOffset)).toBeLessThanOrEqual(2)
    }
    expect(starHintBox!.x - (starText!.x + starText!.width)).toBeGreaterThanOrEqual(3)
    expect(starHintBox!.x - (starText!.x + starText!.width)).toBeLessThanOrEqual(6)

    const details = page.locator('#automation-task-editor details').first()
    const summary = details.locator('summary')
    for (const name of Object.keys(RECRUIT_ADVANCED_HINTS)) {
      await expect(page.getByRole('button', { name, exact: true })).toBeHidden()
    }

    await summary.click()
    await expect(details).toHaveAttribute('open', '')
    for (const [name, copy] of Object.entries(RECRUIT_ADVANCED_HINTS)) {
      const hint = page.getByRole('button', { name, exact: true })
      await expect(hint).toBeVisible()
      await expect(page.getByText(copy, { exact: true })).toHaveCount(0)
    }

    const advancedHint = page.getByRole('button', { name: '多选 Tag 策略说明', exact: true })
    await revealHint(advancedHint)
    await expect(page.getByRole('tooltip').filter({ hasText: RECRUIT_ADVANCED_HINTS['多选 Tag 策略说明'] }))
      .toBeVisible()
    await dismissHint(page)

    const themeFieldset = page.locator('#automation-task-editor fieldset').last()
    const themeText = await labelTextRect(page, themeFieldset.locator('legend'))
    const themeHintBox = await page.getByRole('button', { name: '招募时长说明', exact: true }).boundingBox()
    expect(themeText).not.toBeNull()
    expect(themeHintBox).not.toBeNull()
    expect(themeHintBox!.x - (themeText!.x + themeText!.width)).toBeGreaterThanOrEqual(3)
    expect(themeHintBox!.x - (themeText!.x + themeText!.width)).toBeLessThanOrEqual(6)

    await summary.click()
    await expect(details).not.toHaveAttribute('open', '')
    for (const name of Object.keys(RECRUIT_ADVANCED_HINTS)) {
      await expect(page.getByRole('button', { name, exact: true })).toBeHidden()
    }

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('hangs the launch hint right after its label instead of the row end', async ({ page }) => {
    const environment = await installDeterministicEnvironment(page)
    await page.goto('/app/automation')
    await waitForPageReady(page, 'automation')

    const measure = async (label: Locator, hint: Locator) => {
      const labelBox = await label.boundingBox()
      const hintBox = await hint.boundingBox()
      expect(labelBox).not.toBeNull()
      expect(hintBox).not.toBeNull()
      return {
        gap: hintBox!.x - (labelBox!.x + labelBox!.width),
        centerOffset: hintBox!.y + hintBox!.height / 2 - (labelBox!.y + labelBox!.height / 2),
      }
    }

    const account = await measure(
      page.locator('label[for="automation-startup-visual-1-accountName"]'),
      page.getByRole('button', { name: '切换账号说明', exact: true }),
    )
    const launch = await measure(
      page.locator('label:has(#automation-startup-visual-1-start_game_enabled)'),
      page.getByRole('button', { name: '启动游戏客户端说明', exact: true }),
    )

    // 标签到 ⓘ 按钮之间只留 inline 的小间距，而不是被推到行尾。
    expect(Math.abs(launch.gap - 4)).toBeLessThanOrEqual(2)
    expect(launch.gap).toBeGreaterThan(0)
    // 与「切换账号」旁的 ⓘ 保持同样的间距与垂直居中。
    expect(Math.abs(launch.gap - account.gap)).toBeLessThanOrEqual(1)
    expect(Math.abs(launch.centerOffset)).toBeLessThanOrEqual(2)
    expect(Math.abs(account.centerOffset)).toBeLessThanOrEqual(2)

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('shows the infrast shift-mode hint beside the label and drops the facility hint line', async ({ page }) => {
    const environment = await installDeterministicEnvironment(page, { fixtures: infrastFixtures })
    await page.goto('/app/automation')
    await waitForPageReady(page, 'automation')

    await page.locator('button[aria-controls="automation-task-editor"]')
      .filter({ hasText: '基建换班' })
      .click()

    const shiftModeHint = page.getByRole('button', { name: '换班模式说明', exact: true })
    await expect(shiftModeHint).toBeVisible()

    const shiftModeTooltip = page.getByRole('tooltip').filter({ hasText: INFRAST_HINT })
    await expect(shiftModeTooltip).toBeHidden()

    await revealHint(shiftModeHint)
    await expect(shiftModeTooltip).toBeVisible()
    await expect(shiftModeTooltip).toHaveText(INFRAST_HINT)

    await dismissHint(page)
    await expect(shiftModeTooltip).toBeHidden()

    await shiftModeHint.focus()
    await expect(shiftModeHint).toBeFocused()
    await expect(shiftModeTooltip).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(shiftModeTooltip).toBeHidden()

    // 设施选择下方的常驻提示整行删除，页面里不再出现这段文案或残留图标。
    await expect(page.getByText('选择要换班的设施')).toHaveCount(0)
    await expect(page.getByText(INFRAST_HINT, { exact: true })).toHaveCount(0)

    // 设施网格与副手换人保持完整，勾选状态仍来自配置。
    const facilityFieldset = page.locator('fieldset').filter({ has: page.getByRole('checkbox', { name: '副手换人' }) })
    await expect(facilityFieldset.getByRole('checkbox')).toHaveCount(11)
    await expect(page.getByRole('checkbox', { name: '制造站' })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: '回收站' })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: '副手换人' })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: '贸易站' })).not.toBeChecked()

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })
  test('reveals the fight helper texts on hover and focus without persistent paragraphs', async ({ page }) => {
    const environment = await installDeterministicEnvironment(page)
    await page.goto('/app/automation')
    await waitForPageReady(page, 'automation')
    await selectFightTask(page)

    // 区块级提示位于「关卡计划」标题行内、关卡数量徽标右侧。
    const stageHint = page.getByRole('button', { name: '关卡计划说明', exact: true })
    const stageTitle = page.locator('.automation-stage-editor-title')
    await expect(stageTitle).toContainText('关卡计划')
    await expect(stageTitle).toContainText('1 个关卡')
    expect(await stageHint.evaluate((trigger) => {
      const badge = trigger.previousElementSibling
      return badge?.tagName === 'SPAN' && badge.textContent === '1 个关卡'
    })).toBe(true)

    // 字段级提示紧贴各自标签，与其它已改造卡片一致。
    const labelHintGeometry = await page.evaluate(() => {
      const label = document.querySelector('label[for="automation-fight-visual-2-medicineExpireDays"]')
      const trigger = document.querySelector('button[aria-label="临期药天数说明"]')
      if (!label || !trigger) return null
      const labelBox = label.getBoundingClientRect()
      const triggerBox = trigger.getBoundingClientRect()
      return {
        gap: triggerBox.left - labelBox.right,
        centerOffset: triggerBox.top + triggerBox.height / 2 - (labelBox.top + labelBox.height / 2),
      }
    })
    expect(labelHintGeometry).not.toBeNull()
    expect(labelHintGeometry!.gap).toBeGreaterThanOrEqual(0)
    expect(labelHintGeometry!.gap).toBeLessThanOrEqual(8)
    expect(Math.abs(labelHintGeometry!.centerOffset)).toBeLessThanOrEqual(2)

    for (const [name, copy] of FIGHT_HINTS.slice(0, 6)) {
      const trigger = page.getByRole('button', { name, exact: true })
      const tooltip = page.getByRole('tooltip').filter({ hasText: copy })
      await expect(trigger).toBeVisible()
      await expect(tooltip).toBeHidden()

      await revealHint(trigger)
      await expect(tooltip).toBeVisible()
      await expect(tooltip).toHaveText(copy)

      await dismissHint(page)
      await expect(tooltip).toBeHidden()

      await trigger.focus()
      await expect(trigger).toBeFocused()
      await expect(tooltip).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(tooltip).toBeHidden()
    }

    // 高级设置里的两条常驻说明同样收进了图标提示。
    await page.locator('details summary').filter({ hasText: '高级设置' }).first().click()

    for (const [name, copy] of FIGHT_HINTS.slice(6)) {
      const trigger = page.getByRole('button', { name, exact: true })
      const tooltip = page.getByRole('tooltip').filter({ hasText: copy })
      await expect(trigger).toBeVisible()
      await expect(tooltip).toBeHidden()

      await revealHint(trigger)
      await expect(tooltip).toBeVisible()
      await expect(tooltip).toHaveText(copy)

      await page.keyboard.press('Escape')
      await expect(tooltip).toBeHidden()
    }

    // 说明文字只在打开提示层时挂载，页面上不再有常驻段落副本。
    for (const [, copy] of FIGHT_HINTS) {
      await expect(page.getByText(copy, { exact: true })).toHaveCount(0)
    }

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('flips the hint above the trigger when there is no room below', async ({ page }) => {
    const environment = await installDeterministicEnvironment(page)
    const viewport = page.viewportSize()!
    // 360px 高时序列面板的 sticky max-height 会把任务列表压到不可点击；
    // 480px 仍让触发器位于滚动区底部，可验证提示向上翻转。
    await page.setViewportSize({ width: viewport.width, height: 480 })
    await page.goto('/app/automation')
    await waitForPageReady(page, 'automation')
    await selectFightTask(page)

    const comboHint = page.getByRole('button', { name: '连战说明', exact: true })
    const comboCopy = FIGHT_HINTS.find(([name]) => name === '连战说明')![1]
    await comboHint.evaluate(element => element.scrollIntoView({ block: 'end' }))
    await revealHint(comboHint)
    await page.waitForTimeout(500)

    const comboTooltip = page.getByRole('tooltip').filter({ hasText: comboCopy })
    await expect(comboTooltip).toBeVisible()
    await expect(comboTooltip).toHaveAttribute('data-side', 'top')

    const box = await comboTooltip.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(480)

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('keeps a tapped hint open until an outside touch', async ({ page }) => {
    test.skip(!isMobileProject(), 'touch input is only emulated on the mobile project')

    const environment = await installDeterministicEnvironment(page, { nativeClock: true })
    await page.goto('/app/automation')
    await waitForPageReady(page, 'automation')

    const accountHint = page.getByRole('button', { name: '切换账号说明', exact: true })
    await accountHint.tap()
    await page.waitForTimeout(600)

    const accountTooltip = page.getByRole('tooltip').filter({ hasText: ACCOUNT_HINT })
    await expect(accountTooltip).toBeVisible()
    await expect(accountTooltip).toHaveText(ACCOUNT_HINT)
    await expect(accountTooltip).toHaveAttribute('data-open', '')
    const describedBy = await accountHint.getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    await expect(page.locator(`#${describedBy}`)).toHaveAttribute('role', 'tooltip')
    await expect(page.locator(`#${describedBy}`)).toHaveText(ACCOUNT_HINT)

    const viewport = page.viewportSize()!
    const box = await accountTooltip.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
    await expectTooltipNotClipped(accountTooltip)
    expect(await accountTooltip.evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none')
    expect(await accountTooltip.evaluate(element => {
      const positioner = element.parentElement
      return positioner ? Number(getComputedStyle(positioner).zIndex) : 0
    })).toBeGreaterThanOrEqual(2000)

    await page.touchscreen.tap(4, 4)
    await expect(accountTooltip).toBeHidden()
    expect(await accountHint.getAttribute('aria-describedby')).toBeNull()

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })

  test('hands off between tapped hints when the mouse rests over another hint', async ({ page }) => {
    test.skip(!isMobileProject(), 'touch input is only emulated on the mobile project')

    const environment = await installDeterministicEnvironment(page, { nativeClock: true })
    await page.goto('/app/automation')
    await waitForPageReady(page, 'automation')

    const accountHint = page.getByRole('button', { name: '切换账号说明', exact: true })
    const launchHint = page.getByRole('button', { name: '启动游戏客户端说明', exact: true })
    const accountTooltip = page.getByRole('tooltip').filter({ hasText: ACCOUNT_HINT })
    const launchTooltip = page.getByRole('tooltip').filter({ hasText: LAUNCH_HINT })

    await launchHint.hover()
    await expect(page.getByRole('tooltip')).toBeHidden()

    await accountHint.tap()
    await page.waitForTimeout(600)
    await expect(accountTooltip).toBeVisible()
    await expect(accountTooltip).toHaveAttribute('data-open', '')

    await launchHint.tap()
    await page.waitForTimeout(600)
    await expect(accountTooltip).toBeHidden()
    await expect(launchTooltip).toBeVisible()
    await expect(launchTooltip).toHaveAttribute('data-open', '')
    const describedBy = await launchHint.getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    await expect(page.locator(`#${describedBy}`)).toHaveAttribute('role', 'tooltip')
    await expect(page.locator(`#${describedBy}`)).toHaveText(LAUNCH_HINT)

    await page.touchscreen.tap(4, 4)
    await expect(launchTooltip).toBeHidden()

    environment.assertNoUnmatchedApi()
    await expectNoBrowserErrors(page)
  })
})

