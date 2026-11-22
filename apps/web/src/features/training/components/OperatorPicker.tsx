import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { Filter, LoaderCircle, Search, UserRoundSearch } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { DialogBody, DialogFrame, DialogFrameFooter, EmptyState, Loading } from '@/shared/components'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { useFluidTabIndicator } from '@/shared/hooks/useFluidTabIndicator'
import { trainingCandidatesQueryOptions, trainingStatusCountsQueryOptions } from '../model/queries'
import { EMPTY_TRAINING_COUNTS } from '../model/statusCounts'
import {
  OPERATOR_RENDER_BATCH_SIZE,
  describeOperatorRow,
  filterOperatorRows,
  nextOperatorRenderLimit,
  paginateOperatorRows,
  resolveOperatorEmptyState,
  type OperatorEmptyState as OperatorEmptyStateContent,
} from '../model/operatorRows'
import { describeRecognitionHint } from '../model/recognition'
import {
  OPERATOR_PROFESSION_FILTERS,
  filterOperatorOptionsByProfession,
  type OperatorProfessionFilter,
} from '../model/operatorSelection'
import OperatorPickerGrid, { type OperatorPickerGridItem } from './OperatorPickerGrid'
import TrainingLoadError from './TrainingLoadError'
import type { TrainingFilters, TrainingOperator } from '../types'

const TRAINING_STATUS_OPTIONS: Array<{
  value: TrainingFilters['status']
  label: string
  desc: string
}> = [
  { value: 'trainable', label: '可养成', desc: '可加入队列' },
  { value: 'owned', label: '已拥有', desc: '已识别干员' },
  { value: 'all', label: '全部', desc: '含未拥有' },
]

function OperatorEmptyState({ title, description }: OperatorEmptyStateContent) {
  return (
    <EmptyState
      compact
      className="min-h-60 py-8"
      icon={<UserRoundSearch size={21} strokeWidth={1.8} />}
      title={title}
      description={description}
    />
  )
}

export interface OperatorPickerProps {
  isOpen: boolean
  onClose: () => void
  queueOperatorIds: ReadonlySet<string>
  queueLength: number
  busy: boolean
  operationError: string | null
  pendingOperatorIds: ReadonlySet<string>
  onAdd: (operator: TrainingOperator) => void | Promise<void>
}

export default function OperatorPicker({
  isOpen,
  onClose,
  queueOperatorIds,
  queueLength,
  busy,
  operationError,
  pendingOperatorIds,
  onAdd,
}: OperatorPickerProps) {
  const shouldReduceMotion = useReducedMotion()
  const [filters, setFilters] = useState<TrainingFilters>({
    rarity: '',
    status: 'trainable',
    needsElite2: true,
  })
  const [searchTerm, setSearchTerm] = useState('')
  const [professionFilter, setProfessionFilter] = useState<OperatorProfessionFilter>('all')
  const [visibleOperatorLimit, setVisibleOperatorLimit] = useState(OPERATOR_RENDER_BATCH_SIZE)
  const {
    containerRef: statusTabsRef,
    activeRect: activeStatusRect,
    setTabRef: setStatusTabRef,
    handleTabKeyDown: handleStatusKeyDown,
  } = useFluidTabIndicator(filters.status, isOpen)

  const rarityFilter = filters.rarity ? Number.parseInt(filters.rarity, 10) : null
  const candidateOptions = useMemo(
    () => trainingCandidatesQueryOptions({
      status: filters.status,
      rarity: rarityFilter,
      needsElite2: filters.needsElite2,
    }),
    [filters.status, rarityFilter, filters.needsElite2],
  )
  const countsOptions = useMemo(
    () => trainingStatusCountsQueryOptions({
      rarity: rarityFilter,
      needsElite2: filters.needsElite2,
    }),
    [rarityFilter, filters.needsElite2],
  )
  const candidatesQuery = useQuery(candidateOptions)
  const countsQuery = useQuery(countsOptions)
  const operators = candidatesQuery.data?.operators ?? []
  const operatorsLoading = candidatesQuery.isPending
  const recognitionHint = operatorsLoading
    ? null
    : describeRecognitionHint(candidatesQuery.data?.recognition ?? null)
  const operatorsError = candidatesQuery.isError
    ? (candidatesQuery.error instanceof Error && candidatesQuery.error.message
        ? candidatesQuery.error.message
        : '干员列表加载失败，请稍后重试')
    : null
  const countsUnavailable = countsQuery.isError && !countsQuery.data
  const trainingStatusCounts = countsQuery.data ?? EMPTY_TRAINING_COUNTS
  const statusCountsLoading = countsQuery.isFetching

  const handleTrainingStatusChange = (status: TrainingFilters['status']) => {
    setFilters(current => ({
      ...current,
      status,
      needsElite2: status === 'all' ? false : current.needsElite2,
    }))
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisibleOperatorLimit(OPERATOR_RENDER_BATCH_SIZE)
  }, [filters.status, filters.rarity, filters.needsElite2, professionFilter, searchTerm])

  const professionRows = filterOperatorOptionsByProfession(operators, professionFilter)
  const filteredOperators = filterOperatorRows(professionRows, searchTerm)
  const { rows: visibleOperators, hiddenCount } = paginateOperatorRows(
    filteredOperators,
    visibleOperatorLimit,
  )
  const emptyState = !operatorsLoading && filteredOperators.length === 0
    ? resolveOperatorEmptyState(filters, searchTerm, professionFilter)
    : null

  const handleProfessionFilterChange = (value: string) => {
    const option = OPERATOR_PROFESSION_FILTERS.find(candidate => candidate.value === value)
    if (!option) return
    setProfessionFilter(option.value)
  }

  const handleRetryCandidates = () => {
    void candidatesQuery.refetch()
    void countsQuery.refetch()
  }

  const gridItems: OperatorPickerGridItem[] = visibleOperators.map((operator) => {
    const row = describeOperatorRow(operator, queueOperatorIds.has(operator.id))
    return {
      id: operator.id,
      name: operator.name,
      rarity: operator.rarity,
      owned: row.isOwned,
      elite: row.isOwned ? operator.currentElite : undefined,
      level: row.isOwned ? operator.currentLevel : undefined,
      scrim: !row.canAdd,
      action: (
        <Button
          onClick={() => void onAdd(operator)}
          aria-label={row.canAdd ? `添加${operator.name}` : `${row.actionLabel}${operator.name}`}
          disabled={!row.canAdd || busy || pendingOperatorIds.has(operator.id)}
          aria-busy={pendingOperatorIds.has(operator.id) || undefined}
          variant="secondary"
          className="w-full"
        >
          {pendingOperatorIds.has(operator.id)
            ? <><LoaderCircle className="animate-spin" aria-hidden="true" />添加中</>
            : row.actionLabel}
        </Button>
      ),
    }
  })

  return (
    <DialogFrame
      open={isOpen}
      onOpenChange={open => { if (!open) onClose() }}
      title="添加干员"
      size="4xl"
      toolbar={(
        <div className="space-y-3.5">
          <div className="flex items-center gap-2">
            <div className="app-workspace-segments min-w-0 flex-1">
              <div
                ref={statusTabsRef}
                className="app-workspace-segment-list w-full grid-cols-3"
                role="toolbar"
                aria-label="干员范围"
              >
                {activeStatusRect.width > 0 && (
                  <motion.div
                    data-testid="training-status-indicator"
                    aria-hidden="true"
                    className="app-workspace-segment-indicator"
                    initial={false}
                    animate={{
                      x: activeStatusRect.x,
                      y: activeStatusRect.y,
                      width: activeStatusRect.width,
                      height: activeStatusRect.height,
                    }}
                    transition={shouldReduceMotion
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 420, damping: 38, mass: 0.72 }}
                  />
                )}
                {TRAINING_STATUS_OPTIONS.map((option) => {
                  const selected = filters.status === option.value
                  const count = countsUnavailable || (statusCountsLoading && trainingStatusCounts[option.value] === 0)
                    ? '-'
                    : trainingStatusCounts[option.value]
                  return (
                    <button
                      key={option.value}
                      ref={setStatusTabRef(option.value)}
                      type="button"
                      onClick={() => handleTrainingStatusChange(option.value)}
                      onKeyDown={(event) => handleStatusKeyDown(
                        event,
                        TRAINING_STATUS_OPTIONS.map(({ value }) => value),
                        handleTrainingStatusChange,
                      )}
                      aria-pressed={selected}
                      tabIndex={selected ? 0 : -1}
                      className={`app-workspace-segment min-h-11 ${selected ? 'is-selected' : ''}`}
                    >
                      <span
                        className="app-workspace-segment-icon training-status-count"
                        aria-label={`${count} 名`}
                      >
                        {count}
                      </span>
                      <span className="app-workspace-segment-copy">
                        <span>{option.label}</span>
                        <small>{option.desc}</small>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
            {countsUnavailable && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void countsQuery.refetch()}
              >
                重试计数
              </Button>
            )}
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_9rem_auto]">
            <div className="relative min-w-0">
              <Search size={17} strokeWidth={1.9} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
              <Input
                type="text"
                autoComplete="off"
                aria-label="搜索干员名称"
                placeholder="搜索干员"
                value={searchTerm}
                onChange={event => setSearchTerm(event.target.value)}
                className="w-full pl-9"
              />
            </div>
            <Select
              items={[...OPERATOR_PROFESSION_FILTERS]}
              value={professionFilter}
              onValueChange={(next, details) => { if (details.reason !== 'none' && next !== null) handleProfessionFilterChange(next) }}
            >
              <SelectTrigger aria-label="职业" className="min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...OPERATOR_PROFESSION_FILTERS].map(item => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.rarity}
              onValueChange={(rarity, details) => { if (details.reason !== 'none' && rarity !== null) setFilters({ ...filters, rarity }) }}
              items={[
                { value: '', label: '全部稀有度' },
                { value: '6', label: '6 星' },
                { value: '5', label: '5 星' },
                { value: '4', label: '4 星' },
              ]}
            >
              <SelectTrigger aria-label="稀有度" className="min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[
                  { value: '', label: '全部稀有度' },
                  { value: '6', label: '6 星' },
                  { value: '5', label: '5 星' },
                  { value: '4', label: '4 星' },
                ].map(item => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant={filters.needsElite2 ? 'default' : 'secondary'}
              onClick={() => setFilters({ ...filters, needsElite2: !filters.needsElite2 })}
              aria-pressed={filters.needsElite2}
              className="whitespace-nowrap"
            >
              <Filter size={15} strokeWidth={1.9} aria-hidden="true" />
              未精二
            </Button>
          </div>
        </div>
      )}
      footer={(
        <DialogFrameFooter align="between">
          <span className="text-sm text-muted-foreground">已加入 {queueLength} 名干员</span>
          <Button onClick={onClose} variant="secondary">完成选择</Button>
        </DialogFrameFooter>
      )}
    >
      <DialogBody>
        <div className="space-y-3.5">
          {operationError && <div role="alert" className="training-feedback status-danger">{operationError}</div>}

          {recognitionHint && (
            <div
              role="status"
              className={`training-feedback ${recognitionHint.tone === 'warning' ? 'status-warning' : ''}`}
            >
              {recognitionHint.message}
            </div>
          )}

          {operatorsLoading ? (
            <div className="flex min-h-60 items-center justify-center">
              <Loading text="正在读取干员..." />
            </div>
          ) : operatorsError ? (
            <TrainingLoadError
              title="干员列表加载失败"
              description={operatorsError}
              onRetry={handleRetryCandidates}
            />
          ) : emptyState ? (
            <OperatorEmptyState {...emptyState} />
          ) : (
            <OperatorPickerGrid
              items={gridItems}
              visibleCount={visibleOperators.length}
              totalCount={filteredOperators.length}
              hiddenCount={hiddenCount}
              onShowMore={() => setVisibleOperatorLimit(nextOperatorRenderLimit)}
            />
          )}
        </div>
      </DialogBody>
    </DialogFrame>
  )
}
