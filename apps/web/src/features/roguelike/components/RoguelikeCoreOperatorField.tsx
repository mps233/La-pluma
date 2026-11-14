import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { UserRound, UserRoundSearch, X } from 'lucide-react'
import {
  getOperatorAvatarUrl,
  operatorCatalogQueryOptions,
  useItemIconCacheVersion,
} from '@/features/game-data'
import { OperatorSelectModal, type OperatorPickerOption } from '@/features/training'
import { Button, IconButton } from '@/shared/components'

export interface RoguelikeCoreOperatorFieldProps {
  id: string
  label: string
  /** 已保存的中文干员名；空字符串表示由 MAA 按练度自动选择。 */
  value: string
  onChange: (value: string) => void
}

export default function RoguelikeCoreOperatorField({
  id,
  label,
  value,
  onChange,
}: RoguelikeCoreOperatorFieldProps) {
  const [isOpen, setIsOpen] = useState(false)
  const itemIconVersion = useItemIconCacheVersion()
  const operatorName = value.trim()
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

  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-muted-foreground">{label}</label>
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
          icon={<UserRoundSearch size={15} strokeWidth={1.9} aria-hidden="true" />}
          onClick={() => setIsOpen(true)}
        >
          {operatorName === '' ? '选择干员' : '更换'}
        </Button>
        {operatorName !== '' && (
          <IconButton
            icon={<X size={16} aria-hidden="true" />}
            title="清除核心干员"
            aria-label="清除核心干员"
            onClick={() => onChange('')}
          />
        )}
      </div>
      <OperatorSelectModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onConfirm={handleSelect}
        title="选择核心干员"
        selectedOperatorId={operator?.id ?? null}
        selectedOperatorName={operatorName || null}
        defaultSortDirection="desc"
      />
    </div>
  )
}
