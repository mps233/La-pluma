import { useEffect } from 'react'
import { useActivity } from '@/components/islandcn/use-activity'
import { Glyph, type GlyphIcon } from '@/components/islandcn/glyph'
import { CheckCircleGlyph, SparkleGlyph, WarningGlyph } from '@/components/islandcn/glyphs'
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
import {
  MediaLead,
  MediaText,
  MediaTrail,
  SharePicture,
  ShareRing,
  mediaRow,
} from '@/components/islandcn/media-row'
import { IconRing } from '@/components/islandcn/progress-ring'
import { islandAccent } from '@/components/islandcn/theme'
import { useThemeAccent } from '@/hooks/useThemeAccent'
import { useIslandActions } from '@/lib/island'
import { useMasteryStore, type MasteryOutcome } from '@/store/masteryStore'
import type { MasteryQueueStatus } from '@/types/components'
import {
  MASTERY_ACTIVITY_ID,
  masteryActiveItem,
  masteryCampaignCounts,
  masteryProgressOf,
  masteryStateText,
  masteryTitle,
} from '@/utils/masteryIsland'

const OUTCOME_HOLD_MS = 6_500
const PRIORITY = 1

interface MasteryFinish {
  title: string
  compact: string
  color: string
  glyph: GlyphIcon
}

function finishOf(status: 'completed' | 'blocked' | 'interrupted'): MasteryFinish {
  if (status === 'completed') {
    return { title: '专精队列已完成', compact: '完成', color: islandAccent.green, glyph: CheckCircleGlyph }
  }
  return {
    title: status === 'interrupted' ? '专精状态待复核' : '专精队列受阻',
    compact: status === 'interrupted' ? '复核' : '受阻',
    color: islandAccent.orange,
    glyph: WarningGlyph,
  }
}

function statusKey(status: MasteryQueueStatus | null): string {
  return status?.campaign.status ?? 'none'
}

/**
 * The activity itself. Mounted only while the campaign is running, paused/blocked, or holding an
 * outcome, so `useActivity` never has to be called conditionally in the parent.
 */
function MasteryActivity({ status, outcome }: { status: MasteryQueueStatus | null; outcome: MasteryOutcome | null }) {
  const island = useIslandActions()
  const accent = useThemeAccent()
  const color = accent
  const progress = masteryProgressOf(status)
  const item = masteryActiveItem(status)
  const skillLine = item ? `${item.operatorName} · ${item.skillName}` : '技能专精'
  const stateText = masteryStateText(status)
  const timing = item?.nextProbeAt && item.phase === 'training'
    ? `下次检查 ${new Date(item.nextProbeAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    : masteryCampaignCounts(status)

  useActivity(
    () => {
      if (outcome) {
        const finish = finishOf(
          outcome.status === 'completed' ? 'completed' : outcome.status === 'interrupted' ? 'interrupted' : 'blocked'
        )
        return {
          id: MASTERY_ACTIVITY_ID,
          priority: PRIORITY,
          onPress: () => island.expand(MASTERY_ACTIVITY_ID),
          label: `${finish.title}：${outcome.message || skillLine}`,
          compact: withBubble(
            {
              leading: <Glyph icon={finish.glyph} color={finish.color} />,
              trailing: <CompactText color={finish.color}>{finish.compact}</CompactText>,
            },
            <Glyph icon={finish.glyph} color={finish.color} />
          ),
          minimal: (
            <MinimalPair
              leading={<Glyph icon={finish.glyph} color={finish.color} />}
              trailing={<CompactText color={finish.color}>{finish.compact}</CompactText>}
            />
          ),
          expanded: {
            leading: (
              <SensorRow glyph={<Glyph icon={finish.glyph} color={finish.color} size={18} />}>
                <ContextLabel>技能专精</ContextLabel>
              </SensorRow>
            ),
            center: null,
            trailing: (
              <SensorRow align="end">
                <Caption>已结束</Caption>
              </SensorRow>
            ),
            bottom: (
              <ExpandedBottom gap={4}>
                <ExpandedTitle>{finish.title}</ExpandedTitle>
                <ExpandedSubtitle>{outcome.message || skillLine}</ExpandedSubtitle>
              </ExpandedBottom>
            ),
          },
        }
      }

      const ring = <ShareRing value={progress.value} accent={color} mark="count" />
      const stateLabel = masteryTitle(status)
      return {
        id: MASTERY_ACTIVITY_ID,
        priority: PRIORITY,
        onPress: () => island.expand(MASTERY_ACTIVITY_ID),
        label: `技能专精：${stateLabel}，${stateText}，已确认 ${progress.percent}%`,
        compact: withBubble(
          {
            leading: <SharePicture icon={SparkleGlyph} accent={color} />,
            trailing: ring,
          },
          ring
        ),
        minimal: <IconRing icon={SparkleGlyph} value={progress.value} accent={color} />,
        expanded: {
          leading: (
            <MediaLead>
              <SharePicture icon={SparkleGlyph} accent={color} size={mediaRow.lead} />
            </MediaLead>
          ),
          center: <MediaText line={skillLine} title={`${stateText} · 已确认 ${progress.done}/${progress.total} 级`} />,
          trailing: (
            <MediaTrail>
              <ShareRing value={progress.value} accent={color} size={mediaRow.ring} mark="count" />
            </MediaTrail>
          ),
          bottom: (
            <ExpandedBottom gap={4}>
              <ExpandedSubtitle>{timing}</ExpandedSubtitle>
            </ExpandedBottom>
          ),
        },
      }
    },
    [
      color,
      island,
      outcome,
      progress.done,
      progress.percent,
      progress.total,
      progress.value,
      skillLine,
      stateText,
      timing,
    ]
  )

  return null
}

/**
 * 技能专精作为单个岛活动：运行中显示干员、技能和已确认等级进度，结束后短暂保留结果。
 * 训练数小时不占 MAA，岛只反映服务端队列事实，不自行推断完成。
 */
export default function MasteryIsland() {
  const status = useMasteryStore(state => state.status)
  const lastOutcome = useMasteryStore(state => state.lastOutcome)
  const clearLastOutcome = useMasteryStore(state => state.clearLastOutcome)
  const campaign = status?.campaign.status ?? 'idle'
  const active = campaign === 'running'
  const outcome = !active && lastOutcome && lastOutcome.at > 0 ? lastOutcome : null

  useEffect(() => {
    if (!outcome) return undefined
    const elapsed = Date.now() - outcome.at
    if (elapsed >= OUTCOME_HOLD_MS) {
      clearLastOutcome()
      return undefined
    }
    const timer = window.setTimeout(() => clearLastOutcome(), OUTCOME_HOLD_MS - elapsed)
    return () => window.clearTimeout(timer)
  }, [outcome, clearLastOutcome])

  if (!active && !outcome) return null
  return <MasteryActivity key={statusKey(status)} status={status} outcome={outcome} />
}
