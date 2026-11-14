import { useEffect, useRef } from 'react'
import { useActivity } from '@/components/islandcn/use-activity'
import { Glyph, type GlyphIcon } from '@/components/islandcn/glyph'
import {
  CheckCircleGlyph,
  DownloadGlyph,
  PackageGlyph,
  TerminalGlyph,
  WarningGlyph,
} from '@/components/islandcn/glyphs'
import { ExpandedBottom, SensorRow } from '@/components/islandcn/island-layout'
import {
  Caption,
  CompactText,
  ContextLabel,
  ExpandedSubtitle,
  ExpandedTitle,
  MinimalPair,
  withBubble,
} from '@/components/islandcn/island-text'
import { Spinner } from '@/components/islandcn/spinner'
import { islandAccent } from '@/components/islandcn/theme'
import { TickingTime } from '@/components/islandcn/ticking-time'
import { useMaaUpdateIsland } from '@/hooks/useMaaUpdateIsland'
import { useIslandActions } from '@/lib/island'
import {
  MAA_UPDATE_LABELS,
  type MaaUpdateKind,
  type MaaUpdateOperation,
} from '@/store/maaUpdateStore'
import { formatDurationMs } from '@/utils/runIsland'

const ACTIVITY_ID = 'la-pluma-maa-update'

const icons: Record<MaaUpdateKind, GlyphIcon> = {
  core: DownloadGlyph,
  cli: TerminalGlyph,
  resources: PackageGlyph,
}

const contextLabels: Record<MaaUpdateKind, string> = {
  core: 'MaaCore',
  cli: 'MAA CLI',
  resources: '资源',
}

/** What the operation currently reads as, shared by every presentation and the label. */
function phaseOf(operation: MaaUpdateOperation) {
  const name = MAA_UPDATE_LABELS[operation.kind]
  if (operation.state === 'running') {
    return {
      title: `${name} 更新中`,
      detail: operation.detail,
      compact: '',
      color: islandAccent.blue,
      glyph: icons[operation.kind],
    }
  }
  if (operation.state === 'success') {
    return {
      title: `${name} 已更新`,
      detail: operation.message || '更新完成',
      compact: '完成',
      color: islandAccent.green,
      glyph: CheckCircleGlyph,
    }
  }
  return {
    title: `${name} 更新失败`,
    detail: operation.message || '请稍后重试',
    compact: '失败',
    color: islandAccent.red,
    glyph: WarningGlyph,
  }
}

/**
 * MAA updates (MaaCore, MAA CLI, resource files) while their request is in flight, then the
 * outcome for a few seconds. The request can take minutes on a slow network, and the user may
 * leave the config page; the island keeps it visible either way.
 */
function UpdateActivity({ operation }: { operation: MaaUpdateOperation }) {
  const island = useIslandActions()
  const phase = phaseOf(operation)
  const running = operation.state === 'running'
  const color = phase.color
  const startedAt = operation.startedAt
  const duration = operation.finishedAt === null
    ? null
    : formatDurationMs(operation.finishedAt - startedAt)

  const controls = useActivity(
    () => ({
      id: ACTIVITY_ID,
      priority: 2,
      onPress: () => island.expand(ACTIVITY_ID),
      label: `${phase.title}：${phase.detail}`,
      compact: withBubble(
        {
          leading: <Glyph icon={phase.glyph} color={color} />,
          trailing: running
            ? <Spinner size={20} color={color} />
            : <CompactText color={color}>{phase.compact}</CompactText>,
        },
        <Glyph icon={phase.glyph} color={color} />,
      ),
      minimal: (
        <MinimalPair
          leading={<Glyph icon={phase.glyph} color={color} />}
          trailing={running
            ? <Spinner size={18} color={color} />
            : <CompactText color={color}>{phase.compact}</CompactText>}
        />
      ),
      expanded: {
        leading: (
          <SensorRow
            glyph={running
              ? <Spinner size={18} color={color} />
              : <Glyph icon={phase.glyph} color={color} size={18} />}
          >
            <ContextLabel>{contextLabels[operation.kind]}</ContextLabel>
          </SensorRow>
        ),
        trailing: (
          <SensorRow align="end">
            {running ? (
              <CompactText color={color}>
                <TickingTime source={{ kind: 'elapsed', since: startedAt }} />
              </CompactText>
            ) : duration ? <Caption>{duration}</Caption> : null}
          </SensorRow>
        ),
        bottom: (
          <ExpandedBottom gap={4}>
            <ExpandedTitle>{phase.title}</ExpandedTitle>
            <ExpandedSubtitle>{phase.detail}</ExpandedSubtitle>
          </ExpandedBottom>
        ),
      },
    }),
    [
      color,
      duration,
      phase.compact,
      phase.detail,
      phase.glyph,
      phase.title,
      operation.kind,
      running,
      startedAt,
    ],
  )

  // A failed update is the one outcome the user must notice, since the pill may be out of sight
  // by then. Only the transition into that state alerts, never routine progress.
  const alerted = useRef<number | null>(null)
  useEffect(() => {
    if (operation.state !== 'error' || alerted.current === operation.token) return
    alerted.current = operation.token
    controls.alert()
  }, [controls, operation.state, operation.token])

  return null
}

export default function MaaUpdateIsland() {
  const { operation } = useMaaUpdateIsland()
  if (!operation) return null
  return <UpdateActivity operation={operation} />
}
