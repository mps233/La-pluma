import { cn } from 'cn'
import {
  SETTINGS_SECTION_IDS,
  SETTINGS_SECTION_LABELS,
  settingsSectionAnchorId,
  type SettingsSectionId,
} from '../model/settingsSections'

export interface SettingsSectionNavProps {
  readonly activeSection: SettingsSectionId
  readonly onSelect: (section: SettingsSectionId) => void
}

export default function SettingsSectionNav({
  activeSection,
  onSelect,
}: SettingsSectionNavProps) {
  return (
    <nav
      aria-label="本页目录"
      className="hidden xl:sticky xl:top-(--layout-content-sticky-top) xl:block xl:self-start"
    >
      <ul className="flex flex-col border-l border-border">
        {SETTINGS_SECTION_IDS.map((section) => {
          const active = section === activeSection
          return (
            <li key={section}>
              <a
                href={`#${settingsSectionAnchorId(section)}`}
                aria-current={active ? 'location' : undefined}
                onClick={(event) => {
                  event.preventDefault()
                  onSelect(section)
                }}
                className={cn(
                  '-ml-px flex min-h-8 items-center border-l-2 py-1 pl-3 text-sm transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                  active
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
                )}
              >
                {SETTINGS_SECTION_LABELS[section]}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
