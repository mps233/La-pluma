import { useState, useEffect, useMemo } from 'react'
import { maaApi, getTodayDrops, getDropStatistics } from '../services/api'
import { motion } from 'framer-motion'
import Icons from './Icons'
import DropRecords from './DropRecords'
import { PageHeader, StatusIndicator, InfoCard, Button } from './common'
import type {
  DataStatisticsProps,
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
  OpenMenu
} from '@/types/components'

export default function DataStatistics({}: DataStatisticsProps) {
  const [isRunning, setIsRunning] = useState(false)
  const [activeTask, setActiveTask] = useState<ActiveTask>(null)
  const [statusMessage, setStatusMessage] = useState<string>('')
  const [depotData, setDepotData] = useState<DepotDataDetailed | null>(null)
  const [operBoxData, setOperBoxData] = useState<OperBoxData | null>(null)
  const [allOperators, setAllOperators] = useState<OperatorDetailed[]>([])
  
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
  
  // 掉落记录相关状态
  const [dropData, setDropData] = useState<any>(null)
  const [dropStatistics, setDropStatistics] = useState<any>(null)
  const [dropDays, setDropDays] = useState(7)

  // 加载已保存的数据
  useEffect(() => {
    loadSavedData()
    loadAllOperators()
    loadDropData()
  }, [])

  // 点击外部关闭菜单
  useEffect(() => {
    if (!openMenu) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      const isInsideMenu = target.closest('.relative')
      if (!isInsideMenu) {
        setOpenMenu(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [openMenu])

  const loadSavedData = async () => {
    try {
      // 加载仓库数据
      const depotResult = await maaApi.getDepotData()
      if (depotResult.success) {
        setDepotData({
          itemCount: depotResult.data.itemCount,
          items: depotResult.data.items || [],
          timestamp: depotResult.data.timestamp
        })
      }

      // 加载干员数据
      const operBoxResult = await maaApi.getOperBoxData()
      if (operBoxResult.success) {
        setOperBoxData({
          operCount: operBoxResult.data.operCount,
          data: operBoxResult.data.data || [],
          timestamp: operBoxResult.data.timestamp
        })
      }
    } catch (error) {
      // 静默失败，不影响用户体验
    }
  }

  const loadAllOperators = async () => {
    try {
      const result = await maaApi.getAllOperators()
      if (result.success) {
        setAllOperators(result.data)
      }
    } catch (error) {
      // 静默失败，不影响用户体验
    }
  }

  // 加载掉落数据
  const loadDropData = async () => {
    try {
      // 加载今日掉落
      const todayResult = await getTodayDrops()
      if (todayResult.success) {
        setDropData(todayResult.data)
      }
      
      // 加载统计数据
      const statsResult = await getDropStatistics(dropDays)
      if (statsResult.success) {
        setDropStatistics(statsResult.data)
      }
    } catch (error) {
      // 静默失败，不影响用户体验
    }
  }
  
  // 当统计天数变化时重新加载
  useEffect(() => {
    if (activeTab === 'drops') {
      loadDropData()
    }
  }, [dropDays, activeTab])

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
    setDepotData(null)

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
          setDepotData({
            itemCount: parseResult.data.itemCount,
            items: parseResult.data.items || [],
            path: parseResult.data.path,
            timestamp: new Date().toISOString()
          })
          
          try {
            setStatusMessage('正在更新智能养成系统...')
            const { getTrainingQueue } = await import('../services/api')
            const queueResult = await getTrainingQueue()
            
            if (queueResult.success && queueResult.data && queueResult.data.length > 0) {
              setStatusMessage(`✓ 识别完成！共识别 ${parseResult.data.itemCount} 种物品，已更新养成进度`)
              await new Promise(resolve => setTimeout(resolve, 2000))
              setStatusMessage('')
            } else {
              setStatusMessage(`✓ 识别完成！共识别 ${parseResult.data.itemCount} 种物品`)
              await new Promise(resolve => setTimeout(resolve, 2000))
              setStatusMessage('')
            }
          } catch (error) {
            setStatusMessage(`✓ 识别完成！共识别 ${parseResult.data.itemCount} 种物品`)
            await new Promise(resolve => setTimeout(resolve, 2000))
            setStatusMessage('')
          }
        } else {
          setStatusMessage(`❌ 识别完成，但数据解析失败: ${parseResult.error}`)
          await new Promise(resolve => setTimeout(resolve, 2000))
          setStatusMessage('')
        }
      } else {
        setStatusMessage(`❌ 识别失败: ${result.error || '未知错误'}`)
        await new Promise(resolve => setTimeout(resolve, 2000))
        setStatusMessage('')
      }
    } catch (error: any) {
      setStatusMessage(`❌ 识别失败: ${error.message}`)
      await new Promise(resolve => setTimeout(resolve, 2000))
      setStatusMessage('')
    } finally {
      setIsRunning(false)
      setActiveTask(null)
    }
  }

  // 执行干员识别
  const executeOperBox = async () => {
    if (isRunning) return

    setIsRunning(true)
    setActiveTask('operbox')
    setStatusMessage('正在识别干员 Box...')
    setOperBoxData(null)

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
          setStatusMessage(`✓ 识别完成！共识别 ${parseResult.data.operCount} 名干员`)
          setOperBoxData({
            operCount: parseResult.data.operCount,
            data: parseResult.data.data || [],
            path: parseResult.data.path,
            timestamp: new Date().toISOString()
          })
          await new Promise(resolve => setTimeout(resolve, 2000))
          setStatusMessage('')
        } else {
          setStatusMessage(`❌ 识别完成，但数据解析失败: ${parseResult.error}`)
          await new Promise(resolve => setTimeout(resolve, 2000))
          setStatusMessage('')
        }
      } else {
        setStatusMessage(`❌ 识别失败: ${result.error || '未知错误'}`)
        await new Promise(resolve => setTimeout(resolve, 2000))
        setStatusMessage('')
      }
    } catch (error: any) {
      setStatusMessage(`❌ 识别失败: ${error.message}`)
      await new Promise(resolve => setTimeout(resolve, 2000))
      setStatusMessage('')
    } finally {
      setIsRunning(false)
      setActiveTask(null)
    }
  }

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* 页面标题 */}
        <PageHeader
          icon={<Icons.Info className="w-6 h-6 text-cyan-600 dark:text-cyan-400" />}
          title="数据统计"
          subtitle="识别仓库物品和干员 Box 数据"
          gradientFrom="cyan-400"
          gradientVia="blue-400"
          gradientTo="indigo-400"
          actions={
            <StatusIndicator
              isActive={isRunning}
              message={statusMessage}
              activeText="运行中"
              inactiveText="就绪"
              activeColor="cyan-400"
            />
          }
        />

        {/* 标签页切换 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 border-b border-gray-200 dark:border-white/10"
        >
          <button
            onClick={() => setActiveTab('operbox')}
            className={`flex items-center space-x-2 px-4 py-3 text-sm font-medium transition-all relative ${
              activeTab === 'operbox'
                ? 'text-cyan-600 dark:text-cyan-400'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <Icons.Users />
            <span>干员识别</span>
            {activeTab === 'operbox' && (
              <motion.div
                layoutId="activeTab"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-500"
                initial={false}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
              />
            )}
          </button>
          <button
            onClick={() => setActiveTab('depot')}
            className={`flex items-center space-x-2 px-4 py-3 text-sm font-medium transition-all relative ${
              activeTab === 'depot'
                ? 'text-cyan-600 dark:text-cyan-400'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <Icons.Package />
            <span>仓库识别</span>
            {activeTab === 'depot' && (
              <motion.div
                layoutId="activeTab"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-500"
                initial={false}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
              />
            )}
          </button>
          <button
            onClick={() => setActiveTab('drops')}
            className={`flex items-center space-x-2 px-4 py-3 text-sm font-medium transition-all relative ${
              activeTab === 'drops'
                ? 'text-cyan-600 dark:text-cyan-400'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <Icons.TrendingUp />
            <span>掉落记录</span>
            {activeTab === 'drops' && (
              <motion.div
                layoutId="activeTab"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-500"
                initial={false}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
              />
            )}
          </button>
        </motion.div>

        {/* 功能卡片 */}
        <div className="space-y-6">
          {/* 干员识别 */}
          {activeTab === 'operbox' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={`border rounded-3xl p-6 transition-all ${
              activeTask === 'operbox' && isRunning
                ? 'border-cyan-500/60 bg-gradient-to-br from-cyan-500/10 to-blue-500/10 shadow-[0_8px_20px_rgb(34,211,238,0.25)] ring-1 ring-cyan-500/30'
                : 'border-gray-200 dark:border-white/10 hover:border-cyan-400 dark:hover:border-cyan-500/30 hover:shadow-[0_4px_12px_rgb(0,0,0,0.2)] bg-white dark:bg-gray-900/60'
            }`}
          >
            {/* 顶部行：图标 + 标题 + 执行按钮 */}
            <div className="flex items-start gap-3 mb-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2 flex-wrap mb-2">
                  <span className="text-xl"><Icons.Users /></span>
                  <span className="font-bold text-gray-900 dark:text-white text-base">干员识别</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/10 px-2 py-0.5 rounded-full border border-gray-200 dark:border-white/10">operbox</span>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                  识别所有干员信息
                </p>
              </div>
              
              {/* 执行按钮 */}
              <div className="flex-shrink-0">
                {activeTask === 'operbox' && isRunning ? (
                  <div className="w-7 h-7 flex items-center justify-center">
                    <svg className="w-5 h-5 animate-spin text-cyan-400" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  </div>
                ) : (
                  <Button
                    onClick={executeOperBox}
                    disabled={isRunning}
                    variant="gradient"
                    gradientFrom="cyan-500"
                    gradientTo="blue-500"
                    icon={
                      <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                      </svg>
                    }
                  >
                    立即执行
                  </Button>
                )}
              </div>
            </div>

            {/* 识别结果展示 */}
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
                    <div className="relative w-[calc(33.333%-0.5rem)] sm:w-auto">
                      <button
                        onClick={() => setOpenMenu(openMenu === 'ownership' ? null : 'ownership')}
                        className={`w-full sm:w-auto flex items-center justify-center space-x-1 sm:space-x-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                          filterOwnership !== 'all'
                            ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/25'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        <span className="truncate">
                          {filterOwnership === 'all' ? '拥有状态' : 
                           filterOwnership === 'owned' ? '已拥有' : '未拥有'}
                        </span>
                        <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {openMenu === 'ownership' && (
                        <div className="absolute top-full left-0 mt-1 w-32 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1 z-50">
                          {[
                            { value: 'all', label: '全部' },
                            { value: 'owned', label: '已拥有' },
                            { value: 'unowned', label: '未拥有' }
                          ].map((option) => (
                            <button
                              key={option.value}
                              onClick={() => {
                                setFilterOwnership(option.value as FilterOwnership)
                                setOpenMenu(null)
                              }}
                              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                                filterOwnership === option.value
                                  ? 'bg-cyan-50 dark:bg-cyan-900/20 text-cyan-600 dark:text-cyan-400 font-medium'
                                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 星级 */}
                    <div className="relative w-[calc(33.333%-0.5rem)] sm:w-auto">
                      <button
                        onClick={() => setOpenMenu(openMenu === 'rarity' ? null : 'rarity')}
                        className={`w-full sm:w-auto flex items-center justify-center space-x-1 sm:space-x-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                          filterRarity !== 'all'
                            ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/25'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        <span className="truncate">
                          {filterRarity === 'all' ? '星级' : `${filterRarity}星`}
                        </span>
                        <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {openMenu === 'rarity' && (
                        <div className="absolute top-full left-0 mt-1 w-28 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1 z-50">
                          {[
                            { value: 'all', label: '全部' },
                            { value: '6', label: '6星' },
                            { value: '5', label: '5星' },
                            { value: '4', label: '4星' },
                            { value: '3', label: '3星' },
                            { value: '2', label: '2星' },
                            { value: '1', label: '1星' }
                          ].map((option) => (
                            <button
                              key={option.value}
                              onClick={() => {
                                setFilterRarity(option.value as FilterRarity)
                                setOpenMenu(null)
                              }}
                              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                                filterRarity === option.value
                                  ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 font-medium'
                                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 职业 */}
                    <div className="relative w-[calc(33.333%-0.5rem)] sm:w-auto">
                      <button
                        onClick={() => setOpenMenu(openMenu === 'profession' ? null : 'profession')}
                        className={`w-full sm:w-auto flex items-center justify-center space-x-1 sm:space-x-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                          filterProfession !== 'all'
                            ? 'bg-green-500 text-white shadow-lg shadow-green-500/25'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        <span className="truncate">
                          {filterProfession === 'all' ? '职业' :
                           filterProfession === 'PIONEER' ? '先锋' :
                           filterProfession === 'WARRIOR' ? '近卫' :
                           filterProfession === 'TANK' ? '重装' :
                           filterProfession === 'SNIPER' ? '狙击' :
                           filterProfession === 'CASTER' ? '术师' :
                           filterProfession === 'MEDIC' ? '医疗' :
                           filterProfession === 'SUPPORT' ? '辅助' :
                           filterProfession === 'SPECIAL' ? '特种' : '职业'}
                        </span>
                        <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {openMenu === 'profession' && (
                        <div className="absolute top-full left-0 mt-1 w-32 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1 z-50">
                          {[
                            { value: 'all', label: '全部' },
                            { value: 'PIONEER', label: '先锋' },
                            { value: 'WARRIOR', label: '近卫' },
                            { value: 'TANK', label: '重装' },
                            { value: 'SNIPER', label: '狙击' },
                            { value: 'CASTER', label: '术师' },
                            { value: 'MEDIC', label: '医疗' },
                            { value: 'SUPPORT', label: '辅助' },
                            { value: 'SPECIAL', label: '特种' }
                          ].map((option) => (
                            <button
                              key={option.value}
                              onClick={() => {
                                setFilterProfession(option.value as FilterProfession)
                                setOpenMenu(null)
                              }}
                              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                                filterProfession === option.value
                                  ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 font-medium'
                                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 精英化 */}
                    <div className="relative w-[calc(33.333%-0.5rem)] sm:w-auto">
                      <button
                        onClick={() => setOpenMenu(openMenu === 'elite' ? null : 'elite')}
                        className={`w-full sm:w-auto flex items-center justify-center space-x-1 sm:space-x-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                          filterElite !== 'all'
                            ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/25'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        <span className="truncate">
                          {filterElite === 'all' ? '精英化' : `精英${filterElite}`}
                        </span>
                        <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {openMenu === 'elite' && (
                        <div className="absolute top-full left-0 mt-1 w-28 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1 z-50">
                          {[
                            { value: 'all', label: '全部' },
                            { value: '2', label: '精英2' },
                            { value: '1', label: '精英1' },
                            { value: '0', label: '精英0' }
                          ].map((option) => (
                            <button
                              key={option.value}
                              onClick={() => {
                                setFilterElite(option.value as FilterElite)
                                setOpenMenu(null)
                              }}
                              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                                filterElite === option.value
                                  ? 'bg-cyan-50 dark:bg-cyan-900/20 text-cyan-600 dark:text-cyan-400 font-medium'
                                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 潜能 */}
                    <div className="relative w-[calc(33.333%-0.5rem)] sm:w-auto">
                      <button
                        onClick={() => setOpenMenu(openMenu === 'potential' ? null : 'potential')}
                        className={`w-full sm:w-auto flex items-center justify-center space-x-1 sm:space-x-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                          filterPotential !== 'all'
                            ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/25'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        <span className="truncate">
                          {filterPotential === 'all' ? '潜能' : `潜能${filterPotential}`}
                        </span>
                        <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {openMenu === 'potential' && (
                        <div className="absolute top-full left-0 mt-1 w-28 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1 z-50">
                          {[
                            { value: 'all', label: '全部' },
                            { value: '6', label: '潜能6' },
                            { value: '5', label: '潜能5' },
                            { value: '4', label: '潜能4' },
                            { value: '3', label: '潜能3' },
                            { value: '2', label: '潜能2' },
                            { value: '1', label: '潜能1' }
                          ].map((option) => (
                            <button
                              key={option.value}
                              onClick={() => {
                                setFilterPotential(option.value as FilterPotential)
                                setOpenMenu(null)
                              }}
                              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                                filterPotential === option.value
                                  ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 font-medium'
                                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 排序 */}
                    <div className="relative w-[calc(33.333%-0.5rem)] sm:w-auto">
                      <button
                        onClick={() => setOpenMenu(openMenu === 'sort' ? null : 'sort')}
                        className={`w-full sm:w-auto flex items-center justify-center space-x-1 sm:space-x-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                          sortBy !== 'default'
                            ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/25'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        <span className="truncate">
                          {sortBy === 'default' ? '排序' :
                           sortBy === 'rarity' ? '星级降序' :
                           sortBy === 'level' ? '等级降序' :
                           sortBy === 'potential' ? '潜能降序' : '排序'}
                        </span>
                        <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {openMenu === 'sort' && (
                        <div className="absolute top-full left-0 mt-1 w-32 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1 z-50">
                          {[
                            { value: 'default', label: '默认顺序' },
                            { value: 'rarity', label: '星级降序' },
                            { value: 'level', label: '等级降序' },
                            { value: 'potential', label: '潜能降序' }
                          ].map((option) => (
                            <button
                              key={option.value}
                              onClick={() => {
                                setSortBy(option.value as SortBy)
                                setOpenMenu(null)
                              }}
                              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                                sortBy === option.value
                                  ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium'
                                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 重置按钮 */}
                    {(filterRarity !== 'all' || filterElite !== 'all' || filterPotential !== 'all' || filterOwnership !== 'all' || filterProfession !== 'all' || sortBy !== 'default') && (
                      <button
                        onClick={() => {
                          setFilterRarity('all')
                          setFilterElite('all')
                          setFilterPotential('all')
                          setFilterOwnership('all')
                          setFilterProfession('all')
                          setSortBy('default')
                        }}
                        className="w-[calc(33.333%-0.5rem)] sm:w-auto px-2 sm:px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all"
                      >
                        重置
                      </button>
                    )}
                  </div>

                  {/* 统计信息 */}
                  <div className="text-xs text-gray-600 dark:text-gray-400 w-full sm:w-auto text-right sm:text-left mt-2 sm:mt-0">
                    <span className="font-semibold text-cyan-600 dark:text-cyan-400">{getFilteredAndSortedOperators.length}</span> / {
                      filterOwnership === 'all' ? allOperators.length : 
                      filterOwnership === 'unowned' ? allOperators.length : 
                      (operBoxData?.data?.length || 0)
                    }
                  </div>
                </div>

                {/* 干员卡片网格 */}
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
                        key={idx}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: idx * 0.01 }}
                        className={`group relative p-3 rounded-2xl border transition-all overflow-hidden ${
                          isOwned
                            ? 'bg-gradient-to-br from-cyan-50 to-blue-50 dark:from-cyan-900/20 dark:to-blue-900/20 border-cyan-200 dark:border-cyan-500/20 hover:border-cyan-400 dark:hover:border-cyan-500/40 hover:shadow-lg'
                            : 'bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900/20 dark:to-gray-800/20 border-gray-300 dark:border-gray-600/20'
                        }`}
                      >
                        {/* 未拥有标识 */}
                        {!isOwned && (
                          <div className="absolute top-2 left-2 z-10 px-2 py-0.5 bg-gray-500/90 text-white text-xs font-bold rounded backdrop-blur-sm">
                            未拥有
                          </div>
                        )}
                        
                        {/* 干员头像 */}
                        <div className="relative w-full aspect-square mb-2 rounded-xl overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900">
                          {oper.id ? (
                            <>
                              {/* 骨架屏 */}
                              {!imageLoaded && (
                                <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-amber-100 via-amber-200 to-amber-100 dark:from-amber-900/30 dark:via-amber-800/30 dark:to-amber-900/30"></div>
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
                                <div className="absolute inset-0 bg-white/60 dark:bg-white/40"></div>
                              )}
                            </>
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-gray-400 dark:text-gray-600">
                              无头像
                            </div>
                          )}
                          {/* 稀有度标识 */}
                          {oper.rarity !== undefined && oper.rarity > 0 && (
                            <div className="absolute top-1 right-1 px-1.5 py-0.5 bg-amber-500/90 text-white text-xs font-bold rounded backdrop-blur-sm">
                              {Math.min(oper.rarity, 6)}★
                            </div>
                          )}
                        </div>
                        
                        <div className="text-center space-y-2">
                          <div className="text-sm font-bold text-gray-900 dark:text-white truncate" title={oper.name}>
                            {oper.name || '未知干员'}
                          </div>
                          {isOwned && (
                            <>
                              <div className="flex flex-wrap items-center justify-center gap-1 text-xs">
                                {oper.elite !== undefined && (
                                  <span className="px-2 py-0.5 bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300 rounded-full whitespace-nowrap">
                                    精{oper.elite}
                                  </span>
                                )}
                                {oper.level !== undefined && (
                                  <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full whitespace-nowrap">
                                    Lv.{oper.level}
                                  </span>
                                )}
                              </div>
                              {oper.potential !== undefined && (
                                <div className="text-xs text-gray-500 dark:text-gray-400">
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
                  </motion.div>
                )}
          </motion.div>
          )}

          {/* 仓库识别 */}
          {activeTab === 'depot' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={`border rounded-3xl p-6 transition-all ${
              activeTask === 'depot' && isRunning
                ? 'border-cyan-500/60 bg-gradient-to-br from-cyan-500/10 to-blue-500/10 shadow-[0_8px_20px_rgb(34,211,238,0.25)] ring-1 ring-cyan-500/30'
                : 'border-gray-200 dark:border-white/10 hover:border-cyan-400 dark:hover:border-cyan-500/30 hover:shadow-[0_4px_12px_rgb(0,0,0,0.2)] bg-white dark:bg-gray-900/60'
            }`}
          >
            {/* 顶部行：图标 + 标题 + 执行按钮 */}
            <div className="flex items-start gap-3 mb-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2 flex-wrap mb-2">
                  <span className="text-xl"><Icons.Package /></span>
                  <span className="font-bold text-gray-900 dark:text-white text-base">仓库识别</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/10 px-2 py-0.5 rounded-full border border-gray-200 dark:border-white/10">depot</span>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                  识别仓库中的所有物品
                </p>
              </div>
              
              {/* 执行按钮 */}
              <div className="flex-shrink-0">
                {activeTask === 'depot' && isRunning ? (
                  <div className="w-7 h-7 flex items-center justify-center">
                    <svg className="w-5 h-5 animate-spin text-cyan-400" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  </div>
                ) : (
                  <Button
                    onClick={executeDepot}
                    disabled={isRunning}
                    variant="gradient"
                    gradientFrom="cyan-500"
                    gradientTo="blue-500"
                    icon={
                      <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                      </svg>
                    }
                  >
                    立即执行
                  </Button>
                )}
              </div>
            </div>

            {/* 识别结果展示 */}
            {depotData && (
              <div className="space-y-3">
                {/* 统计信息 */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="p-3 bg-cyan-50 dark:bg-cyan-900/20 rounded-2xl border border-cyan-200 dark:border-cyan-500/20">
                    <p className="text-xs text-cyan-600 dark:text-cyan-400 mb-1">总物品数</p>
                    <p className="text-lg font-bold text-cyan-900 dark:text-cyan-300">
                      {depotData.itemCount}
                    </p>
                  </div>
                  <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-200 dark:border-blue-500/20">
                    <p className="text-xs text-blue-600 dark:text-blue-400 mb-1">材料类</p>
                    <p className="text-lg font-bold text-blue-900 dark:text-blue-300">
                      {depotData.items.filter(i => i.classifyType === 'MATERIAL').length}
                    </p>
                  </div>
                  <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-2xl border border-green-200 dark:border-green-500/20">
                    <p className="text-xs text-green-600 dark:text-green-400 mb-1">总数量</p>
                    <p className="text-lg font-bold text-green-900 dark:text-green-300">
                      {depotData.items.reduce((sum, i) => sum + i.count, 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-2xl border border-amber-200 dark:border-amber-500/20">
                    <p className="text-xs text-amber-600 dark:text-amber-400 mb-1">最多物品</p>
                    <p className="text-sm font-bold text-amber-900 dark:text-amber-300 truncate">
                      {depotData.items.length > 0 && depotData.items[0]
                        ? depotData.items.reduce((max, i) => i.count > max.count ? i : max, depotData.items[0]).name 
                        : '-'}
                    </p>
                  </div>
                  {depotData.timestamp && (
                    <div className="col-span-2 md:col-span-4 p-3 bg-gray-50 dark:bg-gray-900/20 rounded-2xl border border-gray-200 dark:border-white/10">
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        识别时间: {new Date(depotData.timestamp).toLocaleString('zh-CN')}
                      </p>
                    </div>
                  )}
                </div>

                {/* 物品卡片网格 */}
                {depotData.items && depotData.items.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {depotData.items.map((item, idx) => (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: idx * 0.01 }}
                        className="group flex items-center gap-3 p-3 bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-900/20 dark:to-purple-900/20 rounded-2xl border border-violet-200 dark:border-violet-500/20 hover:border-violet-400 dark:hover:border-violet-500/40 hover:shadow-lg transition-all"
                      >
                        {/* 物品图标 */}
                        <div className="flex-shrink-0 w-12 h-12 rounded-xl overflow-hidden bg-gradient-to-br from-violet-100 to-purple-100 dark:from-violet-900/30 dark:to-purple-900/30 flex items-center justify-center">
                          <img
                            src={`/api/maa/item-icon/${item.iconId}`}
                            alt={item.name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement
                              target.style.display = 'none'
                              const parent = target.parentElement
                              if (parent) {
                                parent.innerHTML = '<svg class="w-6 h-6 text-violet-400 dark:text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg>'
                              }
                            }}
                          />
                        </div>
                        
                        {/* 物品信息 */}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold text-gray-900 dark:text-white truncate" title={item.name}>
                            {item.name}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            {item.classifyType && (
                              <span className="px-2 py-0.5 bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 rounded-full text-xs whitespace-nowrap">
                                {item.classifyType === 'MATERIAL' ? '材料' : item.classifyType}
                              </span>
                            )}
                            <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded-full font-semibold text-xs whitespace-nowrap">
                              ×{item.count.toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </motion.div>
          )}
          
          {/* 掉落记录 */}
          {activeTab === 'drops' && (
            <DropRecords
              dropData={dropData}
              dropStatistics={dropStatistics}
              dropDays={dropDays}
              setDropDays={setDropDays}
              onRefresh={loadDropData}
            />
          )}
        </div>

        {/* 说明信息 */}
        <InfoCard type="info">
          <div className="flex items-start space-x-3">
            <Icons.Info className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-800 dark:text-blue-300">
              <p className="font-medium mb-1">使用说明</p>
              <ul className="space-y-1 list-disc list-inside text-xs">
                <li>识别前请确保游戏已启动并进入主界面</li>
                <li>仓库识别：需要打开仓库界面</li>
                <li>干员识别：需要打开干员界面</li>
                <li>识别完成后可点击"查看详情"展开完整清单</li>
                <li>数据按游戏内顺序排序，包含物品名称和数量</li>
                <li>识别结果保存到：<code className="px-1 py-0.5 bg-blue-100 dark:bg-blue-900/50 rounded text-xs">server/data/</code></li>
              </ul>
            </div>
          </div>
        </InfoCard>
      </div>
    </div>
  )
}
