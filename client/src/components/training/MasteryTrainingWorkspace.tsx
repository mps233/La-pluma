import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd'
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  GripVertical,
  GraduationCap,
  Package,
  Pause,
  Play,
  Plus,
  RotateCcw,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react'
import {
  Card,
  Button,
  IconButton,
  Input,
  Select,
  Checkbox,
  Switch,
  EmptyState,
  Loading,
  CjkText,
  TruncatedText,
} from '../common'
import { ConfirmDialog, Modal } from '../common/Modal'
import { formatDateTimeCompact, formatRemainingDuration } from '../../utils/format'
import { getApiErrorMessage } from '../../utils/errorMessage'
import { useMasteryStore } from '@/state'
import { getOperatorAvatarUrl } from '../../services/operatorQuotes'
import {
  addMasteryTargets,
  getMasteryCatalog,
  getMasteryOperator,
  getMasteryPreflight,
  getMasteryStatus,
  pauseMasteryCampaign,
  removeMasteryTarget,
  reorderMasteryTargets,
  resumeMasteryCampaign,
  retryMasteryTarget,
  startMasteryCampaign,
  stopMasteryCampaign,
  updateMasterySettings,
  updateMasteryTarget,
  clearSklandCredentials,
  getSklandSnapshot,
  getSklandStatus,
  loginSkland,
  saveSklandCredentials,
  syncSkland,
} from '../../services/api'
import { getItemIconUrl } from '../../services/api'
import type {
  MasteryCandidate,
  MasteryItemPhase,
  MasteryOperatorDetail,
  MasteryPreflight,
  MasteryQueueItem,
  MasteryQueueStatus,
  SklandSnapshot,
  SklandStatus,
} from '../../types/components'

interface SkillDraft {
  selected: boolean
  currentLevel: number
  targetLevel: number
}

const PHASE_LABELS: Record<MasteryItemPhase, string> = {
  queued: '等待执行',
  starting: '正在启动',
  running: '执行中',
  training: '训练中',
  verifying: '复核中',
  blocked: '受阻',
  skipped: '已跳过',
  completed: '已完成',
  failed: '需复核',
  interrupted: '已中断',
}

const DISABLED_REASON_LABELS: Record<string, string> = {
  unowned: '未拥有',
  state_unknown: '状态未识别',
  not_elite2: '未精二',
  missing_mastery_data: '暂无专精数据',
  no_skills: '无技能数据',
  invalid_skill: '技能无效',
}

function phaseTone(phase: MasteryItemPhase): string {
  if (phase === 'completed') return 'status-success'
  if (phase === 'blocked' || phase === 'failed') return 'status-warning'
  if (phase === 'training' || phase === 'running' || phase === 'starting' || phase === 'verifying') return 'status-info'
  return 'surface-soft text-secondary'
}

function itemProgress(item: MasteryQueueItem): string {
  const current = item.levelVerified ? `M${item.confirmedLevel}` : `≤M${item.confirmedLevel}`
  const started = item.startedLevel && item.startedLevel > item.confirmedLevel ? `M${item.startedLevel} 训练中` : null
  const parts = [current, started, `M${item.targetLevel}`].filter(Boolean)
  return parts.join(' → ')
}

function MaterialPreview({ nodes }: { nodes: Array<{ id: string; name: string; iconId: string; have: number; needed: number; stillNeeded: number }> }) {
  if (nodes.length === 0) {
    return <div className="text-xs text-tertiary">这一级没有材料数据</div>
  }
  return (
    <div className="flex flex-wrap gap-2">
      {nodes.map(node => (
        <div key={node.id} className="flex min-h-9 items-center gap-2 rounded-lg px-2 py-1 surface-soft" title={`${node.name} ${node.have}/${node.needed}`}>
          <span className="relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md surface-panel text-tertiary">
            <Package size={12} aria-hidden="true" />
            <img
              src={getItemIconUrl(node.iconId)}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              onError={(event) => { event.currentTarget.style.display = 'none' }}
            />
          </span>
          <span className="max-w-32 truncate text-xs text-secondary">{node.name}</span>
          <span className={`text-xs font-semibold ${node.stillNeeded > 0 ? 'text-[var(--app-danger-text)]' : 'text-[var(--app-success-text)]'}`}>
            {node.stillNeeded > 0 ? `缺 ${node.stillNeeded}` : '齐'}
          </span>
        </div>
      ))}
    </div>
  )
}

function ageLabel(days: number | null): string | null {
  if (days === null) return null
  return days <= 0 ? '今天' : `${days} 天前`
}

function FreshnessNote({ dataFreshness }: { dataFreshness: MasteryOperatorDetail['dataFreshness'] }) {
  const operbox = ageLabel(dataFreshness.operbox.ageDays)
  const depot = ageLabel(dataFreshness.depot.ageDays)
  if (!operbox && !depot) return null
  const stale = Math.max(dataFreshness.operbox.ageDays ?? 0, dataFreshness.depot.ageDays ?? 0) >= 2
  return (
    <div className={`mt-1 text-xs ${stale ? 'status-warning' : 'text-tertiary'}`}>
      {[operbox && `干员快照 ${operbox}`, depot && `仓库快照 ${depot}`].filter(Boolean).join(' · ')}
      {stale ? '，材料缺口可能已变化' : ''}
    </div>
  )
}

function buildDrafts(
  detail: MasteryOperatorDetail,
  queuedItems: MasteryQueueItem[],
  knownLevels: Map<string, number>,
): Record<number, SkillDraft> {
  const queuedBySkill = new Map(queuedItems.map(item => [item.skillIndex, item]))
  const firstAvailable = detail.skills.find(skill => !queuedBySkill.has(skill.index) && knownLevels.get(skill.skillId) !== 3)
  const drafts: Record<number, SkillDraft> = {}
  for (const skill of detail.skills) {
    const existing = queuedBySkill.get(skill.index)
    const known = knownLevels.get(skill.skillId)
    drafts[skill.index] = {
      selected: skill.index === firstAvailable?.index,
      currentLevel: existing ? Math.min(existing.confirmedLevel, 2) : Math.min(known ?? 0, 2),
      targetLevel: 3,
    }
  }
  return drafts
}

function TargetForm({
  candidate,
  detail,
  submitting,
  error,
  queuedKeys,
  queuedItems,
  knownLevels,
  onClose,
  onSubmit,
}: {
  candidate: MasteryCandidate
  detail: MasteryOperatorDetail
  submitting: boolean
  error: string | null
  queuedKeys: Set<string>
  queuedItems: MasteryQueueItem[]
  knownLevels: Map<string, number>
  onClose: () => void
  onSubmit: (items: Array<{ operatorId: string; skillIndex: number; targetLevel: number; declaredLevel: number }>) => void
}) {
  const queuedBySkill = new Map(queuedItems.map(item => [item.skillIndex, item]))
  const [drafts, setDrafts] = useState<Record<number, SkillDraft>>(() => buildDrafts(detail, queuedItems, knownLevels))

  const isQueued = (skillIndex: number) => queuedKeys.has(`${detail.id}:${skillIndex}`)
  const selectedSkills = detail.skills.filter(skill => drafts[skill.index]?.selected && !isQueued(skill.index) && knownLevels.get(skill.skillId) !== 3)
  const canSubmit = selectedSkills.length > 0
    && selectedSkills.every(skill => {
      const draft = drafts[skill.index]
      return Boolean(draft && draft.targetLevel > draft.currentLevel)
    })

  const submit = () => {
    if (!canSubmit) return
    const items = selectedSkills.flatMap(skill => {
      const draft = drafts[skill.index]
      return draft
        ? [{
            operatorId: candidate.id,
            skillIndex: skill.index,
            targetLevel: draft.targetLevel,
            declaredLevel: draft.currentLevel,
          }]
        : []
    })
    if (items.length > 0) onSubmit(items)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <img
          src={getOperatorAvatarUrl(detail.id)}
          alt=""
          className="h-12 w-12 rounded-xl object-cover surface-soft"
          onError={(event) => { event.currentTarget.style.display = 'none' }}
        />
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-primary">{detail.name}</div>
          <div className="mt-1 text-xs text-tertiary">
            {detail.profession} · {detail.rarity}★ · 精二
          </div>
          <FreshnessNote dataFreshness={detail.dataFreshness} />
        </div>
      </div>

      <p className="rounded-xl px-3 py-2 text-xs leading-5 status-warning">
        当前等级用于估算材料；专精需要技能 7 级且训练室空闲，实际等级以游戏内为准。队列中的技能会显示已知等级，“未记录”不代表未专精。
      </p>

      <div className="space-y-3">
        {detail.skills.map(skill => {
          const draft = drafts[skill.index] || { selected: false, currentLevel: 0, targetLevel: 3 }
          const nextLevel = skill.levels.find(level => level.level === draft.currentLevel + 1) || null
          const targetOptions = [1, 2, 3]
            .filter(level => level > draft.currentLevel)
            .map(level => ({ value: String(level), label: `M${level}` }))
          const queuedItem = queuedBySkill.get(skill.index)
          const knownLevel = knownLevels.get(skill.skillId)
          const alreadyQueued = isQueued(skill.index)
          const maxed = knownLevel === 3
          return (
            <div key={skill.index} className={`rounded-xl border border-[var(--app-border)] p-3 ${alreadyQueued ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Checkbox
                    label={`技能 ${skill.index} · ${skill.name}`}
                    checked={draft.selected}
                    disabled={alreadyQueued || maxed}
                    onChange={(checked) => setDrafts(prev => ({
                      ...prev,
                      [skill.index]: { ...draft, selected: checked }
                    }))}
                  />
                  {queuedItem && (
                    <span className={`text-xs ${queuedItem.phase === 'completed' ? 'status-success' : 'text-tertiary'}`}>
                      {queuedItem.phase === 'completed'
                        ? `已完成 M${queuedItem.confirmedLevel}`
                        : `${PHASE_LABELS[queuedItem.phase]} · M${queuedItem.confirmedLevel}→M${queuedItem.targetLevel}`}
                    </span>
                  )}
                  {!queuedItem && knownLevel !== undefined && (
                    <span className={`text-xs ${knownLevel > 0 ? 'status-success' : 'text-tertiary'}`}>
                      {knownLevel > 0 ? `已专精 M${knownLevel}` : '未专精'}
                    </span>
                  )}
                  {!queuedItem && knownLevel === undefined && <span className="text-xs text-tertiary">未记录</span>}
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    aria-label={`技能 ${skill.index} 当前等级`}
                    value={String(draft.currentLevel)}
                    onChange={(value) => {
                      const currentLevel = Number(value)
                      setDrafts(prev => ({
                        ...prev,
                        [skill.index]: {
                          ...draft,
                          currentLevel,
                          targetLevel: Math.max(currentLevel + 1, Math.min(draft.targetLevel, 3))
                        }
                      }))
                    }}
                    options={[0, 1, 2].map(level => ({ value: String(level), label: `当前 M${level}` }))}
                    className="w-28"
                  />
                  <Select
                    aria-label={`技能 ${skill.index} 目标等级`}
                    value={String(draft.targetLevel)}
                    onChange={(value) => setDrafts(prev => ({
                      ...prev,
                      [skill.index]: { ...draft, targetLevel: Number(value) }
                    }))}
                    options={targetOptions}
                    className="w-24"
                    disabled={!draft.selected || alreadyQueued || maxed}
                  />
                </div>
              </div>
              {draft.selected && !alreadyQueued && (
                <div className="mt-3 border-t border-[var(--app-border)] pt-3">
                  <div className="mb-2 text-xs text-tertiary">
                    {nextLevel ? `M${draft.currentLevel} → M${nextLevel.level} 本级材料` : '当前等级已满'}
                  </div>
                  <MaterialPreview nodes={nextLevel?.materialNodes || []} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {error && <div className="rounded-xl px-4 py-3 text-sm status-danger">{error}</div>}

      <div className="flex flex-col-reverse gap-2 border-t border-[var(--app-border)] pt-4 sm:flex-row sm:justify-end">
        <Button variant="secondary" size="md" onClick={onClose} disabled={submitting}>取消</Button>
        <Button
          variant="primary"
          size="md"
          onClick={submit}
          disabled={!canSubmit || submitting}
          loading={submitting}
          loadingText="加入中"
          icon={<Plus size={15} strokeWidth={1.9} aria-hidden="true" />}
        >
          加入专精队列{selectedSkills.length > 0 ? ` (${selectedSkills.length})` : ''}
        </Button>
      </div>
    </div>
  )
}

function TargetDialog({
  candidate,
  detail,
  loading,
  submitting,
  error,
  queuedKeys,
  queuedItems,
  knownLevels,
  onClose,
  onSubmit,
}: {
  candidate: MasteryCandidate | null
  detail: MasteryOperatorDetail | null
  loading: boolean
  submitting: boolean
  error: string | null
  queuedKeys: Set<string>
  queuedItems: MasteryQueueItem[]
  knownLevels: Map<string, number>
  onClose: () => void
  onSubmit: (items: Array<{ operatorId: string; skillIndex: number; targetLevel: number; declaredLevel: number }>) => void
}) {
  return (
    <Modal
      isOpen={Boolean(candidate)}
      onClose={onClose}
      title="设置专精目标"
      size="md"
    >
      {loading ? (
        <Loading text="正在读取技能和材料..." />
      ) : detail && candidate ? (
        <TargetForm
          key={detail.id}
          candidate={candidate}
          detail={detail}
          submitting={submitting}
          error={error}
          queuedKeys={queuedKeys}
          queuedItems={queuedItems}
          knownLevels={knownLevels}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      ) : error ? (
        <div className="rounded-xl px-4 py-4 text-sm status-danger">{error}</div>
      ) : null}
    </Modal>
  )
}

export default function MasteryTrainingWorkspace() {
  const [preflight, setPreflight] = useState<MasteryPreflight | null>(null)
  const [preflightError, setPreflightError] = useState<string | null>(null)
  const [status, setStatus] = useState<MasteryQueueStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<MasteryCandidate[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [rarity, setRarity] = useState('')
  const [statusFilter, setStatusFilter] = useState<'eligible' | 'owned' | 'all'>('eligible')
  const [visibleCount, setVisibleCount] = useState(48)
  const [selectedCandidate, setSelectedCandidate] = useState<MasteryCandidate | null>(null)
  const [detail, setDetail] = useState<MasteryOperatorDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [addSubmitting, setAddSubmitting] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [actionPending, setActionPending] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<MasteryQueueItem | null>(null)
  const [preflightLoading, setPreflightLoading] = useState(true)
  const [sklandOpen, setSklandOpen] = useState(false)
  const [sklandClearOpen, setSklandClearOpen] = useState(false)
  const [sklandStatus, setSklandStatus] = useState<SklandStatus | null>(null)
  const [sklandSnapshot, setSklandSnapshot] = useState<SklandSnapshot | null>(null)
  const [sklandCred, setSklandCred] = useState('')
  const [sklandToken, setSklandToken] = useState('')
  const [sklandUid, setSklandUid] = useState('')
  const [sklandAccount, setSklandAccount] = useState('')
  const [sklandPassword, setSklandPassword] = useState('')
  const [sklandPending, setSklandPending] = useState<string | null>(null)
  const [sklandError, setSklandError] = useState<string | null>(null)
  const requestRef = useRef(0)
  const catalogRequestRef = useRef(0)
  const catalogTopRef = useRef<HTMLDivElement | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      const response = await getMasteryStatus()
      if (!response.success || !response.data) {
        setStatusError(response.message || '专精状态加载失败')
        return
      }
      setStatus(response.data)
      useMasteryStore.getState().applyStatus(response.data)
      setStatusError(null)
    } catch (error) {
      setStatusError(getApiErrorMessage(error))
    } finally {
      setStatusLoading(false)
    }
  }, [])

  const loadCatalog = useCallback(async () => {
    const requestId = ++catalogRequestRef.current
    setCatalogLoading(true)
    try {
      const response = await getMasteryCatalog({
        search: search.trim() || undefined,
        rarity: rarity ? Number(rarity) : null,
        status: statusFilter,
        limit: 500
      })
      if (requestId !== catalogRequestRef.current) return
      if (!response.success || !response.data) {
        setCatalogError(response.message || '可专精干员加载失败')
        setCatalog([])
        return
      }
      setCatalog(response.data.operators || [])
      setCatalogError(null)
    } catch (error) {
      if (requestId === catalogRequestRef.current) setCatalogError(getApiErrorMessage(error))
    } finally {
      if (requestId === catalogRequestRef.current) setCatalogLoading(false)
    }
  }, [search, rarity, statusFilter])

  const loadSkland = useCallback(async (withSnapshot: boolean) => {
    try {
      const response = await getSklandStatus()
      if (response.success && response.data) {
        setSklandStatus(response.data)
      }
      if (!withSnapshot) return
      const snapshotResponse = await getSklandSnapshot()
      if (snapshotResponse.success && snapshotResponse.data) {
        setSklandSnapshot(snapshotResponse.data.available ? snapshotResponse.data.snapshot : null)
      }
    } catch {
      // Skland is an optional data source; the queue keeps working without it.
    }
  }, [])

  const syncSklandData = async () => {
    setSklandPending('sync')
    setSklandError(null)
    try {
      const response = await syncSkland()
      if (!response.success) {
        setSklandError(response.message || '森空岛同步失败')
        return
      }
      setSklandStatus(response.data || null)
      await loadSkland(true)
    } catch (error) {
      setSklandError(getApiErrorMessage(error))
    } finally {
      setSklandPending(null)
    }
  }

  const saveSkland = async (withSync: boolean) => {
    if (!sklandCred.trim() || !sklandToken.trim()) {
      setSklandError('cred 和 token 都必须填写')
      return
    }
    setSklandPending(withSync ? 'save-sync' : 'save')
    setSklandError(null)
    try {
      const response = await saveSklandCredentials(
        sklandCred.trim(),
        sklandToken.trim(),
        sklandUid.trim() || undefined,
      )
      if (!response.success) {
        setSklandError(response.message || '森空岛凭证保存失败')
        return
      }
      setSklandStatus(response.data || null)
      setSklandCred('')
      setSklandToken('')
      setSklandUid('')
      if (withSync) {
        const syncResponse = await syncSkland()
        if (!syncResponse.success) {
          setSklandError(syncResponse.message || '森空岛同步失败')
          return
        }
        setSklandStatus(syncResponse.data || null)
      }
      await loadSkland(true)
    } catch (error) {
      setSklandError(getApiErrorMessage(error))
    } finally {
      setSklandPending(null)
    }
  }

  const loginSklandAccount = async () => {
    if (!sklandAccount.trim() || !sklandPassword) {
      setSklandError('手机号和密码都必须填写')
      return
    }
    setSklandPending('login')
    setSklandError(null)
    try {
      const response = await loginSkland(sklandAccount.trim(), sklandPassword, sklandUid.trim() || undefined)
      if (!response.success) {
        setSklandError(response.message || '森空岛登录失败')
        return
      }
      setSklandStatus(response.data || null)
      setSklandAccount('')
      setSklandPassword('')
      const syncResponse = await syncSkland()
      if (!syncResponse.success) {
        setSklandError(syncResponse.message || '登录成功，但同步失败')
        return
      }
      setSklandStatus(syncResponse.data || null)
      await loadSkland(true)
    } catch (error) {
      setSklandError(getApiErrorMessage(error))
    } finally {
      setSklandPending(null)
    }
  }

  const clearSkland = async () => {
    setSklandPending('clear')
    setSklandError(null)
    try {
      const response = await clearSklandCredentials()
      if (!response.success) {
        setSklandError(response.message || '森空岛凭证清除失败')
        return
      }
      setSklandStatus({ configured: false, characterCount: 0 })
      setSklandSnapshot(null)
    } catch (error) {
      setSklandError(getApiErrorMessage(error))
    } finally {
      setSklandPending(null)
      setSklandClearOpen(false)
    }
  }

  useEffect(() => {
    void loadSkland(true)
  }, [loadSkland])

  useEffect(() => {
    let active = true
    void getMasteryPreflight()
      .then(response => {
        if (!active) return
        if (!response.success || !response.data) {
          setPreflightError(response.message || '专精预检失败')
          return
        }
        setPreflight(response.data)
      })
      .catch(error => {
        if (active) setPreflightError(getApiErrorMessage(error))
      })
      .finally(() => {
        if (active) setPreflightLoading(false)
      })
    void loadStatus()
    return () => { active = false }
  }, [loadStatus])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCatalog()
    }, search ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [loadCatalog, search])

  const pollStatus = status?.campaign.status || 'idle'
  useEffect(() => {
    if (!['running', 'paused', 'blocked', 'interrupted'].includes(pollStatus)) return
    const timer = window.setInterval(() => {
      void loadStatus()
    }, pollStatus === 'running' ? 5000 : 15000)
    return () => window.clearInterval(timer)
  }, [pollStatus, loadStatus])

  const openCandidate = async (candidate: MasteryCandidate) => {
    if (!candidate.eligible) return
    setSelectedCandidate(candidate)
    setDetail(null)
    setDetailError(null)
    setAddError(null)
    setDetailLoading(true)
    const requestId = ++requestRef.current
    try {
      const response = await getMasteryOperator(candidate.id, 0)
      if (requestId !== requestRef.current) return
      if (!response.success || !response.data) {
        setDetailError(response.message || '干员技能加载失败')
        return
      }
      setDetail(response.data)
    } catch (error) {
      if (requestId === requestRef.current) setDetailError(getApiErrorMessage(error))
    } finally {
      if (requestId === requestRef.current) setDetailLoading(false)
    }
  }

  const closeCandidate = () => {
    if (addSubmitting) return
    setSelectedCandidate(null)
    setDetail(null)
    setDetailError(null)
    setAddError(null)
  }

  const submitTargets = async (items: Array<{ operatorId: string; skillIndex: number; targetLevel: number; declaredLevel: number }>) => {
    setAddSubmitting(true)
    setAddError(null)
    try {
      const response = await addMasteryTargets(items)
      if (!response.success) {
        setAddError(response.message || '加入专精队列失败')
        return
      }
      setSelectedCandidate(null)
      setDetail(null)
      await loadStatus()
    } catch (error) {
      setAddError(getApiErrorMessage(error))
    } finally {
      setAddSubmitting(false)
    }
  }

  const runAction = async (key: string, action: () => Promise<{ success: boolean; message?: string }>) => {
    setActionPending(key)
    setActionError(null)
    try {
      const response = await action()
      if (!response.success) {
        setActionError(response.message || '操作失败')
        return
      }
      await loadStatus()
    } catch (error) {
      setActionError(getApiErrorMessage(error))
    } finally {
      setActionPending(null)
    }
  }

  const moveItem = async (item: MasteryQueueItem, direction: -1 | 1) => {
    if (!status) return
    const ordered = [...status.items].sort((a, b) => a.order - b.order)
    const index = ordered.findIndex(candidate => candidate.id === item.id)
    const swapIndex = index + direction
    if (index < 0 || swapIndex < 0 || swapIndex >= ordered.length) return
    const next = [...ordered]
    const current = next[index]
    const swap = next[swapIndex]
    if (!current || !swap) return
    next[index] = swap
    next[swapIndex] = current
    await runAction(`order:${item.id}`, () => reorderMasteryTargets(next.map(candidate => candidate.id)))
  }

  const queueItems = useMemo(
    () => [...(status?.items || [])].sort((a, b) => a.order - b.order),
    [status]
  )

  const handleQueueDragEnd = (result: DropResult) => {
    const destination = result.destination
    if (!destination || destination.index === result.source.index) return
    const next = [...queueItems]
    const [moved] = next.splice(result.source.index, 1)
    if (!moved) return
    next.splice(destination.index, 0, moved)
    void runAction('order:drag', () => reorderMasteryTargets(next.map(candidate => candidate.id)))
  }

  const queuedKeys = useMemo(
    () => new Set((status?.items || []).map(item => item.operatorId + ':' + item.skillIndex)),
    [status]
  )
  const queuedByOperator = useMemo(() => {
    const map = new Map<string, MasteryQueueItem[]>()
    for (const item of status?.items || []) {
      const list = map.get(item.operatorId)
      if (list) list.push(item)
      else map.set(item.operatorId, [item])
    }
    return map
  }, [status])
  const knownMastery = useMemo(() => {
    const map = new Map<string, Map<string, number>>()
    for (const character of sklandSnapshot?.characters || []) {
      const skills = new Map<string, number>()
      for (const skill of character.skills) {
        skills.set(skill.id, skill.level)
      }
      map.set(character.id, skills)
    }
    return map
  }, [sklandSnapshot])
  const campaignStatus = pollStatus
  const canStart = Boolean(status && queueItems.some(item => item.enabled && item.phase !== 'completed' && item.phase !== 'skipped'))
  const startBlocked = Boolean(preflightError) || (preflight !== null && !preflight.supported)
  const startBlockedReason = preflightError
    || (preflight !== null && !preflight.supported
      ? (preflight.runtime?.reason || preflight.masteryData?.error || '专精运行前检查未通过')
      : null)
  const attentionCount = queueItems.filter(item => item.phase === 'blocked' || item.phase === 'failed' || item.phase === 'interrupted').length
  const waitingCount = queueItems.filter(item => item.enabled && item.phase === 'queued').length
  const runningCount = queueItems.filter(item => item.phase === 'starting' || item.phase === 'running' || item.phase === 'verifying').length

  return (
    <>
      <div className="grid grid-cols-1 items-start gap-[var(--app-space-section)] lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]">
        <section className="min-w-0 space-y-4" aria-labelledby="mastery-operator-title">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="mastery-operator-title" className="text-lg font-semibold text-primary"><CjkText>添加专精目标</CjkText></h2>
              <p className="text-sm text-secondary">选择已精二干员，设置技能和专精等级</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { setSklandOpen(true); setSklandError(null); void loadSkland(true) }}
                icon={<RefreshCw size={14} strokeWidth={1.9} aria-hidden="true" />}
              >
                森空岛
              </Button>
              <div className="rounded-full px-3 py-1 text-xs font-medium text-tertiary surface-soft">
                {catalogLoading ? '读取中' : `${catalog.length} 名可专精`}
              </div>
            </div>
          </div>

          <div ref={catalogTopRef} className="flex flex-col gap-4">
            <Input
              type="text"
              aria-label="搜索干员名称"
              placeholder="搜索干员"
              value={search}
              onChange={(value) => { setSearch(value); setVisibleCount(48) }}
              icon={<Search size={17} strokeWidth={1.9} aria-hidden="true" />}
            />
            <div className="grid grid-cols-2 gap-2">
              <Select
                aria-label="稀有度"
                value={rarity}
                onChange={(value) => { setRarity(value); setVisibleCount(48) }}
                options={[
                  { value: '', label: '全部稀有度' },
                  { value: '6', label: '6 星' },
                  { value: '5', label: '5 星' },
                  { value: '4', label: '4 星' },
                ]}
              />
              <Select
                aria-label="干员范围"
                value={statusFilter}
                onChange={(value) => { setStatusFilter(value as 'eligible' | 'owned' | 'all'); setVisibleCount(48) }}
                options={[
                  { value: 'eligible', label: '可专精' },
                  { value: 'owned', label: '已拥有' },
                  { value: 'all', label: '全部' },
                ]}
              />
            </div>
          </div>

          {catalogLoading ? (
            <Loading text="正在读取可专精干员..." />
          ) : catalogError ? (
            <div className="rounded-xl px-4 py-4 text-sm status-danger">
              <div className="flex items-center gap-2"><AlertTriangle size={16} aria-hidden="true" />{catalogError}</div>
              <Button variant="secondary" size="sm" className="mt-3" onClick={() => void loadCatalog()}>重新加载</Button>
            </div>
          ) : catalog.length === 0 ? (
            <EmptyState
              compact
              icon={<GraduationCap size={21} strokeWidth={1.8} />}
              title="没有找到可专精干员"
              description={statusFilter === 'eligible' ? '专精需要精二，可先查看全部干员确认进度' : '当前搜索或筛选没有结果'}
              action={(
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => { setSearch(''); setRarity(''); setStatusFilter('all'); setVisibleCount(48) }}
                >
                  {search || rarity || statusFilter !== 'eligible' ? '清除筛选' : '查看全部干员'}
                </Button>
              )}
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
              {catalog.slice(0, visibleCount).map(candidate => {
                const queuedItems = queuedByOperator.get(candidate.id) || []
                const queuedCount = queuedItems.length
                const snapshotSkills = knownMastery.get(candidate.id)
                const snapshotMastered = snapshotSkills
                  ? [...snapshotSkills.values()].filter(level => level > 0).length
                  : 0
                const snapshotMax = snapshotSkills && snapshotSkills.size > 0
                  ? Math.max(...snapshotSkills.values())
                  : 0
                return (
                <button
                  key={candidate.id}
                  type="button"
                  className={`group flex min-h-44 flex-col items-center rounded-2xl p-3 text-center transition-colors ${candidate.eligible ? 'surface-panel hover:bg-[var(--app-surface-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)]' : 'surface-soft opacity-70'}`}
                  onClick={() => void openCandidate(candidate)}
                  disabled={!candidate.eligible}
                  aria-label={`${candidate.name}${candidate.eligible ? '，添加专精目标' : `，${DISABLED_REASON_LABELS[candidate.disabledReason || ''] || '不可专精'}`}`}
                >
                  <span className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl surface-soft">
                    <GraduationCap size={24} className="text-tertiary" aria-hidden="true" />
                    <img
                      src={getOperatorAvatarUrl(candidate.id)}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover"
                      loading="lazy"
                      onError={(event) => { event.currentTarget.style.display = 'none' }}
                    />
                  </span>
                  <span className="mt-3 w-full truncate text-sm font-semibold text-primary">{candidate.name}</span>
                  <span className="mt-1 text-xs text-tertiary">{candidate.profession} · {candidate.rarity}★</span>
                  <span className={`mt-2 rounded-full px-2 py-0.5 text-xs font-semibold ${candidate.eligible ? 'brand-chip' : 'surface-panel text-tertiary'}`}>
                    {candidate.eligible
                      ? `精二 · ${candidate.skillCount} 个技能${queuedCount > 0 ? ` · 队列 ${queuedCount}` : ''}`
                      : (DISABLED_REASON_LABELS[candidate.disabledReason || ''] || '不可专精')}
                  </span>
                  {snapshotSkills && snapshotSkills.size > 0 && (
                    <span className="mt-1 text-xs text-tertiary">
                      专精 {snapshotMastered}/{snapshotSkills.size} · 最高 M{snapshotMax}
                    </span>
                  )}
                  {queuedItems.length > 0 && (
                    <span className="mt-2 flex w-full flex-wrap justify-center gap-1">
                      {queuedItems.map(item => (
                        <span
                          key={item.id}
                          className={`rounded-full px-1.5 py-0.5 text-xs ${item.phase === 'completed' ? 'status-success' : 'surface-soft text-secondary'}`}
                          title={`技能 ${item.skillIndex} · ${item.skillName}`}
                        >
                          {item.phase === 'completed'
                            ? `技能 ${item.skillIndex} · M${item.confirmedLevel}`
                            : `技能 ${item.skillIndex} · M${item.confirmedLevel}→M${item.targetLevel}`}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
                )
              })}
            </div>
          )}
          {catalog.length > visibleCount && (
            <div className="flex flex-col items-center gap-2 py-3">
              <Button
                variant="secondary"
                size="md"
                className="min-w-36"
                onClick={() => setVisibleCount(count => count + 48)}
              >
                继续显示 {Math.min(48, catalog.length - visibleCount)} 个
              </Button>
              <div className="text-xs text-tertiary">
                已显示 {visibleCount} / {catalog.length}
              </div>
            </div>
          )}
        </section>

        <aside className={`min-w-0 lg:sticky lg:top-4 ${status?.campaign.status === 'running' ? 'order-first lg:order-none' : ''}`}>
          <Card smoothCorners className="!p-0">
            <div className="flex items-center justify-between border-b border-[var(--app-border)] px-4 py-3">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="brand-text" aria-hidden="true" />
                <h2 className="text-sm font-bold text-primary"><CjkText>自动专精</CjkText></h2>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${campaignStatus === 'running' ? 'status-info' : campaignStatus === 'blocked' ? 'status-warning' : campaignStatus === 'completed' ? 'status-success' : 'surface-soft text-secondary'}`}>
                {campaignStatus === 'running' ? '自动执行中' : campaignStatus === 'paused' ? '已暂停' : campaignStatus === 'blocked' ? '待处理' : campaignStatus === 'completed' ? '已完成' : campaignStatus === 'interrupted' ? '待复核' : '空闲'}
              </span>
            </div>

            {startBlocked ? (
              <div className="border-b border-[var(--app-border)] px-4 py-3 text-xs leading-5 status-warning">
                {startBlockedReason}
              </div>
            ) : preflightLoading ? (
              <div className="border-b border-[var(--app-border)] px-4 py-3 text-xs leading-5 text-tertiary">
                正在检查运行环境...
              </div>
            ) : null}

            {statusLoading ? (
              <div className="px-4 py-8"><Loading text="正在读取专精队列..." /></div>
            ) : statusError ? (
              <div className="px-4 py-4 text-sm status-danger">
                <div className="flex items-center gap-2"><AlertTriangle size={16} aria-hidden="true" />{statusError}</div>
                <Button variant="secondary" size="sm" className="mt-3" onClick={() => void loadStatus()}>重新加载</Button>
              </div>
            ) : (
              <div className="divide-y divide-[var(--app-border)]">
                <div className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-tertiary">
                    <span>等待 {waitingCount} · 执行 {runningCount} · 训练 {status?.counts.training || 0} · 需处理 {attentionCount} · 完成 {status?.counts.completed || 0}</span>
                    <span className="flex items-center gap-2">
                      {status?.scheduler?.lastTickAt && <span>检查 {formatDateTimeCompact(status.scheduler.lastTickAt)}</span>}
                      {status?.scheduler?.lastTickError && <span className="status-warning" title={status.scheduler.lastTickError}>上次检查失败</span>}
                    </span>
                  </div>
                </div>

                {queueItems.length === 0 ? (
                  <div className="px-4 py-8">
                    <EmptyState
                      compact
                      icon={<GraduationCap size={21} strokeWidth={1.8} />}
                      title="还没有专精目标"
                      description="从左侧选择干员，设置技能和目标等级后加入队列"
                      action={(
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => catalogTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                        >
                          去选择干员
                        </Button>
                      )}
                    />
                  </div>
                ) : (
                  <div className="max-h-[50vh] overflow-y-auto">
                    <DragDropContext onDragEnd={handleQueueDragEnd}>
                      <Droppable droppableId="mastery-queue">
                        {(provided) => (
                          <div ref={provided.innerRef} {...provided.droppableProps}>
                    {queueItems.map((item, index) => {
                      const isActive = status?.activeItem?.id === item.id
                      const tone = phaseTone(item.phase)
                      const stepBusy = ['starting', 'running', 'verifying'].includes(item.phase)
                      const moveLocked = stepBusy || item.phase === 'training'
                      const canRetry = (item.phase === 'blocked' || item.phase === 'failed' || item.phase === 'interrupted') && item.blocked?.retryable !== false
                      return (
                        <Draggable key={item.id} draggableId={item.id} index={index} isDragDisabled={moveLocked || actionPending !== null}>
                          {(dragProvided, snapshot) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              className={`px-4 py-3 ${isActive ? 'bg-[var(--app-surface-muted)]' : ''}${snapshot.isDragging ? ' shadow-lg' : ''}`}
                            >
                          <div className="flex items-start gap-4">
                            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${isActive ? 'brand-chip' : 'surface-soft text-secondary'}`}>
                              {index + 1}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <TruncatedText as="span" className="min-w-0 text-sm font-bold text-primary" tooltip={`${item.operatorName} · ${item.skillName}`} triggerClassName="min-w-0">
                                  {item.operatorName} · {item.skillName}
                                </TruncatedText>
                                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>
                                  {PHASE_LABELS[item.phase]}
                                </span>
                                {!item.enabled && <span className="rounded-full px-2 py-0.5 text-xs font-semibold surface-soft text-tertiary">已暂停</span>}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-tertiary">
                                <span className="font-semibold text-secondary">{itemProgress(item)}</span>
                                {item.startedLevel && <span>已开始 M{item.startedLevel}</span>}
                                {item.nextProbeAt && item.phase === 'training' && <span>下次检查 {formatDateTimeCompact(item.nextProbeAt)}</span>}
                              </div>
                              {item.blocked?.message && (
                                <div className="mt-2 text-xs leading-5 status-warning">{item.blocked.message}</div>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <span
                                {...dragProvided.dragHandleProps}
                                className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-tertiary transition-colors hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)] ${moveLocked || actionPending !== null ? 'cursor-not-allowed opacity-40' : 'cursor-grab active:cursor-grabbing'}`}
                                title="拖动排序"
                                aria-label={`拖动排序 ${item.operatorName} · ${item.skillName}`}
                                aria-disabled={moveLocked || actionPending !== null}
                              >
                                <GripVertical size={15} strokeWidth={2} aria-hidden="true" />
                              </span>
                              <IconButton
                                icon={<ChevronUp size={15} strokeWidth={2} />}
                                variant="ghost"
                                size="sm"
                                title="上移"
                                aria-label={`上移 ${item.operatorName} · ${item.skillName}`}
                                onClick={() => void moveItem(item, -1)}
                                disabled={index === 0 || actionPending !== null || moveLocked}
                              />
                              <IconButton
                                icon={<ChevronDown size={15} strokeWidth={2} />}
                                variant="ghost"
                                size="sm"
                                title="下移"
                                aria-label={`下移 ${item.operatorName} · ${item.skillName}`}
                                onClick={() => void moveItem(item, 1)}
                                disabled={index === queueItems.length - 1 || actionPending !== null || moveLocked}
                              />
                              <IconButton
                                icon={item.enabled ? <Pause size={15} strokeWidth={1.9} /> : <Play size={15} strokeWidth={1.9} />}
                                variant="ghost"
                                size="sm"
                                title={item.enabled ? '暂停该目标' : '重新启用'}
                                aria-label={`${item.enabled ? '暂停' : '重新启用'} ${item.operatorName} · ${item.skillName}`}
                                onClick={() => void runAction(`toggle:${item.id}`, () => updateMasteryTarget(item.id, { enabled: !item.enabled }))}
                                disabled={actionPending !== null || stepBusy}
                              />
                              {canRetry ? (
                                <IconButton
                                  icon={<RotateCcw size={15} strokeWidth={1.9} />}
                                  variant="ghost"
                                  size="sm"
                                  title={item.phase === 'interrupted' ? '继续该目标' : '重试'}
                                  aria-label={`${item.phase === 'interrupted' ? '继续' : '重试'} ${item.operatorName} · ${item.skillName}`}
                                  onClick={() => void runAction(`retry:${item.id}`, () => retryMasteryTarget(item.id))}
                                  disabled={actionPending !== null}
                                />
                              ) : null}
                              <IconButton
                                icon={<Trash2 size={15} strokeWidth={1.9} />}
                                variant="ghost"
                                size="sm"
                                title="移除"
                                aria-label={`移除 ${item.operatorName} · ${item.skillName}`}
                                onClick={() => setRemoveTarget(item)}
                                disabled={actionPending !== null || stepBusy}
                              />
                            </div>
                          </div>
                            </div>
                          )}
                        </Draggable>
                      )
                    })}
                          {provided.placeholder}
                          </div>
                        )}
                      </Droppable>
                    </DragDropContext>
                  </div>
                )}

                <div className="px-4 py-3">
                  <h3 className="text-sm font-semibold text-primary"><CjkText>执行设置</CjkText></h3>
                  <div className="mt-2 space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Select
                        aria-label="检查间隔"
                        value={String(status?.campaign.settings.probeIntervalMinutes || 60)}
                        onChange={(value) => void runAction('settings:interval', () => updateMasterySettings({ probeIntervalMinutes: Number(value) as 60 | 120 | 360 }))}
                        options={[
                          { value: '60', label: '每小时检查' },
                          { value: '120', label: '每 2 小时检查' },
                          { value: '360', label: '每 6 小时检查' },
                        ]}
                        disabled={actionPending !== null}
                      />
                      <Select
                        aria-label="目标受阻时"
                        value={status?.campaign.settings.onItemBlocked || 'skip'}
                        onChange={(value) => void runAction('settings:blocked', () => updateMasterySettings({ onItemBlocked: value as 'skip' | 'pause' }))}
                        options={[
                          { value: 'skip', label: '跳过并继续' },
                          { value: 'pause', label: '暂停队列' },
                        ]}
                        disabled={actionPending !== null}
                      />
                    </div>
                    <div className="flex min-h-11 items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-primary">运行前启动游戏</div>
                        <p className="mt-0.5 text-xs text-tertiary">游戏未运行时按此开关拉起，已运行时只执行任务导航</p>
                      </div>
                      <Switch
                        compact
                        checked={status?.campaign.settings.autoStartGame !== false}
                        onChange={(checked) => void runAction('settings:start-game', () => updateMasterySettings({ autoStartGame: checked }))}
                        label="运行前启动游戏"
                      />
                    </div>
                    <div className="flex min-h-11 items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-primary">完成通知</div>
                        <p className="mt-0.5 text-xs text-tertiary">目标确认完成后发送通知</p>
                      </div>
                      <Switch
                        compact
                        checked={status?.campaign.settings.notifyOnComplete !== false}
                        onChange={(checked) => void runAction('settings:notify', () => updateMasterySettings({ notifyOnComplete: checked }))}
                        label="完成通知"
                      />
                    </div>
                    <div className="flex min-h-11 items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-primary">受阻通知</div>
                        <p className="mt-0.5 text-xs text-tertiary">目标受阻或需要人工处理时发送通知</p>
                      </div>
                      <Switch
                        compact
                        checked={status?.campaign.settings.notifyOnBlocked !== false}
                        onChange={(checked) => void runAction('settings:notify-blocked', () => updateMasterySettings({ notifyOnBlocked: checked }))}
                        label="受阻通知"
                      />
                    </div>
                  </div>
                </div>

                <div className="px-4 py-3">
                  {actionError && <div className="mb-3 rounded-xl px-3 py-2 text-xs status-danger">{actionError}</div>}
                  <div className="flex flex-wrap gap-2">
                    {campaignStatus === 'running' ? (
                      <>
                        <Button
                          variant="secondary"
                          size="md"
                          onClick={() => void runAction('pause', pauseMasteryCampaign)}
                          loading={actionPending === 'pause'}
                          loadingText="暂停中"
                          icon={<Pause size={15} strokeWidth={1.9} aria-hidden="true" />}
                          disabled={actionPending !== null}
                        >
                          暂停
                        </Button>
                        <Button
                          variant="danger"
                          size="md"
                          onClick={() => setStopConfirmOpen(true)}
                          loading={actionPending === 'stop'}
                          loadingText="停止中"
                          icon={<Square size={15} strokeWidth={1.9} aria-hidden="true" />}
                          disabled={actionPending !== null}
                        >
                          停止
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="primary"
                        size="md"
                        onClick={() => void runAction('start', campaignStatus === 'paused' || campaignStatus === 'blocked' || campaignStatus === 'interrupted' ? resumeMasteryCampaign : () => startMasteryCampaign())}
                        loading={actionPending === 'start'}
                        loadingText="启动中"
                        icon={<Play size={15} strokeWidth={1.9} aria-hidden="true" />}
                        disabled={actionPending !== null || !canStart || startBlocked || preflightLoading}
                      >
                        {campaignStatus === 'paused' || campaignStatus === 'blocked' || campaignStatus === 'interrupted' ? '继续执行' : '开始专精队列'}
                      </Button>
                    )}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-tertiary">
                    自动执行只负责发起训练和逐级复核；材料不足、训练室被占用或前置不满足时会阻塞。队列在服务端继续执行，关闭页面不影响已开始的训练。
                  </p>
                </div>
              </div>
            )}
          </Card>
        </aside>
      </div>

      <TargetDialog
        candidate={selectedCandidate}
        detail={detail}
        loading={detailLoading}
        submitting={addSubmitting}
        error={detailError || addError}
        queuedKeys={queuedKeys}
        queuedItems={selectedCandidate ? queuedByOperator.get(selectedCandidate.id) || [] : []}
        knownLevels={selectedCandidate ? knownMastery.get(selectedCandidate.id) || new Map() : new Map()}
        onClose={closeCandidate}
        onSubmit={(items) => void submitTargets(items)}
      />

      <ConfirmDialog
        isOpen={stopConfirmOpen}
        onClose={() => setStopConfirmOpen(false)}
        onConfirm={async () => {
          await runAction('stop', stopMasteryCampaign)
          setStopConfirmOpen(false)
        }}
        title="停止专精队列"
        message="停止后不会取消已经在游戏内开始的训练，材料也不会返还；下次继续时会先复核当前等级。"
        confirmText="停止自动执行"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={async () => {
          if (!removeTarget) return
          const target = removeTarget
          setRemoveTarget(null)
          await runAction(`remove:${target.id}`, () => removeMasteryTarget(target.id))
        }}
        title="移除专精目标"
        message={removeTarget ? `将从队列移除「${removeTarget.operatorName} · ${removeTarget.skillName}」，已确认的专精等级会一起清空，重新添加需要重新设置当前等级。` : ''}
        confirmText="移除目标"
        variant="danger"
      />

      <Modal
        isOpen={sklandOpen}
        onClose={() => { if (!sklandPending) setSklandOpen(false) }}
        title="森空岛数据"
        size="md"
      >
        <div className="space-y-4">
          <p className="rounded-xl px-3 py-2 text-xs leading-5 text-tertiary surface-soft">
            支持森空岛账号密码登录（使用数美设备标识），也支持粘贴已有 cred/token。凭证只保存在本机加密文件，密码会加密保存，凭证过期时自动续期。可从明日方舟工具箱的森空岛设置复制 cred 与 token；同步后干员的专精等级会直接显示在候选卡和技能列表里。
          </p>

          {sklandStatus?.configured ? (
            <div className="rounded-xl border border-[var(--app-border)] p-3">
              <div className="text-sm font-medium text-primary">
                {sklandStatus.nickname || '森空岛账号'} · {sklandStatus.uid || '未绑定'}
              </div>
              <div className="mt-1 text-xs text-tertiary">
                {sklandStatus.channel || '未知区服'} · 上次同步 {formatDateTimeCompact(sklandStatus.lastSyncedAt || null)} · {sklandStatus.characterCount} 名干员{sklandStatus.autoRefresh ? ' · 自动续期已开启' : ''}
              </div>
              {sklandStatus.training && (
                <div className="mt-1 text-xs text-secondary">
                  训练室：{sklandStatus.training.traineeName || sklandStatus.training.traineeId || '未知'} · {formatRemainingDuration(sklandStatus.training.remainSecs)}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl px-3 py-2 text-xs leading-5 text-tertiary surface-soft">
              还没有配置凭证。保存后会先校验绑定角色，再拉取养成和训练室数据。
            </div>
          )}

          {sklandError && <div className="rounded-xl px-3 py-2 text-xs status-danger">{sklandError}</div>}

          <div className="space-y-2 rounded-xl border border-[var(--app-border)] p-3">
            <div className="text-sm font-medium text-primary">账号密码登录</div>
            <p className="text-xs leading-5 text-tertiary">
              使用森空岛手机号和密码；登录时会向数美请求设备标识，密码会加密保存，凭证过期时自动重新登录。
            </p>
            <Input
              label="手机号"
              type="text"
              value={sklandAccount}
              onChange={setSklandAccount}
              placeholder="森空岛账号手机号"
              disabled={sklandPending !== null}
            />
            <Input
              label="密码"
              type="password"
              value={sklandPassword}
              onChange={setSklandPassword}
              placeholder="森空岛密码"
              disabled={sklandPending !== null}
            />
            <Button
              variant="primary"
              size="sm"
              onClick={() => void loginSklandAccount()}
              loading={sklandPending === 'login'}
              loadingText="登录中"
              disabled={sklandPending !== null}
            >
              登录并同步
            </Button>
          </div>

          <div className="text-xs font-medium text-tertiary">或使用已有凭证</div>
          <Input
            label="Cred"
            type="password"
            value={sklandCred}
            onChange={setSklandCred}
            placeholder="森空岛 cred（32 位）"
            disabled={sklandPending !== null}
          />
          <Input
            label="Token"
            type="password"
            value={sklandToken}
            onChange={setSklandToken}
            placeholder="森空岛登录 token"
            disabled={sklandPending !== null}
          />
          <Input
            label="角色 UID（可选）"
            type="text"
            value={sklandUid}
            onChange={setSklandUid}
            placeholder="多角色绑定时指定，留空使用第一个"
            disabled={sklandPending !== null}
          />

          {sklandError && <div className="rounded-xl px-3 py-2 text-xs status-danger">{sklandError}</div>}

          <div className="flex flex-wrap gap-2 border-t border-[var(--app-border)] pt-3">
            <Button
              variant="primary"
              size="sm"
              onClick={() => void saveSkland(true)}
              loading={sklandPending === 'save-sync'}
              loadingText="同步中"
              disabled={sklandPending !== null}
              icon={<RefreshCw size={14} strokeWidth={1.9} aria-hidden="true" />}
            >
              保存并同步
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void saveSkland(false)}
              loading={sklandPending === 'save'}
              loadingText="保存中"
              disabled={sklandPending !== null}
            >
              仅保存
            </Button>
            {sklandStatus?.configured && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void syncSklandData()}
                loading={sklandPending === 'sync'}
                loadingText="同步中"
                disabled={sklandPending !== null}
              >
                同步数据
              </Button>
            )}
            {sklandStatus?.configured && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => setSklandClearOpen(true)}
                disabled={sklandPending !== null}
              >
                清除凭证
              </Button>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={sklandClearOpen}
        onClose={() => setSklandClearOpen(false)}
        onConfirm={() => void clearSkland()}
        title="清除森空岛凭证"
        message="将删除本机保存的 cred/token 和上次同步的专精快照，已加入的专精队列不受影响。"
        confirmText="清除凭证"
        variant="danger"
      />
    </>
  )
}