import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, UserRoundSearch } from 'lucide-react'
import {
  operBoxQueryOptions,
  operatorCatalogQueryOptions,
  type OperatorDetailed,
} from '@/features/game-data'
import { Button } from '@/shared/ui/button'
import { DialogBody, DialogFrame, DialogFrameFooter, EmptyState, Loading } from '@/shared/components'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import {
  OPERATOR_RENDER_BATCH_SIZE,
  filterOperatorRows,
  nextOperatorRenderLimit,
  paginateOperatorRows,
} from '../model/operatorRows'
import {
  OPERATOR_PROFESSION_FILTERS,
  filterOperatorOptionsByProfession,
  sortOperatorPickerOptions,
  toOperatorPickerOption,
  type OperatorProfessionFilter,
} from '../model/operatorSelection'
import OperatorPickerGrid, { type OperatorPickerGridItem } from './OperatorPickerGrid'
import TrainingLoadError from './TrainingLoadError'
import type { OperatorPickerOption, OperatorSortDirection } from '../types'

export interface OperatorSelectModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (operator: OperatorPickerOption) => void
  title?: string
  selectedOperatorId?: string | null
  selectedOperatorName?: string | null
  /**
   * 默认排序方向：先按精英阶段，再按等级。省略时保持数据源顺序，
   * 与未引入排序能力前的行为一致。
   */
  defaultSortDirection?: OperatorSortDirection
}

const EMPTY_OPERATORS: readonly OperatorDetailed[] = []
const LOAD_ERROR_MESSAGE = '干员列表加载失败，请稍后重试'
const DEFAULT_PROFESSION_FILTER: OperatorProfessionFilter = 'all'

function OperatorEmptyState({ title, description }: { title: string; description?: string }) {
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

/**
 * 跨页面复用的单干员选择模态窗。没有识别数据时静默回退到全量目录，
 * 列表不得反显识别或拥有状态；选择结果只回传干员身份。
 * 职业筛选读同 id 的目录条目补齐识别快照缺失的职业字段。
 */
export default function OperatorSelectModal({
  isOpen,
  onClose,
  onConfirm,
  title = '选择干员',
  selectedOperatorId = null,
  selectedOperatorName = null,
  defaultSortDirection,
}: OperatorSelectModalProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [professionFilter, setProfessionFilter] = useState<OperatorProfessionFilter>(DEFAULT_PROFESSION_FILTER)
  const [visibleLimit, setVisibleLimit] = useState(OPERATOR_RENDER_BATCH_SIZE)
  const [pendingSelection, setPendingSelection] = useState<OperatorPickerOption | null>(null)

  const operBoxQuery = useQuery({ ...operBoxQueryOptions(), enabled: isOpen })
  const ownedOperators = operBoxQuery.data?.data ?? EMPTY_OPERATORS
  const hasOwnedOperators = ownedOperators.length > 0
  const catalogQuery = useQuery({ ...operatorCatalogQueryOptions(), enabled: isOpen })

  const options = useMemo(() => {
    const source = hasOwnedOperators ? ownedOperators : catalogQuery.data ?? EMPTY_OPERATORS
    const catalogById = hasOwnedOperators
      ? new Map((catalogQuery.data ?? EMPTY_OPERATORS).map(operator => [operator.id, operator]))
      : null
    return source.map(operator => (
      catalogById
        ? toOperatorPickerOption(operator, catalogById.get(operator.id))
        : toOperatorPickerOption(operator)
    ))
  }, [hasOwnedOperators, ownedOperators, catalogQuery.data])
  const initialSelection = useMemo(() => (
    (selectedOperatorId ? options.find(option => option.id === selectedOperatorId) : undefined)
    ?? (selectedOperatorName ? options.find(option => option.name === selectedOperatorName) : undefined)
    ?? null
  ), [options, selectedOperatorId, selectedOperatorName])
  const selectedOperator = pendingSelection ?? initialSelection
  const catalogError = operBoxQuery.isSuccess && !hasOwnedOperators && catalogQuery.isError
  const loading = operBoxQuery.isPending || catalogQuery.isPending
  const hasError = operBoxQuery.isError || catalogError
  const professionFilterVisible = useMemo(
    () => options.some(option => Boolean(option.profession)),
    [options],
  )

  const filteredOperators = useMemo(() => {
    const byProfession = filterOperatorOptionsByProfession(options, professionFilter)
    const bySearchTerm = filterOperatorRows(byProfession, searchTerm)
    return defaultSortDirection
      ? sortOperatorPickerOptions(bySearchTerm, defaultSortDirection)
      : bySearchTerm
  }, [options, professionFilter, searchTerm, defaultSortDirection])
  const { rows: visibleOperators, hiddenCount } = paginateOperatorRows(filteredOperators, visibleLimit)
  const emptyState = !loading && !hasError && filteredOperators.length === 0
  const hasActiveFilter = professionFilter !== DEFAULT_PROFESSION_FILTER || searchTerm.trim() !== ''

  const handleSearchChange = (value: string) => {
    setSearchTerm(value)
    setVisibleLimit(OPERATOR_RENDER_BATCH_SIZE)
  }

  const handleProfessionFilterChange = (value: string) => {
    const option = OPERATOR_PROFESSION_FILTERS.find(candidate => candidate.value === value)
    if (!option) return
    setProfessionFilter(option.value)
    setVisibleLimit(OPERATOR_RENDER_BATCH_SIZE)
  }

  const handleClose = () => {
    setPendingSelection(null)
    onClose()
  }

  const handleConfirm = () => {
    if (!selectedOperator) return
    setPendingSelection(null)
    onConfirm(selectedOperator)
    onClose()
  }

  const handleRetry = () => {
    void operBoxQuery.refetch()
    if (catalogError) void catalogQuery.refetch()
  }

  const emptyDescription = professionFilter !== DEFAULT_PROFESSION_FILTER
    ? (searchTerm.trim() ? '换个名称或职业再试。' : '换个职业再试。')
    : (searchTerm.trim() ? '换个名称再试。' : undefined)

  const gridItems: OperatorPickerGridItem[] = visibleOperators.map((operator) => {
    const isSelected = operator.id === selectedOperator?.id
    return {
      id: operator.id,
      name: operator.name,
      rarity: operator.rarity,
      elite: operator.elite,
      level: operator.level,
      action: (
        <Button
          variant={isSelected ? 'default' : 'secondary'}
          className="w-full"
          aria-pressed={isSelected}
          aria-label={`${isSelected ? '已选择' : '选择'}${operator.name}`}
          onClick={() => setPendingSelection(operator)}
        >
          {isSelected ? '已选择' : '选择'}
        </Button>
      ),
    }
  })

  return (
    <DialogFrame
      open={isOpen}
      onOpenChange={open => { if (!open) handleClose() }}
      title={title}
      size="4xl"
      toolbar={(
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search size={17} strokeWidth={1.9} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
            <Input
              type="text"
              autoComplete="off"
              aria-label="搜索干员名称"
              placeholder="搜索干员"
              value={searchTerm}
              onChange={event => handleSearchChange(event.target.value)}
              className="w-full pl-9"
            />
          </div>
          {professionFilterVisible && (
            <Select
              items={[...OPERATOR_PROFESSION_FILTERS]}
              value={professionFilter}
              onValueChange={(next, details) => { if (details.reason !== 'none' && next !== null) handleProfessionFilterChange(next) }}
            >
              <SelectTrigger aria-label="职业筛选" className="w-36 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...OPERATOR_PROFESSION_FILTERS].map(item => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
      footer={(
        <DialogFrameFooter align="between">
          <span className="text-sm text-muted-foreground">
            {selectedOperator ? `已选择 ${selectedOperator.name}` : '选择一名干员'}
          </span>
          <div className="flex items-center gap-3.5">
            <Button variant="secondary" onClick={handleClose}>取消</Button>
            <Button onClick={handleConfirm} disabled={!selectedOperator}>确认选择</Button>
          </div>
        </DialogFrameFooter>
      )}
    >
      <DialogBody>
        {loading ? (
          <div className="flex min-h-60 items-center justify-center">
            <Loading text="正在读取干员..." />
          </div>
        ) : hasError ? (
          <TrainingLoadError
            title="干员列表加载失败"
            description={LOAD_ERROR_MESSAGE}
            onRetry={handleRetry}
          />
        ) : emptyState ? (
          <OperatorEmptyState
            title={hasActiveFilter ? '没有找到符合条件的干员' : '没有可选择的干员'}
            description={hasActiveFilter ? emptyDescription : undefined}
          />
        ) : (
          <OperatorPickerGrid
            items={gridItems}
            visibleCount={visibleOperators.length}
            totalCount={filteredOperators.length}
            hiddenCount={hiddenCount}
            onShowMore={() => setVisibleLimit(nextOperatorRenderLimit)}
          />
        )}
      </DialogBody>
    </DialogFrame>
  )
}
