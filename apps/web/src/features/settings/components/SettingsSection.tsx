import type { ReactNode } from 'react'
import {
  SETTINGS_SECTION_LABELS,
  settingsSectionAnchorId,
  type SettingsSectionId,
} from '../model/settingsSections'

export interface SettingsSectionProps {
  readonly id: SettingsSectionId
  readonly children: ReactNode
}

export default function SettingsSection({ id, children }: SettingsSectionProps) {
  const anchorId = settingsSectionAnchorId(id)
  const headingId = `${anchorId}-heading`

  return (
    <section
      id={anchorId}
      data-settings-section={id}
      aria-labelledby={headingId}
      className="scroll-mt-(--layout-content-sticky-top)"
    >
      <h2 id={headingId} className="app-section-title">{SETTINGS_SECTION_LABELS[id]}</h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}
