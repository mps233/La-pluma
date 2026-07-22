import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { maaApi, getAllOperators, getDropStatistics, getItemIconUrl, getOperBoxData, fetchOperatorMaterials, getTrainingQueue } from '../services/api'
import { motion } from 'framer-motion'
import { Package as PackageIcon } from 'lucide-react'
import Icons from './Icons'
import DropRecords from './DropRecords'
import { PageHeader, Button, Card, EmptyState, Loading } from './common'
import { useStatusStore } from '../store/statusStore'
import FloatingStatusIndicator from './FloatingStatusIndicator'
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

const tabButtonClass = (isActive: boolean) =>
  `data-statistics-tab min-h-11${isActive ? ' is-active' : ''}`

const filterButtonClass = (isActive: boolean) =>
  `flex min-h-11 w-full items-center justify-center space-x-1 rounded-lg px-2 text-xs font-medium transition-all sm:w-auto sm:space-x-1.5 sm:px-3 ${
    isActive
      ? 'brand-action'
      : 'control-surface text-secondary'
  }`

const menuSurfaceClass = 'fixed z-[2000] overflow-y-auto overscroll-contain rounded-lg py-1 surface-panel'

const menuOptionClass = (isActive: boolean) =>
  `min-h-11 w-full px-3 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-accent)] ${
    isActive
      ? 'brand-chip font-medium'
      : 'text-secondary hover:bg-[var(--app-surface-muted)] hover:text-primary'
  }`

const taskPanelClass = (isActive: boolean) =>
  `data-statistics-task-card !p-0${isActive ? ' is-active' : ''}`

const statCardClass = 'data-statistics-kpi'
const chipClass = 'brand-chip rounded-full px-2 py-0.5 text-xs whitespace-nowrap'
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
    const naturalHeight = Math.min(options.length * 44 + 8, 320)
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
        className={filterButtonClass(isActive)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={menuId}
      >
        <span className="truncate">{label}</span>
        <svg className="h-3 w-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
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
              {option.label}
            </button>
          ))}
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

export default function DataStatistics() {
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
  const [activeTab, setActiveTab] = useState<ActiveTab>('operbox')
  const [loadedImages, setLoadedImages] = useState<Record<string, boolean>>({})
  
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
          timestamp: depotResult.data.timestamp
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
          data: operBoxResult.data.data || [],
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
  const operatorDataError = operBoxDataError || operatorCatalogError

  // 筛选和排序干员数据
  const getFilteredAndSortedOperators = useMemo(() => {
    let dataSource: OperatorDetailed[] = []
    
    const allOperatorsMap = new Map((allOperators || []).map(op => [op.id, op]))
    const ownedIds = new Set((operBoxData?.data || []).map(op => op.id))
    
    // 特殊处理：阿米娅的三个形态
    const amiyaIds = ['char_002_amiya', 'char_1001_amiya2', 'char_1037_amiya3']
    const hasAnyAmiya = amiyaIds.some(id => ownedIds.has(id))
    if (hasAnyAmiya) {
      amiyaIds.forEach(id => ownedIds.add(id))
    }
    
    if (filterOwnership === 'unowned') {
      if (!allOperators || allOperators.length === 0) {
        return []
      }
      
      dataSource = allOperators
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
      if (!allOperators || allOperators.length === 0) return []
      
      const ownedMap = new Map((operBoxData?.data || []).map(op => [op.id, op]))
      
      let ownedAmiyaData: OperatorDetailed | undefined = undefined
      if (hasAnyAmiya) {
        ownedAmiyaData = amiyaIds.map(id => ownedMap.get(id)).find(data => data)
      }
      
      dataSource = allOperators.map(op => {
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

  // 当筛选条件变化时，清理不再显示的干员图片加载状态
  useEffect(() => {
    const currentOperIds = new Set(getFilteredAndSortedOperators.map(op => op.id))
    
    setLoadedImages(prev => {
      const loadedIds = Object.keys(prev)
      
      if (loadedIds.length > 500) {
        const newLoadedImages: Record<string, boolean> = {}
        loadedIds.forEach(id => {
          if (currentOperIds.has(id) && prev[id]) {
            newLoadedImages[id] = prev[id]
          }
        })
        return newLoadedImages
      }
      
      return prev
    })
  }, [filterRarity, filterElite, filterPotential, filterOwnership, filterProfession, sortBy, getFilteredAndSortedOperators])

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
        
        // 等待一下让 MAA 写入日志
        await new Promise(resolve => setTimeout(resolve, 2000))
        
        // 解析并保存数据
        const parseResult = await maaApi.parseDepotData()
        
        if (parseResult.success) {
          setDepotDataError(null)
          setDepotData({
            itemCount: parseResult.data.itemCount,
            items: parseResult.data.items || [],
            path: parseResult.data.path,
            timestamp: new Date().toISOString()
          })
          
          try {
            setStatusMessage('正在更新智能养成系统...')
            const queueResult = await getTrainingQueue()

            if (queueResult.success && queueResult.data && queueResult.data.length > 0) {
              setStatusMessage(`识别完成！共识别 ${parseResult.data.itemCount} 种物品，已更新养成进度`)
            } else {
              setStatusMessage(`识别完成！共识别 ${parseResult.data.itemCount} 种物品`)
            }
          } catch (error) {
            setStatusMessage(`识别完成！共识别 ${parseResult.data.itemCount} 种物品`)
          }
        } else {
          setStatusMessage(`识别完成，但数据解析失败: ${maaApi.getErrorMessage(parseResult)}`)
        }
      } else {
        setStatusMessage(`识别失败: ${maaApi.getErrorMessage(result)}`)
      }
    } catch (error: any) {
      setStatusMessage(`识别失败: ${error.message}`)
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
    } catch (error: any) {
      setStatusMessage(`获取失败: ${error.message}`)
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
        
        // 等待一下让 MAA 写入日志
        await new Promise(resolve => setTimeout(resolve, 2000))

        // 解析并保存数据
        const parseResult = await maaApi.parseOperBoxData()

        if (parseResult.success) {
          setOperBoxDataError(null)
          setStatusMessage(`识别完成！共识别 ${parseResult.data.operCount} 名干员`)
          setOperBoxData({
            operCount: parseResult.data.operCount,
            data: parseResult.data.data || [],
            path: parseResult.data.path,
            timestamp: new Date().toISOString()
          })
        } else {
          setStatusMessage(`识别完成，但数据解析失败: ${maaApi.getErrorMessage(parseResult)}`)
        }
      } else {
        setStatusMessage(`识别失败: ${maaApi.getErrorMessage(result)}`)
      }
    } catch (error: any) {
      setStatusMessage(`识别失败: ${error.message}`)
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
    <div className="app-page ios-workspace-page data-statistics-page">
      <div className="app-stack-section">
        {/* 页面标题 */}
        <PageHeader
          title="数据统计"
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

        {/* 标签页切换 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="data-statistics-tabs"
          role="group"
          aria-label="数据统计视图"
        >
          <button
            type="button"
            onClick={() => setActiveTab('operbox')}
            className={tabButtonClass(activeTab === 'operbox')}
            aria-pressed={activeTab === 'operbox'}
          >
            <Icons.Users />
            <span>干员识别</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('depot')}
            className={tabButtonClass(activeTab === 'depot')}
            aria-pressed={activeTab === 'depot'}
          >
            <Icons.Package />
            <span>仓库识别</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('drops')}
            className={tabButtonClass(activeTab === 'drops')}
            aria-pressed={activeTab === 'drops'}
          >
            <Icons.TrendingUp />
            <span>掉落记录</span>
          </button>
        </motion.div>

        <div>
          {/* 功能卡片 */}
          <div className="min-w-0 app-stack-section">
          {/* 干员识别 */}
          {activeTab === 'operbox' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="min-w-0"
          >
            <Card
              smoothCorners
              className={taskPanelClass(activeTask === 'operbox' && isRunning)}
            >
              <div className="data-statistics-task-content">
            {/* 顶部行：图标 + 标题 + 执行按钮 */}
            <div className="data-statistics-task-header flex items-start gap-3 mb-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2 flex-wrap mb-2">
                  <span className="text-xl"><Icons.Users /></span>
                  <span className="font-bold text-primary text-base">干员识别</span>
                  <span className="brand-chip rounded-full px-2 py-0.5 text-xs">干员清单</span>
                </div>
                <p className="text-sm text-secondary leading-relaxed">
                  识别所有干员信息
                </p>
              </div>
              
              {/* 执行按钮 */}
              <div className="data-statistics-task-actions flex-shrink-0 flex items-center gap-2">
                <Button
                  onClick={handleFetchMaterials}
                  disabled={isRunning}
                  loading={isRunning && activeTask === null}
                  loadingText="正在获取..."
                  variant="outline"
                  size="sm"
                  icon={
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  }
                >
                  获取材料数据
                </Button>
                <Button
                  onClick={executeOperBox}
                  disabled={isRunning}
                  loading={activeTask === 'operbox' && isRunning}
                  loadingText="正在执行..."
                  variant="primary"
                  icon={
                    <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                    </svg>
                  }
                >
                  立即执行
                </Button>
              </div>
            </div>

            {/* 识别结果展示 */}
            {operatorDataLoading && !operatorDataError && !operBoxData && (
              <div className="py-10">
                <Loading text="正在读取干员数据..." />
              </div>
            )}
            {activeTask === 'operbox' && isRunning && !operBoxData && (
              <div className="py-10">
                <Loading text="正在识别干员数据..." />
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
                icon={<Icons.Users />}
                title="还没有干员识别结果"
                description="完成一次干员识别后，清单会显示在这里。"
              />
            )}
            {operBoxData && operBoxData.data && operBoxData.data.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-3"
              >
                {/* 筛选和排序按钮 */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  {/* 筛选和排序按钮组 */}
                  <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
                    {/* 拥有状态 */}
                    <FilterMenu
                      menuKey="ownership"
                      label={ownershipLabels[filterOwnership]}
                      value={filterOwnership}
                      options={ownershipOptions}
                      isActive={filterOwnership !== 'all'}
                      isOpen={openMenu === 'ownership'}
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
                      menuWidth={112}
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
                      menuWidth={112}
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
                      menuWidth={112}
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
                      mobileAlign="end"
                      onOpenChange={setOpenMenu}
                      onSelect={value => setSortBy(value as SortBy)}
                    />

                    {/* 重置按钮 */}
                    {hasActiveOperatorFilters && (
                      <button
                        type="button"
                        onClick={resetOperatorFilters}
                        className="min-h-11 w-[calc(33.333%_-_0.5rem)] rounded-lg px-2 text-xs font-medium text-secondary transition-all hover:bg-[var(--app-surface-muted)] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] sm:w-auto sm:px-3"
                      >
                        重置
                      </button>
                    )}
                  </div>

                  {/* 统计信息 */}
                  <div className="text-xs text-secondary w-full sm:w-auto text-right sm:text-left mt-2 sm:mt-0">
                    <span className="font-semibold brand-text">{getFilteredAndSortedOperators.length}</span> / {
                      filterOwnership === 'all' ? allOperators.length : 
                      filterOwnership === 'unowned' ? allOperators.length : 
                      (operBoxData?.data?.length || 0)
                    }
                  </div>
                </div>

                {/* 干员卡片网格 */}
                {getFilteredAndSortedOperators.length === 0 ? (
                  <EmptyState
                    compact
                    className="py-10"
                    icon={<Icons.Users />}
                    title="没有符合条件的干员"
                    description="调整筛选条件后再查看。"
                    action={hasActiveOperatorFilters ? (
                      <Button variant="secondary" size="sm" onClick={resetOperatorFilters}>
                        清除筛选
                      </Button>
                    ) : undefined}
                  />
                ) : (
                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {getFilteredAndSortedOperators.map((oper, idx) => {
                    // 判断是否拥有该干员
                    const ownedIds = new Set((operBoxData?.data || []).map(op => op.id))
                    
                    // 特殊处理：阿米娅的三个形态
                    const amiyaIds = ['char_002_amiya', 'char_1001_amiya2', 'char_1037_amiya3']
                    const hasAnyAmiya = amiyaIds.some(id => ownedIds.has(id))
                    if (hasAnyAmiya) {
                      amiyaIds.forEach(id => ownedIds.add(id))
                    }
                    
                    const isOwned = oper.level > 0 || ownedIds.has(oper.id);
                    const imageLoaded = loadedImages[oper.id] || false;
                    
                    return (
                      <motion.div
                        key={oper.id}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: idx * 0.01 }}
                        className={`group relative p-3 rounded-2xl border transition-all overflow-hidden ${
                          isOwned
                            ? 'surface-soft border-[var(--app-border)] hover:border-[color-mix(in_srgb,var(--app-accent)_42%,var(--app-border))] hover:bg-[var(--app-accent-soft)]'
                            : 'surface-soft border-[var(--app-border)] opacity-75 grayscale-[0.15]'
                        }`}
                      >
                        {/* 未拥有标识 */}
                        {!isOwned && (
                          <div className="absolute top-2 left-2 z-10 px-2 py-0.5 surface-panel text-secondary text-xs font-bold rounded-md border border-[var(--app-border)] backdrop-blur-sm">
                            未拥有
                          </div>
                        )}
                        
                        {/* 干员头像 */}
                        <div className="relative w-full aspect-square mb-2 rounded-xl overflow-hidden surface-soft">
                          {oper.id ? (
                            <>
                              {/* 骨架屏 */}
                              {!imageLoaded && (
                                <div className="absolute inset-0 animate-pulse bg-[var(--app-surface-muted)]"></div>
                              )}
                              <img
                                src={`https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/avatar/${oper.id}.png`}
                                alt={oper.name}
                                className={`w-full h-full object-cover transition-opacity duration-500 ${
                                  imageLoaded ? 'opacity-100' : 'opacity-0'
                                } ${isOwned && imageLoaded ? 'group-hover:scale-110 transition-transform duration-300' : ''}`}
                                onLoad={() => setLoadedImages(prev => ({ ...prev, [oper.id]: true }))}
                                onError={(e) => {
                                  const target = e.target as HTMLImageElement
                                  const currentSrc = target.src
                                  if (!currentSrc.includes('_2.png') && !currentSrc.includes('_1.png')) {
                                    target.src = `https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/avatar/${oper.id}_2.png`
                                  } else if (currentSrc.includes('_2.png')) {
                                    target.src = `https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/avatar/${oper.id}_1.png`
                                  } else {
                                    target.style.display = 'none'
                                    setLoadedImages(prev => ({ ...prev, [oper.id]: true }))
                                  }
                                }}
                              />
                              {/* 未拥有白色半透明蒙版 */}
                              {!isOwned && imageLoaded && (
                                <div className="absolute inset-0 bg-[color-mix(in_srgb,var(--app-bg)_62%,transparent)]"></div>
                              )}
                            </>
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-secondary">
                              无头像
                            </div>
                          )}
                          {/* 稀有度标识 */}
                          {oper.rarity !== undefined && oper.rarity > 0 && (
                            <div className="absolute top-1 right-1 px-1.5 py-0.5 brand-action text-xs font-bold rounded-md backdrop-blur-sm">
                              {Math.min(oper.rarity, 6)}★
                            </div>
                          )}
                        </div>
                        
                        <div className="text-center space-y-2">
                          <div className="text-sm font-bold text-primary truncate" title={oper.name}>
                            {oper.name || '未知干员'}
                          </div>
                          {isOwned && (
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
                      </motion.div>
                    );
                  })}
                </div>
                )}
                  </motion.div>
                )}
              </div>
            </Card>
          </motion.div>
          )}

          {/* 仓库识别 */}
          {activeTab === 'depot' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="min-w-0"
          >
            <Card
              smoothCorners
              className={taskPanelClass(activeTask === 'depot' && isRunning)}
            >
              <div className="data-statistics-task-content">
            {/* 顶部行：图标 + 标题 + 执行按钮 */}
            <div className="data-statistics-task-header flex items-start gap-3 mb-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2 flex-wrap mb-2">
                  <span className="text-xl"><Icons.Package /></span>
                  <span className="font-bold text-primary text-base">仓库识别</span>
                  <span className="brand-chip rounded-full px-2 py-0.5 text-xs">仓库清单</span>
                </div>
                <p className="text-sm text-secondary leading-relaxed">
                  识别仓库中的所有物品
                </p>
              </div>
              
              {/* 执行按钮 */}
              <div className="data-statistics-task-actions flex-shrink-0">
                <Button
                  onClick={executeDepot}
                  disabled={isRunning}
                  loading={activeTask === 'depot' && isRunning}
                  loadingText="正在执行..."
                  variant="primary"
                  icon={
                    <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                    </svg>
                  }
                >
                  立即执行
                </Button>
              </div>
            </div>

            {/* 识别结果展示 */}
            {depotDataLoading && !depotDataError && !depotData && (
              <div className="py-10">
                <Loading text="正在读取仓库数据..." />
              </div>
            )}
            {activeTask === 'depot' && isRunning && !depotData && (
              <div className="py-10">
                <Loading text="正在识别仓库数据..." />
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
                icon={<Icons.Package />}
                title="还没有仓库识别结果"
                description="完成一次仓库识别后，物品清单会显示在这里。"
              />
            )}
            {depotData && (
              <div className="space-y-3">
                {/* 统计信息 */}
                <div className="data-statistics-kpi-grid grid grid-cols-2 md:grid-cols-4">
                  <div className={statCardClass}>
                    <p className="text-xs text-secondary mb-1">总物品数</p>
                    <p className="text-lg font-bold text-primary">
                      {depotData.itemCount}
                    </p>
                  </div>
                  <div className={statCardClass}>
                    <p className="text-xs text-secondary mb-1">材料类</p>
                    <p className="text-lg font-bold text-primary">
                      {depotData.items.filter(i => i.classifyType === 'MATERIAL').length}
                    </p>
                  </div>
                  <div className={statCardClass}>
                    <p className="text-xs text-secondary mb-1">识别分类</p>
                    <p className="text-lg font-bold text-primary">
                      {depotTypeSummary.length}
                    </p>
                  </div>
                  <div className={statCardClass}>
                    <p className="text-xs text-secondary mb-1">总数量</p>
                    <p className="text-lg font-bold text-primary">
                      {depotData.items.reduce((sum, i) => sum + i.count, 0).toLocaleString()}
                    </p>
                  </div>
                  <div className={statCardClass}>
                    <p className="text-xs text-secondary mb-1">最多物品</p>
                    <p className="text-sm font-bold text-primary truncate">
                      {depotData.items.length > 0 && depotData.items[0]
                        ? depotData.items.reduce((max, i) => i.count > max.count ? i : max, depotData.items[0]).name 
                        : '-'}
                    </p>
                  </div>
                  {depotData.timestamp && (
                    <div className={`col-span-1 md:col-span-3 ${statCardClass}`}>
                      <p className="text-xs text-secondary">
                        识别时间: {new Date(depotData.timestamp).toLocaleString('zh-CN')}
                      </p>
                    </div>
                  )}
                </div>

                {/* 分类汇总 */}
                {depotTypeSummary.length > 0 && (
                  <div className="rounded-2xl border border-[var(--app-border)] surface-soft p-3">
                    <div className="text-sm font-semibold text-primary mb-2">分类汇总</div>
                    <div className="flex flex-wrap gap-2">
                      {depotTypeSummary.map((group) => (
                        <div key={group.type} className="rounded-full border border-[var(--app-border)] surface-panel px-3 py-1 text-xs text-secondary">
                          <span className="font-medium">{group.label}</span>
                          <span className="mx-1 brand-text">·</span>
                          <span>{group.kinds} 种</span>
                          <span className="mx-1 brand-text">/</span>
                          <span>{group.count.toLocaleString()} 件</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 物品卡片网格 */}
                {depotData.items && depotData.items.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {depotData.items.map((item, idx) => {
                      const itemKey = item.id || item.iconId
                      const imageKey = `${itemKey}:${item.iconId}`

                      return (
                        <motion.div
                          key={itemKey}
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: idx * 0.01 }}
                          className="group flex items-center gap-3 rounded-2xl border border-[var(--app-border)] p-3 transition-colors surface-soft hover:border-[color-mix(in_srgb,var(--app-accent)_42%,var(--app-border))] hover:bg-[var(--app-accent-soft)]"
                        >
                          {/* 物品图标 */}
                          <div className="flex-shrink-0 w-12 h-12 rounded-xl overflow-hidden surface-panel flex items-center justify-center">
                            {failedDepotImages[imageKey] ? (
                              <span role="img" aria-label={`${item.name}图标不可用`}>
                                <PackageIcon className="h-6 w-6 brand-text" aria-hidden="true" />
                              </span>
                            ) : (
                              <img
                                src={getItemIconUrl(item.iconId)}
                                alt={item.name}
                                className="w-full h-full object-cover"
                                onError={() => {
                                  setFailedDepotImages(previous => ({ ...previous, [imageKey]: true }))
                                }}
                              />
                            )}
                          </div>

                          {/* 物品信息 */}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-bold text-primary truncate" title={item.name}>
                              {item.name}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              {item.classifyType && (
                                <span className={chipClass}>
                                  {getDepotTypeLabel(item.classifyType)}
                                </span>
                              )}
                              <span className={`${chipClass} font-semibold`}>
                                ×{item.count.toLocaleString()}
                              </span>
                            </div>
                          </div>
                        </motion.div>
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
            <DropRecords
              dropStatistics={dropStatistics}
              dropDays={dropDays}
              setDropDays={setDropDays}
              onRefresh={loadDropData}
              isLoading={dropDataLoading}
              error={dropDataError}
            />
          )}
          </div>

        </div>
      </div>
    </div>
  )
}
