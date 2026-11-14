import { useCallback, useState, useSyncExternalStore } from 'react'
import { BatteryGlyph, ChargingRowLabel } from '@/components/islandcn/battery-activity'
import { CompactText, MinimalPair, NumberText, withBubble } from '@/components/islandcn/island-text'
import { useActivity } from '@/components/islandcn/use-activity'
import { islandMetrics, useIsland, useIslandActions } from '@/lib/island'
import { useMaaSanity } from '@/hooks/useMaaSanity'
import { useThemeAccent } from '@/hooks/useThemeAccent'
import { useStatusStore } from '@/store/statusStore'
import type { SanityProjection } from '@/utils/maaSanity'

const ACTIVITY_ID = 'la-pluma-sanity'

const expanded = islandMetrics.expanded
const rowHeight = expanded.minHeight - expanded.padding.top - expanded.padding.bottom
const trailingShift = expanded.padding.side - (expanded.padding.trailing ?? expanded.padding.side)
const compactSide = { display: 'flex', alignItems: 'center', width: 72, minWidth: 0 } as const

/** The compact leading label: "恢复中" or "已回满", short enough for the 72 pt slot. */
const SanityCompactLabel = ({ children, color }: { children: string; color: string }) => (
  <span style={compactSide}>
    <span aria-hidden style={{ flex: '0 0 5px' }} />
    <CompactText color={color} style={{ overflow: 'visible', textOverflow: 'clip' }}>
      {children}
    </CompactText>
  </span>
)

/** The compact trailing value: the current point count and the battery's fill. */
const SanityCompactLevel = ({ sanity, color, fillSince }: {
  sanity: SanityProjection
  color: string
  fillSince: number
}) => (
  <span style={{ ...compactSide, justifyContent: 'flex-end' }}>
    <CompactText color={color}><NumberText value={sanity.value} motion="steady" /></CompactText>
    <span aria-hidden style={{ flex: '0 0 4px' }} />
    <span style={{ display: 'flex', alignItems: 'center', flex: '0 0 35.5px', minWidth: 22 }}>
      <BatteryGlyph level={sanity.level} color={color} width={35.5} fluid fillSince={fillSince} />
    </span>
    <span aria-hidden style={{ flex: '0 0 2px' }} />
  </span>
)

/** The expanded trailing value: "13 / 210" and the battery. */
const SanityRowLevel = ({ sanity, color, fillSince }: {
  sanity: SanityProjection
  color: string
  fillSince: number
}) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', height: rowHeight, position: 'relative', right: trailingShift, gap: 5.7 }}>
    <CompactText color={color}>
      <NumberText value={sanity.value} motion="steady" />
      <span style={{ color, opacity: 0.62 }}> / {sanity.max}</span>
    </CompactText>
    <BatteryGlyph level={sanity.level} color={color} width={35.5} fillSince={fillSince} />
  </div>
)

/**
 * The account's sanity as a battery, shown while the island has nothing more urgent to report.
 * It yields to a run, an update, and any other live activity, since it is ambient status rather
 * than work the user just started.
 */
const spanMinutes = (minutes: number) => (
  minutes < 60 ? `还需 ${minutes} 分钟` : `还需 ${Math.floor(minutes / 60)} 小时`
)

const useMinWidth = (query: string) => {
  const subscribe = useCallback((onChange: () => void) => {
    const media = window.matchMedia?.(query)
    if (!media) return () => undefined
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [query])
  return useSyncExternalStore(
    subscribe,
    () => Boolean(window.matchMedia?.(query).matches),
    () => false,
  )
}

function SanityBattery({ sanity }: { sanity: SanityProjection }) {
  const island = useIslandActions()
  const full = sanity.value >= sanity.max
  const minutesToFull = Math.max(1, Math.round(sanity.timeToFull / 60_000))
  const [shownAt] = useState(() => performance.now())
  const color = useThemeAccent()
  const label = full ? '已回满' : '恢复中'
  const expandedLabel = full ? '理智已满' : '理智恢复'
  const detail = full ? `上限 ${sanity.max}` : spanMinutes(minutesToFull)
  const bubbleGlyph = <BatteryGlyph level={sanity.level} color={color} width={20} fillSince={shownAt} />

  useActivity(
    () => ({
      id: ACTIVITY_ID,
      priority: -1,
      onPress: () => island.expand(ACTIVITY_ID),
      label: `理智 ${sanity.value} / ${sanity.max}，${full ? '已回满' : detail}`,
      compact: withBubble(
        {
          leading: <SanityCompactLabel color={color}>{label}</SanityCompactLabel>,
          trailing: <SanityCompactLevel sanity={sanity} color={color} fillSince={shownAt} />,
        },
        bubbleGlyph,
      ),
      minimal: (
        <MinimalPair
          leading={<BatteryGlyph level={sanity.level} color={color} width={22} fillSince={shownAt} />}
          trailing={<CompactText color={color}><NumberText value={sanity.value} motion="steady" /></CompactText>}
        />
      ),
      expanded: {
        leading: <ChargingRowLabel detail={detail} color={color}>{expandedLabel}</ChargingRowLabel>,
        trailing: <SanityRowLevel sanity={sanity} color={color} fillSince={shownAt} />,
      },
    }),
    [color, detail, expandedLabel, full, label, sanity.level, sanity.max, sanity.value, shownAt],
  )

  return null
}

export default function SanityBatteryIsland() {
  const wide = useMinWidth('(min-width: 640px)')
  const running = useStatusStore(state => state.runStatus.isRunning)
  // Phones hide the pill entirely, so they should not keep polling the MAA log for a value they
  // cannot show.
  const sanity = useMaaSanity(running, wide)
  const island = useIsland()
  // Ambient status stays out of the way while a task or update owns the island. It returns when
  // nothing else is showing; on phones the navbar has no room for the full pill.
  const busy = island.activities.some(activity => activity.id !== ACTIVITY_ID)
  if (!wide || !sanity || running || busy) return null
  return <SanityBattery sanity={sanity} />
}
