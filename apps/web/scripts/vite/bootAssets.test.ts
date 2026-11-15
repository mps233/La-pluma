import { describe, expect, it } from 'vitest'
import { createBootThemeTags } from './bootAssets.ts'
import { BOOT_THEME_COLORS, createBootScript } from '../../src/shared/theme/bootTheme.ts'

describe('boot theme asset injection', () => {
  it('appends the boot metas before the generated script at the end of the head', () => {
    const tags = createBootThemeTags()

    expect(tags.map(tag => tag.tag)).toEqual(['meta', 'meta', 'script'])
    expect(tags.every(tag => tag.injectTo === 'head')).toBe(true)
    expect(tags[0]?.attrs).toEqual({ name: 'theme-color', content: BOOT_THEME_COLORS.dark.themeColor })
    expect(tags[1]?.attrs).toEqual({
      name: 'apple-mobile-web-app-status-bar-style',
      content: BOOT_THEME_COLORS.dark.statusBar,
    })
    expect(tags[2]?.children).toBe(createBootScript())
  })
})
