import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { Filter, LoaderCircle, Search, UserRoundSearch } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { EmptyState, Input, Loading, Select } from '@/shared/components'
import { Modal } from '@/shared/components/Modal'
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
      className="py-8"
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
  } = useFluidTabIndicator(filters.status)

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
  const trainingStatusCounts = countsQuery.data ?? EMPTY_TRAINING_COUNTS
  // 计数失败静默保留旧值；只有读取中且尚无计数时显示占位。
  const statusCountsLoading = countsQuery.isFetching

  const handleTrainingStatusChange = (status: TrainingFilters['status']) => {
    setFilters(current => ({
      ...current,
      status,
      needsElite2: status === 'all' ? false : current.needsElite2,
    }))
  }

  useEffect(() => {
    // 筛选/搜索变化时重置分页游标；这是对当前已渲染列表的同步复位。
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
          aria-label={row.canAdd ? `添加${operator.name}` : undefined}
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
    <Modal isOpen={isOpen} onClose={onClose} title="添加干员" size="xl" footer={<div className="flex w-full items-center justify-between gap-3.5"><span className="text-sm text-muted-foreground">已加入 {queueLength} 名干员</span><Button onClick={onClose} variant="secondary">完成选择</Button></div>}>
      {operationError && <div role="alert" className="training-feedback status-danger">{operationError}</div>}
      <div className="space-y-3.5">
        <div className="flex flex-col gap-3.5">
          <div className="app-workspace-segments app-liquid-tab-pill training-status-shell">
            <div
              ref={statusTabsRef}
              className="app-workspace-segment-list grid-cols-3"
              role="toolbar"
              aria-label="干员范围"
            >
              {activeStatusRect.width > 0 && (
                <motion.div
                  data-testid="training-status-highlight"
                  aria-hidden="true"
                  className="app-workspace-segment-indicator training-status-highlight"
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
                const selected = filters.status === option.value;
                const count = statusCountsLoading && trainingStatusCounts[option.value] === 0
                  ? '-'
                  : trainingStatusCounts[option.value];
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
                    className={`app-workspace-segment training-status-segment min-h-11 ${selected ? 'is-selected' : ''}`}
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
                );
              })}
            </div>
          </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_9rem_auto]">
          <Input
            type="text"
            aria-label="搜索干员名称"
            placeholder="搜索干员"
            value={searchTerm}
            onChange={setSearchTerm}
            icon={<Search size={17} strokeWidth={1.9} aria-hidden="true" />}
            className="min-w-0"
          />
          <Select
            aria-label="职业"
            value={professionFilter}
            onChange={handleProfessionFilterChange}
            options={[...OPERATOR_PROFESSION_FILTERS]}
            className="min-w-0"
          />
          <Select
            aria-label="稀有度"
            value={filters.rarity}
            onChange={(rarity) => setFilters({ ...filters, rarity })}
            options={[
              { value: '', label: '全部稀有度' },
              { value: '6', label: '6 星' },
              { value: '5', label: '5 星' },
              { value: '4', label: '4 星' },
            ]}
            className="min-w-0"
          />
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

        {recognitionHint && (
          <div
            role="status"
            className={`training-feedback ${recognitionHint.tone === 'warning' ? 'status-warning' : ''}`}
          >
            {recognitionHint.message}
          </div>
        )}

        {operatorsLoading ? (
          <div className="flex min-h-65 items-center justify-center">
            <Loading text="正在读取干员..." />
          </div>
        ) : operatorsError ? (
          <TrainingLoadError
            title="干员列表加载失败"
            description={operatorsError}
            onRetry={() => void candidatesQuery.refetch()}
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
    </Modal>
  )
}
