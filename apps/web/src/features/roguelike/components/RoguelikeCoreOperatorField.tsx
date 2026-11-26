import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { UserRound, UserRoundSearch, X } from 'lucide-react'
import {
  getOperatorAvatarUrl,
  operatorCatalogQueryOptions,
  useItemIconCacheVersion,
} from '@/features/game-data'
import { OperatorSelectModal, type OperatorPickerOption } from '@/features/training'
import { Button } from '@/shared/ui/button'
import { Field, FieldError, FieldTitle } from '@/shared/ui/field'

export interface RoguelikeCoreOperatorFieldProps {
  id: string
  label: string
  /** 已保存的中文干员名；空字符串表示由 MAA 按练度自动选择。 */
  value: string
  error?: string
  disabled?: boolean
  onChange: (value: string) => void
}

export default function RoguelikeCoreOperatorField({
  id,
  label,
  value,
  error,
  disabled,
  onChange,
}: RoguelikeCoreOperatorFieldProps) {
  const [isOpen, setIsOpen] = useState(false)
  const itemIconVersion = useItemIconCacheVersion()
  const operatorName = value.trim()
  const labelId = `${id}-label`
  const errorId = `${id}-error`
  const catalogQuery = useQuery({
    ...operatorCatalogQueryOptions(),
    enabled: operatorName !== '',
  })
  const operator = useMemo(
    () => (catalogQuery.data ?? []).find(candidate => candidate.name === operatorName) ?? null,
    [catalogQuery.data, operatorName],
  )

  const handleSelect = (selected: OperatorPickerOption) => {
    onChange(selected.name)
  }

  const handleOpen = () => {
    if (disabled) return
    setIsOpen(true)
  }

  const handleClear = () => {
    if (disabled) return
    onChange('')
  }

  return (
    <Field
      aria-labelledby={labelId}
      data-invalid={error ? true : undefined}
      data-disabled={disabled ? true : undefined}
    >
      <FieldTitle id={labelId} className="text-muted-foreground">{label}</FieldTitle>
      <div className="roguelike-core-operator-control">
        {operatorName === '' ? (
          <span className="roguelike-core-operator-placeholder">未选择</span>
        ) : (
          <>
            <span className="roguelike-core-operator-avatar" aria-hidden="true">
              <UserRound size={20} strokeWidth={1.8} />
              {operator && (
                <img
                  src={getOperatorAvatarUrl(operator.id, 'base', itemIconVersion)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onError={event => { event.currentTarget.style.display = 'none' }}
                />
              )}
            </span>
            <span className="roguelike-core-operator-name" title={operatorName}>{operatorName}</span>
          </>
        )}
        <Button
          id={id}
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleOpen}
          disabled={disabled}
          aria-label={operatorName === '' ? '选择核心干员' : `更换核心干员（当前：${operatorName}）`}
          aria-invalid={error ? true : undefined}
          aria-errormessage={error ? errorId : undefined}
        >
          <UserRoundSearch data-icon="inline-start" aria-hidden="true" />
          {operatorName === '' ? '选择干员' : '更换'}
        </Button>
        {operatorName !== '' && (
          <Button
            size="icon"
            variant="ghost"
            title="清除核心干员"
            aria-label="清除核心干员"
            onClick={handleClear}
            disabled={disabled}
          >
            <X aria-hidden="true" />
          </Button>
        )}
      </div>
      {error && <FieldError id={errorId} className="text-xs text-destructive-text">{error}</FieldError>}
      <OperatorSelectModal
        isOpen={isOpen && !disabled}
        onClose={() => setIsOpen(false)}
        onConfirm={handleSelect}
        title="选择核心干员"
        selectedOperatorId={operator?.id ?? null}
        selectedOperatorName={operatorName || null}
        defaultSortDirection="desc"
      />
    </Field>
  )
}
