import { useState, type ReactNode } from 'react'
import { getOperatorAvatarUrl, useItemIconCacheVersion } from '@/features/game-data'
import { Button } from '@/shared/components'
import { OPERATOR_RENDER_BATCH_SIZE } from '../model/operatorRows'

export interface OperatorPickerGridItem {
  id: string
  name: string
  rarity: number
  owned?: boolean
  elite?: number
  level?: number
  scrim?: boolean
  action: ReactNode
}

interface OperatorPickerCardProps {
  item: OperatorPickerGridItem
  eager: boolean
}

function OperatorPickerCard({ item, eager }: OperatorPickerCardProps) {
  const itemIconVersion = useItemIconCacheVersion()
  const [imageLoaded, setImageLoaded] = useState(false)
  const isOwned = item.owned !== false

  return (
    <div className={`training-operator-item relative overflow-hidden p-2.5 ${isOwned ? '' : 'opacity-75'}`}>
      <div className="relative mb-2.5 aspect-square w-full overflow-hidden rounded-xl surface-panel">
        {item.id ? (
          <>
            {!imageLoaded && (
              <div className="app-skeleton absolute inset-0 surface-soft" />
            )}
            <img
              src={getOperatorAvatarUrl(item.id, 'base', itemIconVersion)}
              alt={item.name}
              loading={eager ? 'eager' : 'lazy'}
              decoding="async"
              className={`h-full w-full object-cover transition-opacity duration-200 ${
                imageLoaded ? 'opacity-100' : 'opacity-0'
              }`}
              onLoad={() => setImageLoaded(true)}
              onError={(event) => {
                const target = event.target as HTMLImageElement
                const currentSrc = target.src
                if (!currentSrc.includes('_2.png') && !currentSrc.includes('_1.png')) {
                  target.src = getOperatorAvatarUrl(item.id, '2', itemIconVersion)
                } else if (currentSrc.includes('_2.png')) {
                  target.src = getOperatorAvatarUrl(item.id, '1', itemIconVersion)
                } else {
                  target.style.display = 'none'
                  setImageLoaded(true)
                }
              }}
            />
            {item.scrim && imageLoaded && (
              <div className={`absolute inset-0 ${isOwned ? 'bg-card/25' : 'bg-card/50'}`} />
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-tertiary">
            无头像
          </div>
        )}
        {item.rarity > 0 && (
          <div className="absolute right-2 top-2 rounded-full px-2 py-0.5 text-xs font-semibold surface-panel brand-text">
            {item.rarity}★
          </div>
        )}
      </div>

      <div className="space-y-2 text-center">
        <div className="truncate text-sm font-semibold text-foreground" title={item.name}>
          {item.name || '未知干员'}
        </div>
        <div className="flex min-h-5 flex-wrap items-center justify-center gap-1 text-xs">
          {isOwned && item.elite !== undefined && (
            <span className="whitespace-nowrap rounded-full px-2 py-0.5 surface-panel text-muted-foreground">
              精{item.elite}{item.level ? ` · ${item.level} 级` : ''}
            </span>
          )}
        </div>

        {item.action}
      </div>
    </div>
  )
}

export interface OperatorPickerGridProps {
  items: readonly OperatorPickerGridItem[]
  visibleCount: number
  totalCount: number
  hiddenCount: number
  onShowMore: () => void
}

export default function OperatorPickerGrid({
  items,
  visibleCount,
  totalCount,
  hiddenCount,
  onShowMore,
}: OperatorPickerGridProps) {
  return (
    <div className="min-h-65">
      <div className="training-operator-grid grid grid-cols-3 overflow-hidden rounded-xl surface-soft sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-5 xl:grid-cols-5">
        {items.map((item, index) => (
          <OperatorPickerCard key={item.id} item={item} eager={index < 12} />
        ))}
      </div>
      {hiddenCount > 0 && (
        <div className="flex flex-col items-center gap-2 py-3">
          <Button
            onClick={onShowMore}
            variant="secondary"
            size="md"
            className="min-w-36"
          >
            继续显示 {Math.min(OPERATOR_RENDER_BATCH_SIZE, hiddenCount)} 个
          </Button>
          <div className="text-xs text-tertiary">
            已显示 {visibleCount} / {totalCount}
          </div>
        </div>
      )}
    </div>
  )
}
