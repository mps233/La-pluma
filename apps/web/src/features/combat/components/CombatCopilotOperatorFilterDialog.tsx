import { useMemo, useState, type UIEvent } from 'react'
import { Search, X } from 'lucide-react'
import { getOperatorAvatarUrl, useItemIconCacheVersion } from '@/features/game-data'
import { Button } from '@/shared/ui/button'
import { EmptyState, Loading } from '@/shared/components'
import { Checkbox } from '@/shared/ui/checkbox'
import { Input } from '@/shared/ui/input'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import {
  filterOperatorOptions,
  normalizeOperatorSelection,
  orderOperatorFilterOptions,
  type OperatorFilterOption,
  type OperatorFilterSection,
  type OperatorSelection,
} from '../model/operatorFilter'

export interface CombatCopilotOperatorFilterDialogProps {
  isOpen: boolean
  selection: OperatorSelection
  enabled: boolean
  remember: boolean
  operators: readonly OperatorFilterOption[]
  operatorsLoading: boolean
  operatorsError: string | null
  onRetryData: () => void
  onConfirm: (selection: OperatorSelection, remember: boolean) => void
  onClose: () => void
}

const OPERATOR_RENDER_BATCH = 40
const OPERATOR_SCROLL_EDGE = 32

interface OperatorSectionProps {
  title: string
  addLabel: string
  hint: string
  section: OperatorFilterSection
  selected: readonly string[]
  options: readonly OperatorFilterOption[]
  iconVersion: number
  onAdd: (option: OperatorFilterOption) => void
  onRemove: (name: string) => void
}

function OperatorSection({
  title,
  addLabel,
  hint,
  section,
  selected,
  options,
  iconVersion,
  onAdd,
  onRemove,
}: OperatorSectionProps) {
  const [term, setTerm] = useState('')
  const [limit, setLimit] = useState(OPERATOR_RENDER_BATCH)

  const ordered = useMemo(() => orderOperatorFilterOptions(options, section), [options, section])
  const filtered = useMemo(() => filterOperatorOptions(ordered, term), [ordered, term])
  const visible = filtered.slice(0, limit)

  const handleTermChange = (value: string) => {
    setTerm(value)
    setLimit(OPERATOR_RENDER_BATCH)
  }

  const handleScroll = (event: UIEvent<HTMLUListElement>) => {
    const list = event.currentTarget
    if (list.scrollHeight - list.scrollTop - list.clientHeight > OPERATOR_SCROLL_EDGE) return
    setLimit(current => Math.min(current + OPERATOR_RENDER_BATCH, filtered.length))
  }

  return (
    <section className="combat-copilot-operator-section" aria-label={title}>
      <div className="combat-copilot-operator-section-heading">
        <span className="combat-copilot-operator-section-title">{title}</span>
        <span className="combat-copilot-operator-section-count">{selected.length} 名</span>
      </div>
      <p className="combat-copilot-operator-hint">{hint}</p>

      {selected.length > 0 && (
        <div className="combat-copilot-operator-chips">
          {selected.map(name => (
            <button
              key={name}
              type="button"
              className="combat-copilot-operator-chip"
              aria-label={`移除 ${name}`}
              onClick={() => onRemove(name)}
            >
              {name}
              <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}

      <div className="relative">
        <Search size={17} strokeWidth={1.9} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
        <Input
          type="text"
          autoComplete="off"
          aria-label={`搜索${title}`}
          placeholder="搜索干员名称或拼音"
          value={term}
          onChange={event => handleTermChange(event.target.value)}
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="combat-copilot-operator-hint">
          {selected.length > 0 ? '没有其他符合条件的干员。' : '没有符合条件的干员。'}
        </p>
      ) : (
        <ul className="combat-copilot-operator-options" onScroll={handleScroll}>
          {visible.map(option => (
            <li key={option.id}>
              <button
                type="button"
                className="combat-copilot-operator-option"
                aria-label={`${addLabel} ${option.name}`}
                onClick={() => onAdd(option)}
              >
                <img
                  className="combat-copilot-operator-avatar"
                  src={getOperatorAvatarUrl(option.id, 'base', iconVersion)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <span className="combat-copilot-operator-copy">
                  <span className="combat-copilot-operator-name">{option.name}</span>
                  <span className="combat-copilot-operator-meta">
                    {option.rarity ? `${option.rarity}★` : '未知稀有度'}
                  </span>
                </span>
                <span className={`combat-copilot-operator-ownership${option.owned ? ' is-owned' : ' is-missing'}`}>
                  {option.owned ? '已拥有' : '未拥有'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function OperatorFilterForm({
  selection,
  enabled,
  remember: initialRemember,
  operators,
  operatorsLoading,
  operatorsError,
  onRetryData,
  onConfirm,
  onClose,
}: Omit<CombatCopilotOperatorFilterDialogProps, 'isOpen'>) {
  const [included, setIncluded] = useState<readonly string[]>(() => normalizeOperatorSelection(selection).included)
  const [excluded, setExcluded] = useState<readonly string[]>(() => normalizeOperatorSelection(selection).excluded)
  const [remember, setRemember] = useState(initialRemember)
  const iconVersion = useItemIconCacheVersion()

  const available = useMemo(
    () => operators.filter(operator => !included.includes(operator.name) && !excluded.includes(operator.name)),
    [operators, included, excluded],
  )

  const addIncluded = (option: OperatorFilterOption) => {
    setExcluded(current => current.filter(name => name !== option.name))
    setIncluded(current => (current.includes(option.name) ? current : [...current, option.name]))
  }

  const addExcluded = (option: OperatorFilterOption) => {
    setIncluded(current => current.filter(name => name !== option.name))
    setExcluded(current => (current.includes(option.name) ? current : [...current, option.name]))
  }

  const removeIncluded = (name: string) => setIncluded(current => current.filter(entry => entry !== name))
  const removeExcluded = (name: string) => setExcluded(current => current.filter(entry => entry !== name))

  const handleConfirm = () => {
    onConfirm(normalizeOperatorSelection({ included, excluded }), remember)
    onClose()
  }

  if (operatorsLoading) {
    return <Loading size="sm" text="干员数据加载中…" />
  }

  if (operatorsError) {
    return (
      <div className="combat-copilot-operator-error" role="alert">
        <span>{operatorsError}</span>
        <Button size="sm" variant="secondary" onClick={onRetryData}>重试</Button>
      </div>
    )
  }

  return (
    <div className="combat-copilot-operator-filter">
      {!enabled && (
        <p className="combat-copilot-operator-hint" role="status">
          干员筛选已停用，本次搜索不会使用包含/排除条件；已选干员仍会保留。
        </p>
      )}

      {operators.length === 0 ? (
        <EmptyState compact title="没有可用的干员数据" description="识别持有干员后可以按干员筛选作业。" />
      ) : (
        <>
          <OperatorSection
            title="包含干员"
            addLabel="加入包含"
            hint="作业包含任一这些干员即可。"
            section="included"
            selected={included}
            options={available}
            iconVersion={iconVersion}
            onAdd={addIncluded}
            onRemove={removeIncluded}
          />
          <OperatorSection
            title="排除干员"
            addLabel="加入排除"
            hint="包含这些干员的作业不会出现在结果里。"
            section="excluded"
            selected={excluded}
            options={available}
            iconVersion={iconVersion}
            onAdd={addExcluded}
            onRemove={removeExcluded}
          />
        </>
      )}

      <label className="group flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted-foreground">
        <Checkbox
          checked={remember}
          onCheckedChange={setRemember}
        />
        <span className="transition-colors group-hover:text-primary">记住筛选结果</span>
      </label>

      <div className="combat-copilot-operator-actions">
        <span className="combat-copilot-operator-summary">
          包含 {included.length} · 排除 {excluded.length}
        </span>
        <div className="combat-copilot-operator-action-buttons">
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button onClick={handleConfirm}>确认筛选</Button>
        </div>
      </div>
    </div>
  )
}

export default function CombatCopilotOperatorFilterDialog({
  isOpen,
  onClose,
  ...props
}: CombatCopilotOperatorFilterDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent
        showCloseButton={false}
        aria-modal="true"
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
      >
        <DialogHeader className="flex-row items-center justify-between gap-3 border-b px-4 py-3">
          <DialogTitle>筛选干员</DialogTitle>
          <DialogClose render={<Button size="icon" variant="ghost" aria-label="关闭对话框" />}>
            <X className="size-4" aria-hidden="true" />
          </DialogClose>
        </DialogHeader>
        <div data-slot="dialog-body" className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {isOpen && <OperatorFilterForm {...props} onClose={onClose} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}
