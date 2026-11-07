import { getErrorMessage } from '@/utils/errorMessage'
import '../styles/pages/statistics.css'
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { maaApi, getAllOperators, getDropStatistics, getItemIconUrl, getOperBoxData, fetchOperatorMaterials, getTrainingQueue } from '../services/api'
import { getOperatorAvatarUrl } from '../services/operatorQuotes'
import { motion, useReducedMotion } from 'framer-motion'
import { GlassCard, GlassSegmented } from '@zakisheriff/liquid-glass'
import {
  ChevronDown,
  Download,
  Package as PackageIcon,
  Play,
  RotateCcw,
  TrendingUp,
  Users,
} from 'lucide-react'
import Icons from './Icons'
import DropRecords from './DropRecords'
import StatisticsSummary from './StatisticsSummary'
import { PageHeader, Button, Card, EmptyState, Loading, CjkText } from './common'
import { keepNumberWithUnit } from '../utils/typography'
import { useStatusStore } from '../store/statusStore'
import { useUIStore } from '../stores'
import FloatingStatusIndicator from './FloatingStatusIndicator'
import { useItemIconCacheVersion } from '../hooks/useItemIconCacheVersion'
import type {
  DepotDataDetailed,
  OperBoxData,
  OperatorDetailed,
  FilterRarity,
  FilterElite,
  FilterPotential,
  FilterOwnership,
  FilterProfession,
  SortBy,
  ActiveTask,
  ActiveTab,
  OpenMenu,
  DropRecordsProps,
} from '@/types/components'

type FilterMenuKey = Exclude<OpenMenu, null>

interface FilterMenuOption {
  value: string
  label: string
}

interface FilterMenuProps {
  menuKey: FilterMenuKey
  label: string
  value: string
  options: readonly FilterMenuOption[]
  isActive: boolean
  isOpen: boolean
  mobileAlign?: 'start' | 'end'
  menuWidth?: number
  onOpenChange: (menu: OpenMenu) => void
  onSelect: (value: string) => void
}

interface InlineDataErrorProps {
  title: string
  description: string
  isRetrying: boolean
  onRetry: () => void
}

interface FilterMenuPosition {
  top: number
  left: number
  width: number
  maxHeight: number
  placement: 'top' | 'bottom'
}

const filterButtonClass = (isActive: boolean, isOpen: boolean) =>
  `data-statistics-filter-trigger flex min-h-11 w-full items-center justify-center gap-1 rounded-[var(--app-radius-md)] px-2 text-xs font-medium sm:w-auto sm:gap-1.5 sm:px-3${
    isActive ? ' is-active' : ''
  }${isOpen ? ' is-open' : ''}`

const menuSurfaceClass = 'data-statistics-menu-surface fixed z-[2000]'

const menuOptionClass = (isActive: boolean) =>
  `flex min-h-11 w-full items-center justify-center rounded-[var(--app-radius-md)] px-3 text-center text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-accent)] ${
    isActive
      ? 'bg-[var(--app-accent-soft)] font-medium text-primary'
      : 'text-secondary hover:bg-[var(--app-surface-muted)] hover:text-primary'
  }`

const taskPanelClass = (isActive: boolean) =>
  `data-statistics-task-card !p-0${isActive ? ' is-active' : ''}`

const chipClass = 'rounded-full bg-[var(--app-surface-muted)] px-2 py-0.5 text-xs whitespace-nowrap text-secondary'
const timestampFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const formatTimestamp = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : timestampFormatter.format(date)
}
const statisticsTabs = [
  {
    id: 'operbox',
    title: '干员识别',
    description: '档案与养成进度',
    icon: 'Users',
  },
  {
    id: 'depot',
    title: '仓库识别',
    description: '库存与材料分类',
    icon: 'Package',
  },
  {
    id: 'drops',
    title: '掉落记录',
    description: '作战收益统计',
    icon: 'TrendingUp',
  },
] as const satisfies ReadonlyArray<{
  id: ActiveTab
  title: string
  description: string
  icon: 'Users' | 'Package' | 'TrendingUp'
}>
const ownershipOptions: readonly FilterMenuOption[] = [
  { value: 'all', label: '全部' },
  { value: 'owned', label: '已拥有' },
  { value: 'unowned', label: '未拥有' },
]
const rarityOptions: readonly FilterMenuOption[] = [
  { value: 'all', label: '全部' },
  { value: '6', label: '6星' },
  { value: '5', label: '5星' },
  { value: '4', label: '4星' },
  { value: '3', label: '3星' },
  { value: '2', label: '2星' },
  { value: '1', label: '1星' },
]
const professionOptions: readonly FilterMenuOption[] = [
  { value: 'all', label: '全部' },
  { value: 'PIONEER', label: '先锋' },
  { value: 'WARRIOR', label: '近卫' },
  { value: 'TANK', label: '重装' },
  { value: 'SNIPER', label: '狙击' },
  { value: 'CASTER', label: '术师' },
  { value: 'MEDIC', label: '医疗' },
  { value: 'SUPPORT', label: '辅助' },
  { value: 'SPECIAL', label: '特种' },
]
const eliteOptions: readonly FilterMenuOption[] = [
  { value: 'all', label: '全部' },
  { value: '2', label: '精英2' },
  { value: '1', label: '精英1' },
  { value: '0', label: '精英0' },
]
const potentialOptions: readonly FilterMenuOption[] = [
  { value: 'all', label: '全部' },
  { value: '6', label: '潜能6' },
  { value: '5', label: '潜能5' },
  { value: '4', label: '潜能4' },
  { value: '3', label: '潜能3' },
  { value: '2', label: '潜能2' },
  { value: '1', label: '潜能1' },
]
const sortOptions: readonly FilterMenuOption[] = [
  { value: 'default', label: '默认顺序' },
  { value: 'rarity', label: '星级降序' },
  { value: 'level', label: '等级降序' },
  { value: 'potential', label: '潜能降序' },
]
const ownershipLabels: Record<FilterOwnership, string> = {
  all: '拥有状态',
  owned: '已拥有',
  unowned: '未拥有',
}
const professionLabels: Record<FilterProfession, string> = {
  all: '职业',
  PIONEER: '先锋',
  WARRIOR: '近卫',
  TANK: '重装',
  SNIPER: '狙击',
  CASTER: '术师',
  MEDIC: '医疗',
  SUPPORT: '辅助',
  SPECIAL: '特种',
}
const sortLabels: Record<SortBy, string> = {
  default: '排序',
  rarity: '星级降序',
  level: '等级降序',
  potential: '潜能降序',
}
const depotTypeLabelMap: Record<string, string> = {
  NONE: '资源/凭证',
  NORMAL: '基础资源',
  MEMENTO: '活动纪念品',
  MATERIAL: '材料',
  CARD_EXP: '经验书',
  ACTIVITY_ITEM: '活动道具',
  CONSUME: '消耗品',
  CHARM: '养成凭证',
  DIAMOND: '源石/至纯源石',
  EXP_ITEM: '经验材料',
  FURN: '家具',
  FURN_PART: '家具零件',
  HGG_SHD: '黄票/凭证',
  LGG_SHD: '绿票/凭证',
  RECRUIT_TAG: '公招相关',
  TKT: '票券',
}

function getDepotTypeLabel(classifyType?: string) {
  if (!classifyType) return '未分类'
  return depotTypeLabelMap[classifyType] || '其他'
}

function FilterMenu({
  menuKey,
  label,
  value,
  options,
  isActive,
  isOpen,
  mobileAlign = 'start',
  menuWidth = 128,
  onOpenChange,
  onSelect,
}: FilterMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [menuPosition, setMenuPosition] = useState<FilterMenuPosition | null>(null)
  const menuId = `data-filter-${menuKey}-${useId().replace(/:/g, '')}`

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return

    const rect = trigger.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const margin = Math.min(16, viewportWidth / 2)
    const gap = 6
    const width = Math.min(menuWidth, Math.max(0, viewportWidth - margin * 2))
    const alignEnd = mobileAlign === 'end' && viewportWidth < 640
    const preferredLeft = alignEnd ? rect.right - width : rect.left
    const left = Math.min(
      Math.max(preferredLeft, margin),
      Math.max(margin, viewportWidth - margin - width),
    )
    const naturalHeight = Math.min(
      options.length * 44 + Math.max(0, options.length - 1) * 4 + 8,
      360,
    )
    const spaceBelow = Math.max(0, viewportHeight - rect.bottom - gap - margin)
    const spaceAbove = Math.max(0, rect.top - gap - margin)
    const placement = spaceBelow < Math.min(naturalHeight, 176) && spaceAbove > spaceBelow
      ? 'top'
      : 'bottom'
    const availableHeight = placement === 'top' ? spaceAbove : spaceBelow

    setMenuPosition({
      top: placement === 'top' ? rect.top - gap : rect.bottom + gap,
      left,
      width,
      maxHeight: Math.min(naturalHeight, availableHeight),
      placement,
    })
  }, [menuWidth, mobileAlign, options.length])

  const restoreTriggerFocus = useCallback(() => {
    window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }))
  }, [])

  const closeMenu = useCallback((restoreFocus = false) => {
    onOpenChange(null)
    if (restoreFocus) restoreTriggerFocus()
  }, [onOpenChange, restoreTriggerFocus])

  useEffect(() => {
    if (!isOpen) return

    const focusFrame = window.requestAnimationFrame(() => {
      const selectedOption = menuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')
      const firstOption = menuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')
      ;(selectedOption ?? firstOption)?.focus({ preventScroll: true })
    })

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!containerRef.current?.contains(target) && !menuRef.current?.contains(target)) closeMenu()
    }
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as Node
      if (!containerRef.current?.contains(target) && !menuRef.current?.contains(target)) closeMenu()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeMenu(true)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [closeMenu, isOpen, updateMenuPosition])

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const menuItems = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [],
    )
    if (menuItems.length === 0) return

    event.preventDefault()
    const activeIndex = menuItems.indexOf(document.activeElement as HTMLButtonElement)
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? menuItems.length - 1
        : event.key === 'ArrowUp'
          ? (activeIndex <= 0 ? menuItems.length - 1 : activeIndex - 1)
          : (activeIndex + 1) % menuItems.length
    menuItems[nextIndex]?.focus({ preventScroll: true })
  }

  return (
    <div
      ref={containerRef}
      className="filter-menu-container relative w-[calc(33.333%_-_0.5rem)] sm:w-auto"
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (isOpen) {
            closeMenu()
          } else {
            updateMenuPosition()
            onOpenChange(menuKey)
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          updateMenuPosition()
          onOpenChange(menuKey)
        }}
        className={filterButtonClass(isActive, isOpen)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={menuId}
      >
        <span className="truncate">{label}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 flex-none transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {isOpen && menuPosition && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={`${label}筛选`}
          data-placement={menuPosition.placement}
          className={menuSurfaceClass}
          style={{
            top: menuPosition.top,
            left: menuPosition.left,
            width: menuPosition.width,
            maxHeight: menuPosition.maxHeight,
            transform: menuPosition.placement === 'top' ? 'translateY(-100%)' : undefined,
            transformOrigin: menuPosition.placement === 'top' ? 'bottom' : 'top',
          }}
          onKeyDown={handleMenuKeyDown}
        >
          <GlassCard
            className="app-glass-panel data-statistics-menu-card flex max-h-full min-h-0 flex-col overflow-hidden"
            padding="4px"
            radius="var(--app-radius-lg)"
          >
            <div className="data-statistics-menu-scroll">
              {options.map(option => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={value === option.value}
                  onClick={() => {
                    onSelect(option.value)
                    closeMenu(true)
                  }}
                  className={menuOptionClass(value === option.value)}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                </button>
              ))}
            </div>
          </GlassCard>
        </div>,
        document.body,
      )}
    </div>
  )
}

function InlineDataError({ title, description, isRetrying, onRetry }: InlineDataErrorProps) {
  return (
    <div
      className="form-error-surface flex flex-col items-start gap-3 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between"
      role="alert"
    >
      <div className="min-w-0">
        <p className="font-semibold text-primary">{title}</p>
        <p className="mt-1 break-words text-sm leading-6 [overflow-wrap:anywhere] form-error-text">{description}</p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        loading={isRetrying}
        loadingText="正在重试..."
        onClick={onRetry}
        className="w-full sm:w-auto"
        icon={<Icons.RefreshCw className="h-4 w-4" />}
      >
        重新加载
      </Button>
    </div>
  )
}

const OperatorCard = memo(function OperatorCard({
  oper,
  owned,
}: {
  oper: OperatorDetailed
  owned: boolean
}) {
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)

  return (
    <div
      className={`data-statistics-operator-item relative min-w-0 ${
        owned
          ? ''
          : 'opacity-70 grayscale-[0.15]'
      }`}
    >
      {!owned && (
        <div className="absolute left-2 top-2 z-10 rounded-full bg-[var(--app-surface-solid)] px-2 py-0.5 text-xs font-semibold text-secondary">
          未拥有
        </div>
      )}

      <div className="relative mb-2 aspect-square w-full overflow-hidden rounded-xl bg-[var(--app-surface-muted)]">
        {oper.id ? (
          <>
            {!imageLoaded && (
              <div className="absolute inset-0 animate-pulse bg-[var(--app-surface-muted)]"></div>
            )}
            <img
              src={getOperatorAvatarUrl(oper.id)}
              alt={oper.name}
              loading="lazy"
              decoding="async"
              className={`h-full w-full object-cover transition-opacity duration-300 ${
                imageLoaded ? 'opacity-100' : 'opacity-0'
              }`}
              style={imageFailed ? { display: 'none' } : undefined}
              onLoad={() => setImageLoaded(true)}
              onError={() => {
                setImageFailed(true)
                setImageLoaded(true)
              }}
            />
            {!owned && imageLoaded && (
              <div className="absolute inset-0 bg-[color-mix(in_srgb,var(--app-bg)_62%,transparent)]"></div>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-secondary">
            无头像
          </div>
        )}
        {oper.rarity !== undefined && oper.rarity > 0 && (
          <div className="brand-chip absolute right-1.5 top-1.5 rounded-full px-2 py-0.5 text-xs font-semibold">
            {Math.min(oper.rarity, 6)}★
          </div>
        )}
      </div>

      <div className="text-center space-y-2">
        <div className="text-sm font-bold text-primary truncate" title={oper.name}>
          {oper.name || '未知干员'}
        </div>
        {owned && (
          <>
            <div className="flex flex-wrap items-center justify-center gap-1 text-xs">
              {oper.elite !== undefined && (
                <span className={chipClass}>
                  精{oper.elite}
                </span>
              )}
              {oper.level !== undefined && (
                <span className={chipClass}>
                  Lv.{oper.level}
                </span>
              )}
            </div>
            {oper.potential !== undefined && (
              <div className="text-xs text-secondary">
                潜能 {oper.potential}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
})

const STATISTICS_TABS: readonly ActiveTab[] = ['operbox', 'depot', 'drops']
const STATISTICS_TAB_PARAM = 'tab'

function readStatisticsTabFromUrl(): ActiveTab {
  if (typeof window === 'undefined') return 'operbox'
  const value = new URLSearchParams(window.location.search).get(STATISTICS_TAB_PARAM)
  return STATISTICS_TABS.find(tab => tab === value) ?? 'operbox'
}

function writeStatisticsTabToUrl(tab: ActiveTab): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (tab === 'operbox') url.searchParams.delete(STATISTICS_TAB_PARAM)
  else url.searchParams.set(STATISTICS_TAB_PARAM, tab)
  window.history.replaceState(window.history.state, '', url)
}

export default function DataStatistics() {
  useItemIconCacheVersion()
  const [isRunning, setIsRunning] = useState(false)
  const [activeTask, setActiveTask] = useState<ActiveTask>(null)
  const { setMessage: setStatusMessage } = useStatusStore()
  const [depotData, setDepotData] = useState<DepotDataDetailed | null>(null)
  const [operBoxData, setOperBoxData] = useState<OperBoxData | null>(null)
  const [allOperators, setAllOperators] = useState<OperatorDetailed[]>([])
  const [depotDataLoading, setDepotDataLoading] = useState(true)
  const [operBoxDataLoading, setOperBoxDataLoading] = useState(true)
  const [operatorCatalogLoading, setOperatorCatalogLoading] = useState(true)
  const [depotDataError, setDepotDataError] = useState<string | null>(null)
  const [operBoxDataError, setOperBoxDataError] = useState<string | null>(null)
  const [operatorCatalogError, setOperatorCatalogError] = useState<string | null>(null)
  const depotRequestIdRef = useRef(0)
  const operBoxRequestIdRef = useRef(0)
  const operatorCatalogRequestIdRef = useRef(0)
  const [failedDepotImages, setFailedDepotImages] = useState<Record<string, boolean>>({})
  
  // 筛选和排序状态
  const [filterRarity, setFilterRarity] = useState<FilterRarity>('all')
  const [filterElite, setFilterElite] = useState<FilterElite>('all')
  const [filterPotential, setFilterPotential] = useState<FilterPotential>('all')
  const [filterOwnership, setFilterOwnership] = useState<FilterOwnership>('all')
  const [filterProfession, setFilterProfession] = useState<FilterProfession>('all')
  const [sortBy, setSortBy] = useState<SortBy>('default')
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => readStatisticsTabFromUrl())
  const requestedStatisticsTab = useUIStore(state => state.statisticsTab)
  const setRequestedStatisticsTab = useUIStore(state => state.setStatisticsTab)
  const shouldReduceMotion = useReducedMotion()
  const statisticsTabsRef = useRef<HTMLDivElement>(null)

  const selectStatisticsTab = useCallback((tab: ActiveTab) => {
    setActiveTab(tab)
    writeStatisticsTabToUrl(tab)
  }, [])

  useEffect(() => {
    if (!requestedStatisticsTab) return
    selectStatisticsTab(requestedStatisticsTab)
    setRequestedStatisticsTab(null)
  }, [requestedStatisticsTab, selectStatisticsTab, setRequestedStatisticsTab])

  useEffect(() => {
    const buttons = statisticsTabsRef.current?.querySelectorAll<HTMLButtonElement>(
      '.lg-track:not([data-lg-copy]) > [data-lg-item]',
    )
    buttons?.forEach((button, index) => {
      const tab = statisticsTabs[index]
      if (!tab) return
      button.id = `data-statistics-tab-${tab.id}`
      button.setAttribute('aria-controls', `data-statistics-panel-${tab.id}`)
    })
  }, [])

  const depotTypeSummary = useMemo(() => {
    const grouped = new Map<string, { count: number; kinds: number }>()
    for (const item of depotData?.items || []) {
      const key = item.classifyType || 'UNKNOWN'
      const prev = grouped.get(key) || { count: 0, kinds: 0 }
      grouped.set(key, { count: prev.count + item.count, kinds: prev.kinds + 1 })
    }
    return Array.from(grouped.entries())
      .map(([type, value]) => ({ type, ...value, label: getDepotTypeLabel(type) }))
      .sort((a, b) => b.count - a.count)
  }, [depotData])

  const depotOverview = useMemo(() => {
    let materialKinds = 0
    let totalCount = 0
    let topItem: DepotDataDetailed['items'][number] | null = null

    for (const item of depotData?.items || []) {
      if (item.classifyType === 'MATERIAL') materialKinds += 1
      totalCount += item.count
      if (!topItem || item.count > topItem.count) topItem = item
    }

    return {
      materialKinds,
      totalCount,
      topItemName: topItem?.name || '-',
    }
  }, [depotData])

  // 掉落记录相关状态
  const [dropStatistics, setDropStatistics] = useState<DropRecordsProps['dropStatistics']>(null)
  const [dropDays, setDropDays] = useState(7)
  const [dropDataLoading, setDropDataLoading] = useState(true)
  const [dropDataError, setDropDataError] = useState<string | null>(null)
  const dropRequestIdRef = useRef(0)

  const loadDepotData = useCallback(async () => {
    const requestId = ++depotRequestIdRef.current
    setDepotDataLoading(true)
    setDepotDataError(null)
    try {
      const depotResult = await maaApi.getDepotData()
      if (requestId !== depotRequestIdRef.current) return
      if (!depotResult.success) {
        setDepotDataError('暂时无法读取仓库数据，请检查服务连接后重试。')
        return
      }

      if (depotResult.data) {
        setDepotData({
          itemCount: depotResult.data.itemCount,
          items: depotResult.data.items || [],
          timestamp: depotResult.data.timestamp,
          complete: depotResult.data.complete
        })
      } else {
        setDepotData(null)
      }
    } catch {
      if (requestId !== depotRequestIdRef.current) return
      setDepotDataError('暂时无法读取仓库数据，请检查服务连接后重试。')
    } finally {
      if (requestId === depotRequestIdRef.current) setDepotDataLoading(false)
    }
  }, [])

  const loadOperBoxData = useCallback(async () => {
    const requestId = ++operBoxRequestIdRef.current
    setOperBoxDataLoading(true)
    setOperBoxDataError(null)
    try {
      const operBoxResult = await getOperBoxData()
      if (requestId !== operBoxRequestIdRef.current) return
      if (!operBoxResult.success) {
        setOperBoxDataError('暂时无法读取干员识别结果，请检查服务连接后重试。')
        return
      }

      if (operBoxResult.data) {
        setOperBoxData({
          operCount: operBoxResult.data.operCount,
          totalOperCount: operBoxResult.data.totalOperCount,
          data: operBoxResult.data.data || [],
          allOpers: operBoxResult.data.allOpers || [],
          timestamp: operBoxResult.data.timestamp
        })
      } else {
        setOperBoxData(null)
      }
    } catch {
      if (requestId !== operBoxRequestIdRef.current) return
      setOperBoxDataError('暂时无法读取干员识别结果，请检查服务连接后重试。')
    } finally {
      if (requestId === operBoxRequestIdRef.current) setOperBoxDataLoading(false)
    }
  }, [])

  const loadAllOperators = useCallback(async () => {
    const requestId = ++operatorCatalogRequestIdRef.current
    setOperatorCatalogLoading(true)
    setOperatorCatalogError(null)
    try {
      const result = await getAllOperators()
      if (requestId !== operatorCatalogRequestIdRef.current) return
      if (!result.success) {
        setOperatorCatalogError('暂时无法读取干员资料，请检查资源状态后重试。')
        return
      }

      setAllOperators(Array.isArray(result.data) ? result.data : [])
    } catch {
      if (requestId !== operatorCatalogRequestIdRef.current) return
      setOperatorCatalogError('暂时无法读取干员资料，请检查资源状态后重试。')
    } finally {
      if (requestId === operatorCatalogRequestIdRef.current) setOperatorCatalogLoading(false)
    }
  }, [])

  const loadOperatorData = useCallback(async () => {
    await Promise.all([loadOperBoxData(), loadAllOperators()])
  }, [loadAllOperators, loadOperBoxData])

  // 加载掉落数据
  const loadDropData = useCallback(async () => {
    const requestId = ++dropRequestIdRef.current
    setDropDataLoading(true)
    setDropDataError(null)
    try {
      const statsResult = await getDropStatistics(dropDays)
      if (requestId !== dropRequestIdRef.current) return
      if (!statsResult.success) {
        setDropDataError('暂时无法读取掉落记录，请检查服务连接后重试。')
        return
      }

      setDropStatistics(statsResult.data || null)
    } catch {
      if (requestId !== dropRequestIdRef.current) return
      setDropDataError('暂时无法读取掉落记录，请检查服务连接后重试。')
    } finally {
      if (requestId === dropRequestIdRef.current) setDropDataLoading(false)
    }
  }, [dropDays])

  // 首次读取各区域数据；每个区域独立反馈，不让单个接口拖住整页。
  useEffect(() => {
    void loadDepotData()
    void loadOperatorData()
    return () => {
      depotRequestIdRef.current += 1
      operBoxRequestIdRef.current += 1
      operatorCatalogRequestIdRef.current += 1
    }
  }, [loadDepotData, loadOperatorData])
  
  // 当统计天数变化时重新加载
  useEffect(() => {
    void loadDropData()
    return () => {
      dropRequestIdRef.current += 1
    }
  }, [loadDropData])

  const operatorDataLoading = operBoxDataLoading || operatorCatalogLoading
  const operatorDataError = operBoxDataError
    || (operBoxData?.allOpers?.length ? null : operatorCatalogError)

  // 筛选和排序干员数据
  const getFilteredAndSortedOperators = useMemo(() => {
    let dataSource: OperatorDetailed[] = []
    
    const allOperatorsMap = new Map((allOperators || []).map(op => [op.id, op]))
    const ownedIds = new Set((operBoxData?.data || []).map(op => op.id))
    for (const oper of operBoxData?.allOpers || []) {
      if (oper.own) ownedIds.add(oper.id)
    }
    const catalogOperators: OperatorDetailed[] = operBoxData?.allOpers?.length
      ? operBoxData.allOpers.map(op => {
        const fullInfo = allOperatorsMap.get(op.id)
        return {
          id: op.id,
          name: op.name,
          rarity: op.rarity,
          profession: fullInfo?.profession || '',
          position: fullInfo?.position,
          level: 0,
          elite: 0,
          potential: 0,
        }
      })
      : allOperators
    
    // 特殊处理：阿米娅的三个形态
    const amiyaIds = ['char_002_amiya', 'char_1001_amiya2', 'char_1037_amiya3']
    const hasAnyAmiya = amiyaIds.some(id => ownedIds.has(id))
    if (hasAnyAmiya) {
      amiyaIds.forEach(id => ownedIds.add(id))
    }
    
    if (filterOwnership === 'unowned') {
      if (!catalogOperators || catalogOperators.length === 0) {
        return []
      }
      
      dataSource = catalogOperators
        .filter(op => !ownedIds.has(op.id))
        .map(op => ({
          ...op,
          level: 0,
          elite: 0,
          potential: 0
        }))
    } else if (filterOwnership === 'owned') {
      if (!operBoxData || !operBoxData.data) return []
      
      const ownedOperators: OperatorDetailed[] = operBoxData.data.map(owned => {
        const fullInfo = allOperatorsMap.get(owned.id)
        return {
          ...owned,
          profession: fullInfo?.profession || owned.profession,
          position: fullInfo?.position || owned.position
        }
      })
      
      if (hasAnyAmiya) {
        const ownedOperatorIds = new Set(ownedOperators.map(op => op.id))
        amiyaIds.forEach(amiyaId => {
          if (!ownedOperatorIds.has(amiyaId)) {
            const amiyaInfo = allOperatorsMap.get(amiyaId)
            if (amiyaInfo) {
              const ownedAmiya = ownedOperators.find(op => amiyaIds.includes(op.id))
              ownedOperators.push({
                ...amiyaInfo,
                level: ownedAmiya?.level || 1,
                elite: ownedAmiya?.elite || 0,
                potential: ownedAmiya?.potential || 1,
                position: amiyaInfo.position
              } as OperatorDetailed)
            }
          }
        })
      }
      
      dataSource = ownedOperators
    } else {
      if (!catalogOperators || catalogOperators.length === 0) return []
      
      const ownedMap = new Map((operBoxData?.data || []).map(op => [op.id, op]))
      
      let ownedAmiyaData: OperatorDetailed | undefined = undefined
      if (hasAnyAmiya) {
        ownedAmiyaData = amiyaIds.map(id => ownedMap.get(id)).find(data => data)
      }
      
      dataSource = catalogOperators.map(op => {
        const owned = ownedMap.get(op.id)
        if (owned) {
          return {
            ...op,
            ...owned,
          }
        } else if (hasAnyAmiya && amiyaIds.includes(op.id)) {
          return {
            ...op,
            level: ownedAmiyaData?.level || 1,
            elite: ownedAmiyaData?.elite || 0,
            potential: ownedAmiyaData?.potential || 1
          }
        } else {
          return {
            ...op,
            level: 0,
            elite: 0,
            potential: 0
          }
        }
      })
    }
    
    let filtered = dataSource
    
    if (filterRarity !== 'all') {
      const rarity = parseInt(filterRarity)
      filtered = filtered.filter(oper => Math.min(oper.rarity || 0, 6) === rarity)
    }
    
    if (filterProfession !== 'all') {
      filtered = filtered.filter(oper => oper.profession === filterProfession)
    }
    
    if (filterElite !== 'all' && filterOwnership !== 'unowned') {
      const elite = parseInt(filterElite)
      filtered = filtered.filter(oper => (oper.elite || 0) === elite)
    }
    
    if (filterPotential !== 'all' && filterOwnership !== 'unowned') {
      const potential = parseInt(filterPotential)
      filtered = filtered.filter(oper => (oper.potential || 1) === potential)
    }
    
    if (filterOwnership === 'owned') {
      if (sortBy === 'level') {
        filtered.sort((a, b) => (b.level || 0) - (a.level || 0))
      } else if (sortBy === 'rarity') {
        filtered.sort((a, b) => {
          const rarityA = Math.min(a.rarity || 0, 6)
          const rarityB = Math.min(b.rarity || 0, 6)
          return rarityB - rarityA
        })
      } else if (sortBy === 'potential') {
        filtered.sort((a, b) => (b.potential || 1) - (a.potential || 1))
      }
    } else {
      filtered.sort((a, b) => {
        const rarityA = Math.min(a.rarity || 0, 6)
        const rarityB = Math.min(b.rarity || 0, 6)
        if (rarityB !== rarityA) {
          return rarityB - rarityA
        }
        return a.name.localeCompare(b.name, 'zh-CN')
      })
    }
    
    return filtered
  }, [filterOwnership, filterRarity, filterProfession, filterElite, filterPotential, sortBy, allOperators, operBoxData])

  const ownedOperatorIds = useMemo(() => {
    const ids = new Set((operBoxData?.data || []).map(operator => operator.id))
    for (const oper of operBoxData?.allOpers || []) {
      if (oper.own) ids.add(oper.id)
    }
    const amiyaIds = ['char_002_amiya', 'char_1001_amiya2', 'char_1037_amiya3']
    if (amiyaIds.some(id => ids.has(id))) {
      amiyaIds.forEach(id => ids.add(id))
    }
    return ids
  }, [operBoxData])
  const ownedOperatorCount = ownedOperatorIds.size
  const operatorCatalogCount = Math.max(
    allOperators.length,
    operBoxData?.totalOperCount || 0,
    operBoxData?.allOpers?.length || 0,
    ownedOperatorCount,
  )
  const operatorCoverage = operatorCatalogCount > 0
    ? Math.round((ownedOperatorCount / operatorCatalogCount) * 100)
    : 0
  const hasOperatorCatalog = operatorCatalogCount > 0

  // 执行仓库识别
  const executeDepot = async () => {
    if (isRunning) return

    setIsRunning(true)
    setActiveTask('depot')
    setStatusMessage('正在识别仓库物品...')
    setDepotDataError(null)

    try {
      // 使用动态任务配置
      const taskConfig = {
        name: '仓库识别',
        type: 'Depot',
        params: {
          enable: true
        }
      }
      
      const result = await maaApi.executeCommand('depot', [], taskConfig, null, '仓库识别', 'statistics', true)

      if (result.success) {
        setStatusMessage('识别完成，正在解析数据...')
        
        // 解析并保存数据
        const parseResult = await maaApi.parseDepotData()
        
        if (parseResult.success) {
          const parsedDepotData = parseResult.data!
          setDepotDataError(null)
          setDepotData({
            itemCount: parsedDepotData.itemCount,
            items: parsedDepotData.items || [],
            path: parsedDepotData.path,
            timestamp: new Date().toISOString(),
            complete: parsedDepotData.complete
          })

          try {
            setStatusMessage('正在更新智能养成系统...')
            const queueResult = await getTrainingQueue()

            if (queueResult.success && Array.isArray(queueResult.data) && queueResult.data.length > 0) {
              setStatusMessage(keepNumberWithUnit(`识别完成！共识别 ${parsedDepotData.itemCount} 种物品，已更新养成进度`))
            } else {
              setStatusMessage(keepNumberWithUnit(`识别完成！共识别 ${parsedDepotData.itemCount} 种物品`))
            }
          } catch (error) {
            setStatusMessage(keepNumberWithUnit(`识别完成！共识别 ${parsedDepotData.itemCount} 种物品`))
          }
        } else {
          setStatusMessage(`识别完成，但数据解析失败: ${maaApi.getErrorMessage(parseResult)}`)
        }
      } else {
        setStatusMessage(`识别失败: ${maaApi.getErrorMessage(result)}`)
      }
    } catch (error) {
      setStatusMessage(`识别失败: ${getErrorMessage(error)}`)
    } finally {
      setIsRunning(false)
      setActiveTask(null)
    }
  }

  // 获取干员材料数据
  const handleFetchMaterials = async () => {
    if (isRunning) return

    setIsRunning(true)
    setStatusMessage('正在获取干员材料数据...')

    try {
      const result = await fetchOperatorMaterials()

      if (result.success) {
        setStatusMessage('干员材料数据获取成功！')

        // 重新加载干员列表以显示材料数据
        await loadAllOperators()
      } else {
        setStatusMessage(`获取失败: ${maaApi.getErrorMessage(result)}`)
      }
    } catch (error) {
      setStatusMessage(`获取失败: ${getErrorMessage(error)}`)
    } finally {
      setIsRunning(false)
    }
  }

  // 执行干员识别
  const executeOperBox = async () => {
    if (isRunning) return

    setIsRunning(true)
    setActiveTask('operbox')
    setStatusMessage('正在识别干员数据...')
    setOperBoxDataError(null)

    try {
      // 使用动态任务配置
      const taskConfig = {
        name: '干员识别',
        type: 'OperBox',
        params: {
          enable: true
        }
      }
      
      const result = await maaApi.executeCommand('operbox', [], taskConfig, null, '干员识别', 'statistics', true)

      if (result.success) {
        setStatusMessage('识别完成，正在解析数据...')

        // 解析并保存数据
        const parseResult = await maaApi.parseOperBoxData()

        if (parseResult.success) {
          const parsedOperBoxData = parseResult.data!
          setOperBoxDataError(null)
          const totalOperCount = parsedOperBoxData.totalOperCount || parsedOperBoxData.allOpers?.length
          setStatusMessage(totalOperCount
            ? keepNumberWithUnit(`识别完成！已拥有 ${parsedOperBoxData.operCount} / ${totalOperCount} 名干员`)
            : keepNumberWithUnit(`识别完成！共识别 ${parsedOperBoxData.operCount} 名干员`))
          setOperBoxData({
            operCount: parsedOperBoxData.operCount,
            totalOperCount,
            data: parsedOperBoxData.data || [],
            allOpers: parsedOperBoxData.allOpers || [],
            path: parsedOperBoxData.path,
            timestamp: new Date().toISOString()
          })
        } else {
          setStatusMessage(`识别完成，但数据解析失败: ${maaApi.getErrorMessage(parseResult)}`)
        }
      } else {
        setStatusMessage(`识别失败: ${maaApi.getErrorMessage(result)}`)
      }
    } catch (error) {
      setStatusMessage(`识别失败: ${getErrorMessage(error)}`)
    } finally {
      setIsRunning(false)
      setActiveTask(null)
    }
  }

  const hasActiveOperatorFilters = filterRarity !== 'all'
    || filterElite !== 'all'
    || filterPotential !== 'all'
    || filterOwnership !== 'all'
    || filterProfession !== 'all'
    || sortBy !== 'default'

  const resetOperatorFilters = () => {
    setFilterRarity('all')
    setFilterElite('all')
    setFilterPotential('all')
    setFilterOwnership('all')
    setFilterProfession('all')
    setSortBy('default')
  }

  return (
    <div className="app-page ios-workspace-page ios-borderless-cards data-statistics-page">
      <div className="app-stack-section">
        {/* 页面标题 */}
        <PageHeader
          title="数据"
          subtitle="识别并查看仓库、干员与掉落数据"
          mobileLayout="inline"
          actions={(
            <div className="data-statistics-status min-w-0 max-w-full">
              <FloatingStatusIndicator
                className="max-w-full"
                textClassName="truncate whitespace-nowrap"
              />
            </div>
          )}
        />

        <div className="data-statistics-view-switcher data-statistics-mode-shell" ref={statisticsTabsRef}>
          <GlassSegmented
            options={statisticsTabs.map(tab => {
              const TabIcon = tab.id === 'operbox' ? Users : tab.id === 'depot' ? PackageIcon : TrendingUp
              return {
                label: tab.title,
                icon: <TabIcon className="h-4 w-4" aria-hidden="true" />,
              }
            })}
            value={Math.max(0, statisticsTabs.findIndex(tab => tab.id === activeTab))}
            onChange={(index) => {
              const tab = statisticsTabs[index]
              if (tab) selectStatisticsTab(tab.id)
            }}
            aria-label="数据统计视图"
            className="data-statistics-segmented"
          />
        </div>

        <div>
          {/* 功能卡片 */}
          <div className="min-w-0 app-stack-section">
          {/* 干员识别 */}
          {activeTab === 'operbox' && (
          <motion.div
            id="data-statistics-panel-operbox"
            role="tabpanel"
            aria-labelledby="data-statistics-tab-operbox"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 38, mass: 0.72 }}
            className="min-w-0"
          >
            <Card
              smoothCorners
              className={taskPanelClass(activeTask === 'operbox' && isRunning)}
            >
              <div className="data-statistics-task-content app-stack-card">
            <div className="data-statistics-task-header flex items-start gap-3 sm:items-center">
              <div className="flex w-full min-w-0 flex-1 items-center gap-3 sm:w-auto">
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-[var(--app-radius-md)] surface-soft text-secondary" aria-hidden="true">
                  <Users size={20} strokeWidth={1.9} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-primary"><CjkText>干员识别</CjkText></h2>
                  <p className="mt-1 text-sm leading-relaxed text-secondary">
                    读取档案、等级、精英化与潜能数据
                  </p>
                </div>
              </div>

              <div className="data-statistics-task-actions flex flex-shrink-0 items-center gap-2">
                <Button
                  onClick={handleFetchMaterials}
                  disabled={isRunning}
                  loading={isRunning && activeTask === null}
                  loadingText="正在获取"
                  variant="outline"
                  size="md"
                  icon={<Download size={16} aria-hidden="true" />}
                >
                  获取材料数据
                </Button>
                <Button
                  onClick={executeOperBox}
                  disabled={isRunning}
                  loading={activeTask === 'operbox' && isRunning}
                  loadingText="正在执行"
                  variant="primary"
                  size="md"
                  icon={<Play size={15} fill="currentColor" aria-hidden="true" />}
                >
                  立即执行
                </Button>
              </div>
            </div>

            {/* 识别结果展示 */}
            {!operatorDataError && !operBoxData && (operatorDataLoading || (activeTask === 'operbox' && isRunning)) && (
              <div className="py-12" aria-live="polite">
                <Loading text={activeTask === 'operbox' && isRunning ? '正在识别干员数据' : '正在读取干员数据'} />
              </div>
            )}
            {operatorDataError && (
              <InlineDataError
                title="干员数据读取失败"
                description={operatorDataError}
                isRetrying={operatorDataLoading}
                onRetry={() => { void loadOperatorData() }}
              />
            )}
            {!operatorDataLoading && !operatorDataError && !isRunning && (!operBoxData?.data || operBoxData.data.length === 0) && (
              <EmptyState
                compact
                className="py-10"
                icon={<Users className="h-7 w-7" strokeWidth={1.6} aria-hidden="true" />}
                title="还没有干员识别结果"
                description="完成一次干员识别后，清单会显示在这里。"
              />
            )}
            {operBoxData && operBoxData.data && operBoxData.data.length > 0 && (
              <div className="app-stack-card">
                <StatisticsSummary
                  ariaLabel="干员数据概览"
                  primary={{
                    label: '收集率',
                    value: hasOperatorCatalog ? operatorCoverage : '—',
                    unit: hasOperatorCatalog ? '%' : undefined,
                    detail: hasOperatorCatalog
                      ? keepNumberWithUnit(`${ownedOperatorCount} / ${operatorCatalogCount} 已收录`)
                      : '档案总数暂不可用',
                    meter: hasOperatorCatalog ? operatorCoverage : undefined,
                    meterLabel: '干员收集率',
                    meterText: hasOperatorCatalog
                      ? `${operatorCoverage}%，已拥有 ${ownedOperatorCount} 位，共 ${operatorCatalogCount} 位`
                      : undefined,
                  }}
                  stats={[
                    { label: '已拥有', value: ownedOperatorCount, unit: '位' },
                    { label: '全干员', value: operatorCatalogCount, unit: '位' },
                  ]}
                  meta={operBoxData.timestamp
                    ? [{ label: '更新于', value: formatTimestamp(operBoxData.timestamp) }]
                    : undefined}
                />

                <section className="data-statistics-filter-section" aria-labelledby="operator-filter-title">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 id="operator-filter-title" className="min-w-0 text-sm font-semibold text-primary"><CjkText>筛选与排序</CjkText></h3>
                    <p className="shrink-0 text-xs text-secondary" aria-live="polite">
                      显示 <span className="font-semibold text-primary">{getFilteredAndSortedOperators.length}</span>{'\u00A0'}项
                    </p>
                  </div>

                  <div className="flex w-full flex-wrap items-center gap-2">
                    {/* 拥有状态 */}
                    <FilterMenu
                      menuKey="ownership"
                      label={ownershipLabels[filterOwnership]}
                      value={filterOwnership}
                      options={ownershipOptions}
                      isActive={filterOwnership !== 'all'}
                      isOpen={openMenu === 'ownership'}
                      menuWidth={88}
                      onOpenChange={setOpenMenu}
                      onSelect={value => setFilterOwnership(value as FilterOwnership)}
                    />

                    {/* 星级 */}
                    <FilterMenu
                      menuKey="rarity"
                      label={filterRarity === 'all' ? '星级' : `${filterRarity}星`}
                      value={filterRarity}
                      options={rarityOptions}
                      isActive={filterRarity !== 'all'}
                      isOpen={openMenu === 'rarity'}
                      menuWidth={72}
                      onOpenChange={setOpenMenu}
                      onSelect={value => setFilterRarity(value as FilterRarity)}
                    />

                    {/* 职业 */}
                    <FilterMenu
                      menuKey="profession"
                      label={professionLabels[filterProfession]}
                      value={filterProfession}
                      options={professionOptions}
                      isActive={filterProfession !== 'all'}
                      isOpen={openMenu === 'profession'}
                      menuWidth={72}
                      mobileAlign="end"
                      onOpenChange={setOpenMenu}
                      onSelect={value => setFilterProfession(value as FilterProfession)}
                    />

                    {/* 精英化 */}
                    <FilterMenu
                      menuKey="elite"
                      label={filterElite === 'all' ? '精英化' : `精英${filterElite}`}
                      value={filterElite}
                      options={eliteOptions}
                      isActive={filterElite !== 'all'}
                      isOpen={openMenu === 'elite'}
                      menuWidth={88}
                      onOpenChange={setOpenMenu}
                      onSelect={value => setFilterElite(value as FilterElite)}
                    />

                    {/* 潜能 */}
                    <FilterMenu
                      menuKey="potential"
                      label={filterPotential === 'all' ? '潜能' : `潜能${filterPotential}`}
                      value={filterPotential}
                      options={potentialOptions}
                      isActive={filterPotential !== 'all'}
                      isOpen={openMenu === 'potential'}
                      menuWidth={88}
                      onOpenChange={setOpenMenu}
                      onSelect={value => setFilterPotential(value as FilterPotential)}
                    />

                    {/* 排序 */}
                    <FilterMenu
                      menuKey="sort"
                      label={sortLabels[sortBy]}
                      value={sortBy}
                      options={sortOptions}
                      isActive={sortBy !== 'default'}
                      isOpen={openMenu === 'sort'}
                      menuWidth={100}
                      mobileAlign="end"
                      onOpenChange={setOpenMenu}
                      onSelect={value => setSortBy(value as SortBy)}
                    />

                    {/* 重置按钮 */}
                    {hasActiveOperatorFilters && (
                      <Button
                        onClick={resetOperatorFilters}
                        variant="ghost"
                        size="sm"
                        icon={<RotateCcw size={14} aria-hidden="true" />}
                        className="min-h-11 w-[calc(33.333%_-_0.5rem)] sm:w-auto"
                      >
                        重置
                      </Button>
                    )}
                  </div>
                </section>

                {/* 干员卡片网格 */}
                {getFilteredAndSortedOperators.length === 0 ? (
                  <EmptyState
                    compact
                    className="py-10"
                    icon={<Users className="h-7 w-7" strokeWidth={1.6} aria-hidden="true" />}
                    title="没有符合条件的干员"
                    description="调整筛选条件后再查看。"
                    action={hasActiveOperatorFilters ? (
                      <Button variant="secondary" size="sm" onClick={resetOperatorFilters}>
                        清除筛选
                      </Button>
                    ) : undefined}
                  />
                ) : (
                <div className="data-statistics-item-grid grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {getFilteredAndSortedOperators.map((oper) => (
                    <OperatorCard
                      key={oper.id}
                      oper={oper}
                      owned={oper.level > 0 || ownedOperatorIds.has(oper.id)}
                    />
                  ))}
                </div>
                )}
                  </div>
                )}
              </div>
            </Card>
          </motion.div>
          )}

          {/* 仓库识别 */}
          {activeTab === 'depot' && (
          <motion.div
            id="data-statistics-panel-depot"
            role="tabpanel"
            aria-labelledby="data-statistics-tab-depot"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 38, mass: 0.72 }}
            className="min-w-0"
          >
            <Card
              smoothCorners
              className={taskPanelClass(activeTask === 'depot' && isRunning)}
            >
              <div className="data-statistics-task-content app-stack-card">
            <div className="data-statistics-task-header flex items-start gap-3 sm:items-center">
              <div className="flex w-full min-w-0 flex-1 items-center gap-3 sm:w-auto">
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-[var(--app-radius-md)] surface-soft text-secondary" aria-hidden="true">
                  <PackageIcon size={20} strokeWidth={1.9} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-primary"><CjkText>仓库识别</CjkText></h2>
                  <p className="mt-1 text-sm leading-relaxed text-secondary">
                    汇总物品库存、材料分类与数量
                  </p>
                </div>
              </div>

              <div className="data-statistics-task-actions flex-shrink-0">
                <Button
                  onClick={executeDepot}
                  disabled={isRunning}
                  loading={activeTask === 'depot' && isRunning}
                  loadingText="正在执行"
                  variant="primary"
                  size="md"
                  icon={<Play size={15} fill="currentColor" aria-hidden="true" />}
                >
                  立即执行
                </Button>
              </div>
            </div>

            {/* 识别结果展示 */}
            {!depotDataError && !depotData && (depotDataLoading || (activeTask === 'depot' && isRunning)) && (
              <div className="py-12" aria-live="polite">
                <Loading text={activeTask === 'depot' && isRunning ? '正在识别仓库数据' : '正在读取仓库数据'} />
              </div>
            )}
            {depotDataError && (
              <InlineDataError
                title="仓库数据读取失败"
                description={depotDataError}
                isRetrying={depotDataLoading}
                onRetry={() => { void loadDepotData() }}
              />
            )}
            {!depotDataLoading && !depotDataError && !isRunning && !depotData && (
              <EmptyState
                compact
                className="py-10"
                icon={<PackageIcon className="h-7 w-7" strokeWidth={1.6} aria-hidden="true" />}
                title="还没有仓库识别结果"
                description="完成一次仓库识别后，物品清单会显示在这里。"
              />
            )}
            {depotData && (
              <div className="app-stack-card">
                {depotData.complete === false && (
                  <div
                    role="status"
                    className="status-warning flex min-h-11 items-center rounded-lg px-3 py-2 text-sm leading-6"
                  >
                    最近一次仓库识别没有完整结束，物品清单可能缺少部分内容。
                  </div>
                )}
                <StatisticsSummary
                  ariaLabel="仓库数据概览"
                  primary={{
                    label: '库存总量',
                    value: depotOverview.totalCount.toLocaleString(),
                    unit: '件',
                    detail: '含货币与经验道具',
                  }}
                  stats={[
                    { label: '物品种类', value: depotData.itemCount, unit: '种' },
                    { label: '材料种类', value: depotOverview.materialKinds, unit: '种' },
                  ]}
                  meta={[
                    { label: '库存最多', value: depotOverview.topItemName },
                    ...(depotData.timestamp
                      ? [{ label: '最近识别', value: formatTimestamp(depotData.timestamp) }]
                      : []),
                  ]}
                />

                {depotTypeSummary.length > 0 && (
                  <section className="data-statistics-category-section" aria-labelledby="depot-category-title">
                    <h3 id="depot-category-title" className="mb-2 flex min-w-0 flex-wrap items-baseline gap-2 text-sm font-semibold text-primary">
                      <span><CjkText>分类汇总</CjkText></span>
                      <span className="text-xs font-normal text-tertiary">{keepNumberWithUnit(`${depotTypeSummary.length} 类`)}</span>
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {depotTypeSummary.map((group) => (
                        <div
                          key={group.type}
                          className="flex min-w-0 items-baseline gap-2 rounded-full bg-[var(--app-surface-muted)] px-3 py-1.5 text-xs text-secondary"
                        >
                          <span className="font-medium text-primary">{group.label}</span>
                          <span className="tabular-nums">{keepNumberWithUnit(`${group.kinds} 种`)}</span>
                          <span className="text-tertiary" aria-hidden="true">·</span>
                          <span className="tabular-nums">{keepNumberWithUnit(`${group.count.toLocaleString()} 件`)}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* 物品卡片网格 */}
                {depotData.items && depotData.items.length > 0 && (
                  <div className="data-statistics-item-grid grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                    {depotData.items.map((item) => {
                      const itemKey = item.id || item.iconId
                      const imageKey = `${itemKey}:${item.iconId}`

                      return (
                        <div
                          key={itemKey}
                          className="data-statistics-depot-item flex min-w-0 items-center gap-3 p-3"
                        >
                          {/* 物品图标 */}
                          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--app-surface-muted)]">
                            {failedDepotImages[imageKey] ? (
                              <span role="img" aria-label={`${item.name}图标不可用`}>
                                <PackageIcon className="h-6 w-6 brand-text" aria-hidden="true" />
                              </span>
                            ) : (
                              <img
                                src={getItemIconUrl(item.iconId)}
                                alt={item.name}
                                loading="lazy"
                                decoding="async"
                                className="maa-item-icon w-full h-full object-cover"
                                onError={() => {
                                  setFailedDepotImages(previous => ({ ...previous, [imageKey]: true }))
                                }}
                              />
                            )}
                          </div>

                          {/* 物品信息 */}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-primary truncate" title={item.name}>
                              {item.name}
                            </div>
                            <div className="mt-1 flex min-w-0 items-baseline gap-2">
                              {item.classifyType && (
                                <span className="min-w-0 truncate text-xs text-tertiary">
                                  {getDepotTypeLabel(item.classifyType)}
                                </span>
                              )}
                              <span className="ml-auto shrink-0 text-xs font-medium tabular-nums text-secondary">
                                ×{item.count.toLocaleString()}
                              </span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
              </div>
            </Card>
          </motion.div>
          )}
          
          {/* 掉落记录 */}
          {activeTab === 'drops' && (
            <motion.div
              id="data-statistics-panel-drops"
              role="tabpanel"
              aria-labelledby="data-statistics-tab-drops"
              initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 38, mass: 0.72 }}
              className="min-w-0"
            >
              <DropRecords
                dropStatistics={dropStatistics}
                dropDays={dropDays}
                setDropDays={setDropDays}
                onRefresh={loadDropData}
                isLoading={dropDataLoading}
                error={dropDataError}
              />
            </motion.div>
          )}
          </div>

        </div>
      </div>
    </div>
  )
}
