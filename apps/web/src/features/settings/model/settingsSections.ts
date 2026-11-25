import { CONFIG_SECTION_IDS } from './configSection'

export const SETTINGS_SECTION_IDS = [
  ...CONFIG_SECTION_IDS,
  'config-directory',
  'appearance',
  'updates',
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number]

export const SETTINGS_SECTION_LABELS: Record<SettingsSectionId, string> = {
  connection: '连接',
  resource: '资源',
  instance: '实例',
  'config-directory': '配置目录',
  appearance: '外观',
  updates: '组件更新',
}

export const settingsSectionAnchorId = (section: SettingsSectionId) => (
  `settings-section-${section}`
)

export const isSettingsSectionId = (value: unknown): value is SettingsSectionId => (
  typeof value === 'string' && (SETTINGS_SECTION_IDS as readonly string[]).includes(value)
)
