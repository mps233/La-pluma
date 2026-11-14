import { useEffect, useRef, useState } from 'react'
import { useActivity } from '@/components/islandcn/use-activity'
import { Glyph, type GlyphIcon } from '@/components/islandcn/glyph'
import { CheckCircleGlyph, DesktopGlyph, StopGlyph, WarningGlyph } from '@/components/islandcn/glyphs'
import {
  Caption,
  CompactText,
  ContextLabel,
  ExpandedSubtitle,
  ExpandedTitle,
  MinimalPair,
  withBubble,
} from '@/components/islandcn/island-text'
import { ExpandedBottom, SensorRow } from '@/components/islandcn/island-layout'
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
import { useRunStore } from '@/store/runStore'
import { useStatusStore } from '@/store/statusStore'
import { isActiveRunState, type AgentRun, type AgentRunState } from '@/types/run'
import {
  formatRunDuration,
  runFinishedWithin,
  runProgressOf,
  runResultSummary,
  runStepText,
  runTaskName,
} from '@/utils/runIsland'

const ACTIVITY_ID = 'la-pluma-run'
const COMPLETION_HOLD_MS = 6_500

interface RunFinish {
  title: string
  compact: string
  tone: 'success' | 'error' | 'neutral'
  glyph: GlyphIcon
}

function finishOf(state: AgentRunState): RunFinish {
  switch (state) {
    case 'succeeded':
      return { title: '任务已完成', compact: '完成', tone: 'success', glyph: CheckCircleGlyph }
    case 'failed':
      return { title: '任务失败', compact: '失败', tone: 'error', glyph: WarningGlyph }
    case 'stopped':
      return { title: '任务已停止', compact: '停止', tone: 'neutral', glyph: StopGlyph }
    default:
      return { title: '任务已中断', compact: '中断', tone: 'neutral', glyph: WarningGlyph }
  }
}

function toneColor(tone: RunFinish['tone']): string {
  if (tone === 'success') return islandAccent.green
  if (tone === 'error') return islandAccent.red
  return islandAccent.orange
}

interface RunActivityProps {
  run: AgentRun | null
  final: boolean
  task: string
  step: number | null
  total: number | null
  stage: string
  progress: number
  stateText: string
}

/**
 * The automation run as one island activity: the media row while it works, then the outcome for a
 * moment after it ends. Both states share the activity id, so the engine updates the island in
 * place instead of dismissing and appearing again.
 */
function RunActivity({ run, final, task, step, total, stage, progress, stateText }: RunActivityProps) {
  const island = useIslandActions()
  const accent = useThemeAccent()
  const finish = final && run ? finishOf(run.state) : null
  const color = finish ? toneColor(finish.tone) : accent
  const percent = Math.round(progress * 100)
  const stepText = runStepText(task, stage, step, total)
  const actionText = task && task !== '任务执行中' ? `${stateText} ${task}` : stateText
  const summary = finish && run ? runResultSummary(run) : ''
  const duration = finish && run ? formatRunDuration(run.startedAt, run.finishedAt) : null
  const error = finish && run && run.state === 'failed'
    ? (typeof run.error?.message === 'string' ? run.error.message.trim() : '')
    : ''
  const finishDetail = finish && run
    ? (error ? `${task} · ${error}` : [task, summary].filter(Boolean).join(' · '))
    : ''
  const controls = useActivity(
    () => {
      if (finish) {
        return {
          id: ACTIVITY_ID,
          priority: 1,
          onPress: () => island.expand(ACTIVITY_ID),
          label: `${finish.title}：${finishDetail || task}`,
          compact: {
            leading: <Glyph icon={finish.glyph} color={color} />,
            trailing: <CompactText color={color}>{finish.compact}</CompactText>,
          },
          minimal: (
            <MinimalPair
              leading={<Glyph icon={finish.glyph} color={color} />}
              trailing={<CompactText color={color}>{finish.compact}</CompactText>}
            />
          ),
          expanded: {
            leading: (
              <SensorRow glyph={<Glyph icon={finish.glyph} color={color} size={18} />}>
                <ContextLabel>自动化</ContextLabel>
              </SensorRow>
            ),
            // The active view's center line belongs to the previous content; clear it rather than
            // letting it sit under the outcome's title.
            center: null,
            trailing: (
              <SensorRow align="end">
                <Caption>{duration || '已结束'}</Caption>
              </SensorRow>
            ),
            bottom: (
              <ExpandedBottom gap={4}>
                <ExpandedTitle>{finish.title}</ExpandedTitle>
                <ExpandedSubtitle>{finishDetail || task}</ExpandedSubtitle>
              </ExpandedBottom>
            ),
          },
        }
      }

      const ring = <ShareRing value={progress} accent={accent} />
      return {
        id: ACTIVITY_ID,
        priority: 1,
        onPress: () => island.expand(ACTIVITY_ID),
        label: `自动化任务：${task}，${stepText}，进度 ${percent}%`,
        compact: withBubble(
          {
            leading: <SharePicture icon={DesktopGlyph} accent={accent} />,
            trailing: ring,
          },
          ring,
        ),
        minimal: <IconRing icon={DesktopGlyph} value={progress} accent={accent} />,
        expanded: {
          leading: (
            <MediaLead>
              <SharePicture icon={DesktopGlyph} accent={accent} size={mediaRow.lead} />
            </MediaLead>
          ),
          center: <MediaText line={actionText} title={stepText} />,
          trailing: (
            <MediaTrail>
              <ShareRing value={progress} accent={accent} size={mediaRow.ring} mark="count" />
            </MediaTrail>
          ),
          // Clear the outcome view's bottom region when a new run takes over.
          bottom: null,
        },
      }
    },
    [
      accent,
      actionText,
      color,
      duration,
      error,
      final,
      finishDetail,
      island,
      percent,
      progress,
      run,
      stage,
      step,
      stepText,
      summary,
      task,
      total,
    ],
  )

  const alertedRun = useRef<string | null>(null)
  useEffect(() => {
    if (!final || run?.state !== 'failed' || !run || alertedRun.current === run.runId) return
    alertedRun.current = run.runId
    controls.alert()
  }, [controls, final, run])

  return null
}

export default function RunIsland() {
  const run = useRunStore(state => state.run)
  const lastRun = useRunStore(state => state.lastRun)
  const runStatus = useStatusStore(state => state.runStatus)
  const [now, setNow] = useState(() => Date.now())
  const [mountedAt] = useState(() => Date.now())
  const active = run ? isActiveRunState(run.state) : runStatus.isRunning
  const lastRunFinishedAt = lastRun?.finishedAt ? Date.parse(lastRun.finishedAt) : Number.NaN
  // Only an outcome that happened while this page was open keeps the island: a run that ended
  // just before a refresh should not look like it just finished. Reading the wall clock also
  // means the interval only runs while that outcome is visible.
  const completion = !active
    && runFinishedWithin(lastRun, now, COMPLETION_HOLD_MS)
    && Number.isFinite(lastRunFinishedAt)
    && lastRunFinishedAt >= mountedAt
    ? lastRun
    : null

  useEffect(() => {
    if (!completion) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [completion])

  if (!active && !completion) return null

  if (completion) {
    return (
      <RunActivity
        run={completion}
        final
        task={runTaskName(completion)}
        step={null}
        total={null}
        stage=""
        progress={runProgressOf(completion)}
        stateText=""
      />
    )
  }

  const task = run?.progress?.currentTask?.trim()
    || runStatus.label?.replace(/^正在执行[:：]\s*/, '')
    || '任务执行中'
  const stage = run?.progress?.currentStage?.trim() || ''
  const stateText = run?.state === 'stopping' || runStatus.phase === 'stopping'
    ? '正在停止'
    : run?.state === 'waiting'
      ? '等待继续'
      : run?.state === 'accepted'
        ? '等待执行'
        : '正在执行'

  return (
    <RunActivity
      run={run}
      final={false}
      task={task}
      step={run?.progress?.currentStep ?? null}
      total={run?.progress?.totalSteps ?? null}
      stage={stage}
      progress={runProgressOf(run)}
      stateText={stateText}
    />
  )
}
