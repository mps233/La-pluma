import { useState, useEffect } from 'react'
import { getSklandPlayerData, getSklandStatus } from '../services/api'
import Icons from './Icons'
import { PageHeader, Card, Button } from './common'
import { DashboardSkeleton } from './common/Loading'
import FloatingStatusIndicator from './FloatingStatusIndicator'

interface SklandData {
  uid: string
  nickname: string
  level: number
  registerTs: number
  mainStageProgress: string
  secretary: string
  secretaryName: string
  avatarId: string
  avatarUrl: string
  stageInfo: {
    id: string
    code: string
    name: string
    difficulty: string
    dangerLevel: string
    apCost: number
    thumbnail: string
    stageType: string
    isMainStage: boolean
    isActivityStage: boolean
  } | null
  ap: {
    current: number
    max: number
    completeRecoveryTime: number
  }
  chars: {
    total: number
    elite2: number
    maxLevel: number
    skill7Plus: number
  }
  building: {
    furniture: number
    labor: {
      value: number
      maxValue: number
    }
    manufactures?: any[]
    tradings?: any[]
    dormitories?: any[]
    meeting?: any
    hire?: any
    training?: any
  }
  routine: {
    daily: { current: number; total: number }
    weekly: { current: number; total: number }
  } | null
  campaign: {
    reward: { current: number; total: number }
  } | null
  recruit: Array<{
    state: number
    finishTs?: number
    tags?: Array<{ tagId: number; tagName: string }>
  }>
  assistChars?: Array<{
    charId: string
    skinId?: string
    name: string
    level: number
    evolvePhase: number
    mainSkillLvl: number
    skills: any[]
  }>
  social?: any
  training?: any
  clue?: any
}

export default function Dashboard() {
  const [sklandData, setSklandData] = useState<SklandData | null>(null)
  const [sklandStatus, setSklandStatus] = useState<{ isLoggedIn: boolean; phone: string | null }>({ 
    isLoggedIn: false, 
    phone: null 
  })
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [currentTime, setCurrentTime] = useState(Date.now())
  const [isDarkMode, setIsDarkMode] = useState(false)

  // 检测深色模式
  useEffect(() => {
    const checkDarkMode = () => {
      setIsDarkMode(document.documentElement.classList.contains('dark'))
    }
    
    checkDarkMode()
    
    // 监听主题变化
    const observer = new MutationObserver(checkDarkMode)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    })
    
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    loadDashboardData()
    const interval = setInterval(loadDashboardData, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  // 每秒更新当前时间，用于倒计时
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now())
    }, 1000)
    return () => clearInterval(timer)
  }, [])
  const loadDashboardData = async (forceRefresh: boolean = false) => {
    // 只在首次加载且没有数据时显示骨架屏
    if (!sklandData) {
      setLoading(true)
    }
    try {
      const statusResult = await getSklandStatus()
      if (statusResult.success && statusResult.data) {
        setSklandStatus(statusResult.data)

        if (statusResult.data.isLoggedIn) {
          const sklandResult = await getSklandPlayerData(!forceRefresh)
          if (sklandResult.success && sklandResult.data) {
            setSklandData(sklandResult.data)
          } else if (sklandResult.error && sklandResult.error.includes('登录已过期')) {
            console.warn('森空岛登录已过期')
            setSklandStatus({ isLoggedIn: false, phone: null })
          }
        }
      }

      setLastUpdate(new Date())
    } catch (error) {
      console.error('加载 Dashboard 数据失败:', error)
    } finally {
      setLoading(false)
    }
  }



  const formatFullRecoveryTime = (completeRecoveryTime: number) => {
    const remainingSeconds = completeRecoveryTime - currentTime / 1000
    if (remainingSeconds <= 0) return '已满'

    const hours = Math.floor(remainingSeconds / 3600)
    const minutes = Math.floor((remainingSeconds % 3600) / 60)

    if (hours > 0) {
      return `${hours}小时${minutes}分钟`
    }
    return `${minutes}分钟`
  }
  const formatRecruitTime = (finishTs: number) => {
    const diff = finishTs * 1000 - currentTime
    if (diff <= 0) return '已完成'
    
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    const seconds = Math.floor((diff % (1000 * 60)) / 1000)
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const formatRegisterDate = (registerTs: number) => {
    const date = new Date(registerTs * 1000)
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const day = date.getDate()
    return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
  }

  if (loading) {
    return <DashboardSkeleton />
  }

  if (!sklandStatus.isLoggedIn) {
    return (
      <div className="p-6">
        <div className="max-w-2xl mx-auto pt-20">
          <Card className="text-center">
            <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
              <Icons.Users />
            </div>
            <h3 className="text-2xl font-bold mb-4 text-gray-900 dark:text-white">
              未登录森空岛账号
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-8">
              登录后可查看实时理智、干员数据、基建状态等详细信息
            </p>
            <Button
              onClick={() => window.location.href = '#/skland-config'}
              variant="gradient"
              gradientFrom="cyan"
              gradientTo="blue"
              size="lg"
            >
              前往登录
            </Button>
          </Card>
        </div>
      </div>
    )
  }
  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader
          icon={<Icons.Dashboard />}
          title="控制台"
          subtitle="实时查看游戏数据和账号状态"
          gradientFrom="cyan-400"
          gradientVia="blue-400"
          gradientTo="purple-400"
          actions={
            <div className="flex items-center gap-3">
              <FloatingStatusIndicator />
              <Button
                onClick={() => loadDashboardData(true)}
                variant="gradient"
                gradientFrom="cyan"
                gradientTo="blue"
                size="md"
                icon={<Icons.RefreshCw />}
              >
                <span className="hidden sm:inline">刷新数据</span>
              </Button>
            </div>
          }
        />

        {sklandData && (
          <div className="flex gap-5">
            {/* 左列：博士信息 + 剿灭作战 + 2x2网格 (flex-[2]) */}
            <div className="flex-[2] flex flex-col gap-5">
              {/* 博士信息卡片 */}
              <Card theme="cyan" animated delay={0.1} className="!bg-white dark:!bg-[rgba(15,15,15,0.6)] overflow-hidden">
                <div className="flex items-center gap-2 mb-6 pb-3 border-b border-white/10 dark:border-white/5">
                  <div className="w-1 h-6 bg-gradient-to-b from-cyan-500 to-blue-500 rounded-full"></div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">博士信息</h3>
                </div>

                <div className="flex items-start gap-6">
                  <div className="relative flex-shrink-0">
                    {sklandData.avatarUrl ? (
                      <div className="relative w-24 h-24">
                        <img 
                          src={`/api/skland/avatar-proxy?url=${encodeURIComponent(sklandData.avatarUrl)}`}
                          alt={sklandData.nickname}
                          className="w-full h-full object-cover shadow-lg"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none'
                            const fallback = e.currentTarget.parentElement?.nextElementSibling as HTMLElement
                            if (fallback) fallback.style.display = 'flex'
                          }}
                        />
                        <div className="absolute inset-0 pointer-events-none" style={{
                          background: `
                            linear-gradient(to bottom, rgba(255, 255, 255, 0.2), white) left/1px 100% no-repeat,
                            linear-gradient(to right, white, rgba(255, 255, 255, 0.2)) top/100% 1px no-repeat,
                            linear-gradient(to bottom, rgba(255, 255, 255, 0.2), white) right/1px 100% no-repeat,
                            linear-gradient(to right, white, white) bottom/100% 1px no-repeat
                          `
                        }}></div>
                      </div>
                    ) : null}
                    <div 
                      className="relative w-24 h-24 bg-transparent flex items-center justify-center shadow-lg"
                      style={{ display: sklandData.avatarUrl ? 'none' : 'flex' }}
                    >
                      <span className="text-4xl font-bold text-white">{sklandData.nickname.charAt(0)}</span>
                      <div className="absolute inset-0 pointer-events-none" style={{
                        background: `
                          linear-gradient(to bottom, rgba(255, 255, 255, 0.2), white) left/1px 100% no-repeat,
                          linear-gradient(to right, white, rgba(255, 255, 255, 0.2)) top/100% 1px no-repeat,
                          linear-gradient(to bottom, rgba(255, 255, 255, 0.2), white) right/1px 100% no-repeat,
                          linear-gradient(to right, white, white) bottom/100% 1px no-repeat
                        `
                      }}></div>
                    </div>
                    {/* PC端：等级徽章在头像左上角 */}
                    <div className="hidden sm:flex absolute top-0 left-0 -translate-x-1/2 -translate-y-1/3 w-11 h-11 rounded-full border-2 border-amber-400 bg-black/60 items-center justify-center shadow-lg">
                      <div className="text-center">
                        <div className="text-base font-medium text-white leading-none tracking-wider">{sklandData.level}</div>
                        <div className="text-[11px] text-white font-medium leading-none mt-0.5">Lv</div>
                      </div>
                    </div>
                    <div className="mt-3 w-24 text-center">
                      <div className="text-xs text-white font-medium px-2 py-1" style={{ backgroundColor: '#0277BD' }}>雇佣干员进度</div>
                      <div className="text-[8px] text-gray-600 dark:text-gray-400 uppercase tracking-wider font-bold -mt-0.5">Human Resource</div>
                      <div className="text-3xl font-bold text-white mt-0.5">{sklandData.chars.total}</div>
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h2 className="text-2xl font-bold text-gray-900 dark:text-white truncate">{sklandData.nickname}</h2>
                      {/* 手机端：等级徽章在用户名右边 */}
                      <div className="sm:hidden flex-shrink-0 w-11 h-11 rounded-full border-2 border-amber-400 bg-black/60 flex items-center justify-center shadow-lg">
                        <div className="text-center">
                          <div className="text-base font-medium text-white leading-none tracking-wider">{sklandData.level}</div>
                          <div className="text-[11px] text-white font-medium leading-none mt-0.5">Lv</div>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400 mb-4 flex-wrap">
                      <span className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded-lg font-mono text-xs">ID: {sklandData.uid}</span>
                      <span>·</span>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center rounded-sm overflow-hidden">
                          <span className="px-1 py-0.5 text-sm" style={{ backgroundColor: '#0277BD', color: '#ffffff' }}>入职日</span>
                          <span className="px-1 py-0.5 text-gray-900 dark:text-white text-sm bg-white dark:bg-gray-700">
                            {formatRegisterDate(sklandData.registerTs)}
                          </span>
                        </div>
                        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: '#0277BD' }}></div>
                        <div className="w-4 h-4 rounded-full border-[3px]" style={{ borderColor: '#0277BD' }}></div>
                        <svg style={{ width: '18px', height: '18px' }} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="5" strokeLinecap="round">
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </div>
                    </div>

                    <div className="mt-4 flex gap-4 flex-wrap">
                      {/* 助战干员 */}
                      <div className="p-3 border border-white/20 dark:border-white/10 rounded-xl bg-white/50 dark:bg-white/5 inline-block">
                        <div className="flex flex-col gap-3">
                          {/* 标题区域 */}
                          <div className="flex items-center gap-2">
                            <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 515.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                            </svg>
                            <div>
                              <div className="text-sm font-bold text-gray-900 dark:text-white">助战干员</div>
                              <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider leading-none">Support</div>
                            </div>
                          </div>
                          {/* 干员头像区域 */}
                          <div className="flex gap-2 overflow-x-auto">
                            {sklandData.assistChars && sklandData.assistChars.length > 0 ? (
                              sklandData.assistChars.map((char, index) => (
                                <div key={index} className="flex-shrink-0">
                                  <div className="relative">
                                    <div className="w-20 h-20 overflow-hidden bg-transparent flex items-center justify-center relative">
                                      <img 
                                        src={`https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/avatar/${char.skinId || char.charId}.png`}
                                        alt={char.name}
                                        className="w-full h-full object-cover"
                                        onError={(e) => {
                                          const target = e.target as HTMLImageElement
                                          const currentSrc = target.src
                                          const skinId = char.skinId || char.charId
                                          if (currentSrc.includes(skinId) && char.skinId && char.skinId !== char.charId) {
                                            target.src = `https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/avatar/${char.charId}.png`
                                          } else if (!currentSrc.includes('_2.png') && !currentSrc.includes('_1.png')) {
                                            target.src = `https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/avatar/${char.charId}_2.png`
                                          } else if (currentSrc.includes('_2.png')) {
                                            target.src = `https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/avatar/${char.charId}_1.png`
                                          } else {
                                            target.style.display = 'none'
                                            const fallback = target.nextElementSibling as HTMLElement
                                            if (fallback) fallback.style.display = 'flex'
                                          }
                                        }}
                                      />
                                      <div 
                                        className="w-full h-full absolute inset-0 flex items-center justify-center text-white text-xl font-bold"
                                        style={{ display: 'none' }}
                                      >
                                        {char.name.charAt(0)}
                                      </div>
                                      <div className="absolute inset-0 pointer-events-none" style={{
                                        background: `
                                          linear-gradient(to bottom, rgba(255, 255, 255, 0.2), white) left/1px 100% no-repeat,
                                          linear-gradient(to right, white, rgba(255, 255, 255, 0.2)) top/100% 1px no-repeat,
                                          linear-gradient(to bottom, rgba(255, 255, 255, 0.2), white) right/1px 100% no-repeat,
                                          linear-gradient(to right, white, white) bottom/100% 1px no-repeat
                                        `
                                      }}></div>
                                    </div>
                                    <div className="absolute top-1 left-1 flex flex-col items-center">
                                      <span className="text-[8px] font-medium text-white leading-none">Lv</span>
                                      <span className="text-xs font-medium text-white leading-none">{char.level}</span>
                                    </div>
                                  </div>
                                  <div className="text-xs text-center text-gray-700 dark:text-gray-300 font-medium mt-1 truncate max-w-[80px]">
                                    {char.name}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="text-xs text-gray-400 dark:text-gray-500">暂无助战干员</div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* 剿灭作战卡片 */}
                      {sklandData.campaign && (
                        <div className="p-3 border border-white/20 dark:border-white/10 rounded-xl bg-white/50 dark:bg-white/5 inline-block">
                          <div className="flex flex-col gap-3">
                            <div className="flex items-center gap-2">
                              <div className="w-1 h-5 bg-gradient-to-b from-red-500 to-orange-500 rounded-full"></div>
                              <h3 className="text-sm font-bold text-gray-900 dark:text-white">剿灭作战</h3>
                            </div>

                            <div className="space-y-3">
                              {/* 奖励进度 */}
                              <div className="flex items-center justify-between gap-4">
                                <div className="flex-1">
                                  <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">合成玉奖励</div>
                                  <div className="text-xl font-bold text-gray-900 dark:text-white">
                                    {sklandData.campaign.reward.current}
                                    <span className="text-sm text-gray-500 dark:text-gray-400 font-normal">
                                      /{sklandData.campaign.reward.total}
                                    </span>
                                  </div>
                                </div>
                                <div className="w-12 h-12 relative flex-shrink-0">
                                  <svg className="w-12 h-12 transform -rotate-90">
                                    <circle
                                      cx="24"
                                      cy="24"
                                      r="20"
                                      stroke="currentColor"
                                      strokeWidth="3"
                                      fill="none"
                                      className="text-gray-200 dark:text-gray-700"
                                    />
                                    <circle
                                      cx="24"
                                      cy="24"
                                      r="20"
                                      stroke="currentColor"
                                      strokeWidth="3"
                                      fill="none"
                                      className={sklandData.campaign.reward.current >= sklandData.campaign.reward.total ? "text-green-500" : "text-red-500"}
                                      strokeDasharray={`${(sklandData.campaign.reward.current / sklandData.campaign.reward.total) * 125.6} 125.6`}
                                      strokeLinecap="round"
                                    />
                                  </svg>
                                  <div className="absolute inset-0 flex items-center justify-center">
                                    <span className="text-xs font-bold text-gray-900 dark:text-white">
                                      {Math.round((sklandData.campaign.reward.current / sklandData.campaign.reward.total) * 100)}%
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* 状态提示 */}
                              <div className="text-center">
                                {sklandData.campaign.reward.current >= sklandData.campaign.reward.total ? (
                                  <div className="text-xs text-green-600 dark:text-green-400 font-medium">
                                    ✓ 本周奖励已满
                                  </div>
                                ) : (
                                  <div className="text-xs text-orange-600 dark:text-orange-400 font-medium">
                                    周一 04:00 重置
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </Card>



              {/* 2x2 网格布局：实时数据、干员统计、公开招募 */}
              <div className="grid grid-cols-2 gap-5">
                {/* 实时数据卡片 */}
                <Card theme="purple" animated delay={0.2} className="!bg-white dark:!bg-[rgba(15,15,15,0.6)]">
                  <div className="flex items-center gap-2 mb-4 pb-2 border-b border-white/10 dark:border-white/5">
                    <div className="w-1 h-5 bg-gradient-to-b from-purple-500 to-fuchsia-500 rounded-full"></div>
                    <h3 className="text-base font-bold text-gray-900 dark:text-white">实时数据</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-cyan-500/5 dark:bg-cyan-500/10 border border-cyan-500/20 dark:border-cyan-500/10 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1">
                          <svg className="w-4 h-4 text-cyan-600 dark:text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          <span className="text-xs font-bold text-cyan-600 dark:text-cyan-400">理智</span>
                        </div>
                        <span className="text-xs text-cyan-600 dark:text-cyan-400 font-medium">
                          {sklandData.ap.current >= sklandData.ap.max ? '已满' : formatFullRecoveryTime(sklandData.ap.completeRecoveryTime)}
                        </span>
                      </div>
                      <div className="text-xl font-bold text-gray-900 dark:text-white mb-1">
                        {sklandData.ap.current}
                        <span className="text-sm text-gray-500 dark:text-gray-400 font-normal">/{sklandData.ap.max}</span>
                      </div>
                      <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-500"
                          style={{ width: `${(sklandData.ap.current / sklandData.ap.max) * 100}%` }}
                        ></div>
                      </div>
                    </div>

                    <div className="bg-purple-500/5 dark:bg-purple-500/10 border border-purple-500/20 dark:border-purple-500/10 rounded-xl p-3">
                      <div className="text-xs font-bold text-purple-600 dark:text-purple-400 mb-1">无人机</div>
                      <div className="text-xl font-bold text-gray-900 dark:text-white mb-1">
                        {sklandData.building.labor.value}
                        <span className="text-sm text-gray-500 dark:text-gray-400 font-normal">/{sklandData.building.labor.maxValue}</span>
                      </div>
                      <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-gradient-to-r from-purple-500 to-fuchsia-500 transition-all duration-500"
                          style={{ width: `${(sklandData.building.labor.value / sklandData.building.labor.maxValue) * 100}%` }}
                        ></div>
                      </div>
                    </div>

                    {sklandData.routine && (
                      <>
                        <div className="bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/20 dark:border-emerald-500/10 rounded-xl p-3">
                          <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mb-1">每日任务</div>
                          <div className="text-xl font-bold text-gray-900 dark:text-white mb-1">
                            {sklandData.routine.daily.current}
                            <span className="text-sm text-gray-500 dark:text-gray-400 font-normal">/{sklandData.routine.daily.total}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            {Array.from({ length: sklandData.routine?.daily.total || 0 }).map((_, i) => (
                              <div 
                                key={i} 
                                className={`h-1 flex-1 rounded-full ${i < (sklandData.routine?.daily.current || 0) ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'} transition-all`}
                              ></div>
                            ))}
                          </div>
                        </div>
                        <div className="bg-indigo-500/5 dark:bg-indigo-500/10 border border-indigo-500/20 dark:border-indigo-500/10 rounded-xl p-3">
                          <div className="text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-1">每周任务</div>
                          <div className="text-xl font-bold text-gray-900 dark:text-white mb-1">
                            {sklandData.routine.weekly.current}
                            <span className="text-sm text-gray-500 dark:text-gray-400 font-normal">/{sklandData.routine.weekly.total}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            {Array.from({ length: sklandData.routine?.weekly.total || 0 }).map((_, i) => (
                              <div 
                                key={i} 
                                className={`h-1 flex-1 rounded-full ${i < (sklandData.routine?.weekly.current || 0) ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-600'} transition-all`}
                              ></div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </Card>

                {/* 干员统计卡片 */}
                <Card theme="violet" animated delay={0.25} className="!bg-white dark:!bg-[rgba(15,15,15,0.6)]">
                  <div className="flex items-center gap-2 mb-4 pb-2 border-b border-white/10 dark:border-white/5">
                    <div className="w-1 h-5 bg-gradient-to-b from-rose-500 to-pink-500 rounded-full"></div>
                    <h3 className="text-base font-bold text-gray-900 dark:text-white">干员统计</h3>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-rose-500/5 dark:bg-rose-500/10 border border-rose-500/20 dark:border-rose-500/10 rounded-lg p-2 text-center">
                      <div className="text-xs font-bold text-rose-600 dark:text-rose-400 mb-1">精二干员</div>
                      <div className="text-xl font-bold text-gray-900 dark:text-white">
                        {sklandData.chars.elite2}
                      </div>
                    </div>

                    <div className="bg-pink-500/5 dark:bg-pink-500/10 border border-pink-500/20 dark:border-pink-500/10 rounded-lg p-2 text-center">
                      <div className="text-xs font-bold text-pink-600 dark:text-pink-400 mb-1">满级干员</div>
                      <div className="text-xl font-bold text-gray-900 dark:text-white">
                        {sklandData.chars.maxLevel}
                      </div>
                    </div>

                    <div className="bg-fuchsia-500/5 dark:bg-fuchsia-500/10 border border-fuchsia-500/20 dark:border-fuchsia-500/10 rounded-lg p-2 text-center">
                      <div className="text-xs font-bold text-fuchsia-600 dark:text-fuchsia-400 mb-1">技能7+</div>
                      <div className="text-xl font-bold text-gray-900 dark:text-white">
                        {sklandData.chars.skill7Plus}
                      </div>
                    </div>

                    <div className="bg-violet-500/5 dark:bg-violet-500/10 border border-violet-500/20 dark:border-violet-500/10 rounded-lg p-2 text-center">
                      <div className="text-xs font-bold text-violet-600 dark:text-violet-400 mb-1">干员总数</div>
                      <div className="text-xl font-bold text-gray-900 dark:text-white">
                        {sklandData.chars.total}
                      </div>
                    </div>
                  </div>
                  {/* 干员培养进度条 */}
                  <div className="mt-3 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-600 dark:text-gray-400">精二进度</span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        {Math.round((sklandData.chars.elite2 / sklandData.chars.total) * 100)}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-rose-500 to-pink-500 transition-all duration-500"
                        style={{ width: `${(sklandData.chars.elite2 / sklandData.chars.total) * 100}%` }}
                      ></div>
                    </div>
                  </div>
                </Card>

                {/* 公开招募卡片 */}
                {sklandData.recruit && sklandData.recruit.length > 0 && (
                  <Card theme="amber" animated delay={0.3} className="!bg-white dark:!bg-[rgba(15,15,15,0.6)]">
                    <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/10 dark:border-white/5">
                      <div className="flex items-center gap-2">
                        <div className="w-1 h-5 bg-gradient-to-b from-amber-500 to-orange-500 rounded-full"></div>
                        <h3 className="text-base font-bold text-gray-900 dark:text-white">公开招募</h3>
                      </div>
                      {sklandData.building.hire?.refreshCount !== undefined && (
                        <div className="flex items-center gap-1">
                          <svg className="w-3 h-3 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                            {sklandData.building.hire.refreshCount}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {sklandData.recruit.slice(0, 4).map((slot, index) => {
                        // 森空岛 API 状态说明：
                        // state = -1 或 0: 空闲
                        // state = 1 或 2: 招募中（需要检查 finishTs）
                        // 如果 finishTs 已过期，则视为已完成
                        
                        let displayState: number; // 0=空闲, 1=招募中, 2=已完成
                        
                        if (slot.state === -1 || slot.state === 0) {
                          displayState = 0; // 空闲
                        } else if (!slot.finishTs || slot.finishTs <= 0) {
                          displayState = 0; // 没有有效结束时间，视为空闲
                        } else {
                          const diff = slot.finishTs * 1000 - currentTime;
                          if (diff <= 0) {
                            displayState = 2; // 时间已到，已完成
                          } else {
                            displayState = 1; // 招募中
                          }
                        }
                        // 根据状态和主题设置背景色
                        let backgroundColor: string;
                        if (isDarkMode) {
                          backgroundColor = displayState === 0 
                            ? 'rgba(31, 41, 55, 0.5)' // gray-800/50
                            : displayState === 1 
                            ? 'rgba(30, 58, 138, 0.2)' // blue-900/20
                            : 'rgba(20, 83, 45, 0.2)'; // green-900/20
                        } else {
                          backgroundColor = displayState === 0 
                            ? 'rgb(243, 244, 246)' // gray-100
                            : displayState === 1 
                            ? 'rgb(239, 246, 255)' // blue-50
                            : 'rgb(240, 253, 244)'; // green-50
                        }
                        return (
                          <div 
                            key={index}
                            className="relative border border-white/30 dark:border-white/10 rounded-lg p-2"
                            style={{ backgroundColor }}
                          >
                          {/* 位置编号 - 左上角 */}
                          <div className="absolute top-1 left-1 w-5 h-5 flex items-center justify-center bg-black/20 dark:bg-gray-700/50 rounded text-xs font-bold text-white">
                            {index + 1}
                          </div>

                          {/* 状态标签 - 右上角 */}
                          <div className="flex justify-end mb-1">
                            {displayState === 0 && (
                              <span className="text-xs px-1 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-full">
                                空闲
                              </span>
                            )}
                            {displayState === 1 && (
                              <span className="text-xs px-1 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full">
                                招募中
                              </span>
                            )}
                            {displayState === 2 && (
                              <span className="text-xs px-1 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-full">
                                已完成
                              </span>
                            )}
                          </div>

                          {displayState === 0 && (
                            <div className="text-center py-2">
                              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
                                未开始招募
                              </div>
                            </div>
                          )}

                          {displayState === 1 && (
                            <div className="text-center py-1">
                              <div className="text-xs font-medium text-blue-600 dark:text-blue-400">
                                {formatRecruitTime(slot.finishTs!)}
                              </div>
                              {slot.tags && slot.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1 justify-center mt-1">
                                  {slot.tags.slice(0, 2).map((tag, tagIndex) => (
                                    <span 
                                      key={tagIndex}
                                      className="text-xs px-1 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded"
                                    >
                                      {tag.tagName}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          {displayState === 2 && (
                            <div className="text-center py-1">
                              <div className="text-xs font-bold text-green-600 dark:text-green-400 mb-1">
                                招募完成
                              </div>
                              {slot.tags && slot.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1 justify-center">
                                  {slot.tags.slice(0, 2).map((tag, tagIndex) => (
                                    <span 
                                      key={tagIndex}
                                      className="text-xs px-1 py-0.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded"
                                    >
                                      {tag.tagName}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                      })}
                    </div>
                  </Card>
                )}

                {/* 空的第四个卡片位置 */}
                <div className="bg-white/50 dark:bg-white/5 border border-white/20 dark:border-white/10 rounded-xl p-4 flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">更多功能</div>
                    <div className="text-xs text-gray-400 dark:text-gray-500">敬请期待</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 右列：主线进度 + 基建详情 (flex-1) */}
            <div className="flex-1 flex flex-col gap-5">
              {/* 主线进度卡片 */}
              <Card theme="violet" animated delay={0.35} className="!bg-white dark:!bg-[rgba(15,15,15,0.6)]">
                <div className="flex items-center gap-2 mb-6 pb-3 border-b border-white/10 dark:border-white/5">
                  <div className="w-1 h-6 bg-gradient-to-b from-violet-500 to-purple-500 rounded-full"></div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">主线进度</h3>
                </div>

                <div className="space-y-4">
                  <div className="text-center">
                    <div className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                      {sklandData.mainStageProgress.replace(/^main_/, '')}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      当前主线进度
                    </div>
                  </div>

                  {/* 主线进度条 */}
                  {(() => {
                    // 解析主线进度，支持 "14-21" 或 "main_14-21" 格式
                    const match = sklandData.mainStageProgress?.match(/^(?:main_)?(\d+)-(\d+)$/);
                    if (match && match[1] && match[2]) {
                      const chapter = parseInt(match[1]);
                      const stage = parseInt(match[2]);
                      // 假设每章最多30关，总共16章（可根据实际情况调整）
                      const totalChapters = 16;
                      const maxStagesPerChapter = 30;
                      const totalStages = totalChapters * maxStagesPerChapter;
                      const currentStages = (chapter - 1) * maxStagesPerChapter + stage;
                      const progress = Math.min((currentStages / totalStages) * 100, 100);
                      
                      return (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-gray-600 dark:text-gray-400">第 {chapter} 章</span>
                            <span className="font-medium text-violet-600 dark:text-violet-400">
                              {progress.toFixed(1)}%
                            </span>
                          </div>
                          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-gradient-to-r from-violet-500 to-purple-500 transition-all duration-500 rounded-full"
                              style={{ width: `${progress}%` }}
                            ></div>
                          </div>
                          <div className="text-xs text-center text-gray-500 dark:text-gray-400">
                            已完成 {currentStages} / {totalStages} 关
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })()}

                  {sklandData.stageInfo && (
                    <div className="p-4 bg-violet-500/10 dark:bg-violet-500/10 border border-violet-500/30 dark:border-violet-500/10 rounded-lg">
                      <div className="text-sm font-bold text-violet-600 dark:text-violet-400 mb-2">
                        最近关卡
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-900 dark:text-white font-medium">
                            {sklandData.stageInfo.code}
                          </span>
                          <span className="text-xs text-violet-600 dark:text-violet-400">
                            {sklandData.stageInfo.apCost} 理智
                          </span>
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">
                          {sklandData.stageInfo.name}
                        </div>
                        {sklandData.stageInfo.difficulty && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs px-2 py-0.5 bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 rounded">
                              {sklandData.stageInfo.difficulty}
                            </span>
                            {sklandData.stageInfo.dangerLevel && (
                              <span className="text-xs px-2 py-0.5 bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 rounded">
                                危险等级 {sklandData.stageInfo.dangerLevel}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </Card>

              {/* 基建详情卡片 */}
              <Card theme="emerald" animated delay={0.4} className="!bg-white dark:!bg-[rgba(15,15,15,0.6)]">
                <div className="flex items-center gap-2 mb-6 pb-3 border-b border-white/10 dark:border-white/5">
                  <div className="w-1 h-6 bg-gradient-to-b from-emerald-500 to-teal-500 rounded-full"></div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">基建详情</h3>
                </div>

                <div className="space-y-4">
                  {/* 制造站 */}
                  {sklandData.building.manufactures && sklandData.building.manufactures.length > 0 && (
                    <div>
                      <div className="text-sm font-bold text-gray-900 dark:text-white mb-2">制造站</div>
                      <div className="grid grid-cols-1 gap-2">
                        {sklandData.building.manufactures.map((mfg: any, index: number) => {
                          // 计算产出完成时间
                          const remainSecs = mfg.remain || mfg.outputProgress?.remain || 0
                          const isComplete = remainSecs <= 0 && mfg.complete >= mfg.capacity
                          const isProducing = remainSecs > 0
                          const completeTime = remainSecs > 0 ? new Date(Date.now() + remainSecs * 1000) : null

                          return (
                          <div key={index} className={`p-3 rounded-lg border ${
                            isComplete
                              ? 'bg-green-500/10 border-green-500/30'
                              : isProducing
                              ? 'bg-emerald-500/10 border-emerald-500/30'
                              : 'bg-gray-500/10 border-gray-500/30'
                          }`}>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                  {mfg.formulaName || mfg.itemName || mfg.name || '制造中'}
                                </span>
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  Lv.{mfg.level || 1}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                {mfg.speed && (
                                  <span className="text-xs px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 rounded font-medium">
                                    {mfg.speed}x
                                  </span>
                                )}
                                <span className="text-xs text-emerald-600 dark:text-emerald-400">
                                  {mfg.workers?.length || 0}人
                                </span>
                              </div>
                            </div>
                            {mfg.capacity !== undefined && mfg.complete !== undefined && (
                              <div className="mt-2">
                                <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
                                  <span>库存</span>
                                  <div className="flex items-center gap-2">
                                    <span>{mfg.complete}/{mfg.capacity}</span>
                                    {isComplete && (
                                      <span className="text-green-500 font-medium">✓ 已满</span>
                                    )}
                                    {isProducing && (
                                      <span className="text-emerald-500">
                                        {Math.floor(remainSecs / 3600)}:{String(Math.floor((remainSecs % 3600) / 60)).padStart(2, '0')}:{String(Math.floor(remainSecs % 60)).padStart(2, '0')}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full transition-all duration-500 ${isComplete ? 'bg-green-500' : 'bg-emerald-500'}`}
                                    style={{ width: `${Math.min((mfg.complete / mfg.capacity) * 100, 100)}%` }}
                                  ></div>
                                </div>
                                {completeTime && (
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-right">
                                    预计 {completeTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 完成
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* 贸易站 */}
                  {sklandData.building.tradings && sklandData.building.tradings.length > 0 && (
                    <div>
                      <div className="text-sm font-bold text-gray-900 dark:text-white mb-2">贸易站</div>
                      <div className="grid grid-cols-1 gap-2">
                        {sklandData.building.tradings.map((trade: any, index: number) => {
                          // 计算订单完成时间
                          const orderCount = trade.stock?.length || 0
                          const isFull = orderCount >= (trade.stockLimit || 4)
                          let remainSecs = 0
                          let completeTime: Date | null = null
                          if (trade.completeWorkTime && trade.completeWorkTime > Date.now() / 1000) {
                            remainSecs = trade.completeWorkTime - Date.now() / 1000
                            completeTime = new Date(trade.completeWorkTime * 1000)
                          }

                          return (
                          <div key={index} className={`p-3 rounded-lg border ${
                            isFull
                              ? 'bg-green-500/10 border-green-500/30'
                              : remainSecs > 0
                              ? 'bg-blue-500/10 border-blue-500/30'
                              : 'bg-gray-500/10 border-gray-500/30'
                          }`}>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                                  {trade.orderProgress?.strategy || trade.strategy || '贸易策略'}
                                </span>
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  Lv.{trade.level || 1}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-blue-600 dark:text-blue-400">
                                  {trade.workers?.length || 0}人
                                </span>
                              </div>
                            </div>
                            {/* 订单进度 */}
                            <div className="mt-2">
                              <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
                                <span>订单</span>
                                <div className="flex items-center gap-2">
                                  <span>{orderCount}/{trade.stockLimit || 4}</span>
                                  {isFull && (
                                    <span className="text-green-500 font-medium">✓ 已满</span>
                                  )}
                                  {remainSecs > 0 && !isFull && (
                                    <span className="text-blue-500">
                                      {Math.floor(remainSecs / 3600)}:{String(Math.floor((remainSecs % 3600) / 60)).padStart(2, '0')}:{String(Math.floor(remainSecs % 60)).padStart(2, '0')}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                <div
                                  className={`h-full transition-all duration-500 ${isFull ? 'bg-green-500' : 'bg-blue-500'}`}
                                  style={{ width: `${Math.min((orderCount / (trade.stockLimit || 4)) * 100, 100)}%` }}
                                ></div>
                              </div>
                              {completeTime && !isFull && (
                                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-right">
                                  预计 {completeTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 完成
                                </div>
                              )}
                            </div>
                          </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* 会客室 */}
                  {sklandData.building.meeting && (
                    <div>
                      <div className="text-sm font-bold text-gray-900 dark:text-white mb-2">会客室</div>
                      <div className="p-3 bg-purple-500/10 dark:bg-purple-500/10 border border-purple-500/20 dark:border-purple-500/10 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-purple-600 dark:text-purple-400">
                              线索 {sklandData.building.meeting.clue?.own || 0}/9
                            </span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              Lv.{sklandData.building.meeting.level || 1}
                            </span>
                          </div>
                          <div className="text-xs text-purple-600 dark:text-purple-400">
                            {sklandData.building.meeting.workers?.length || 0}人
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* 宿舍 */}
                  {sklandData.building.dormitories && sklandData.building.dormitories.length > 0 && (
                    <div>
                      <div className="text-sm font-bold text-gray-900 dark:text-white mb-2">宿舍</div>
                      <div className="grid grid-cols-2 gap-2">
                        {sklandData.building.dormitories.map((dorm: any, index: number) => {
                          // 计算宿舍心情状态
                          const workers = dorm.workers || dorm.chars || []
                          const avgMood = workers.length > 0
                            ? workers.reduce((sum: number, w: any) => sum + Math.floor((w.ap || 0) / 86400), 0) / workers.length
                            : 0
                          const moodPercent = Math.min((avgMood / 24) * 100, 100)

                          // 心情状态 - 使用粉色系渐变
                          let moodGradient = 'from-pink-400 to-rose-500'
                          let moodText = '精力充沛'
                          if (moodPercent < 30) {
                            moodGradient = 'from-rose-300 to-pink-400'
                            moodText = '疲惫'
                          } else if (moodPercent < 50) {
                            moodGradient = 'from-pink-300 to-rose-400'
                            moodText = '休息中'
                          } else if (moodPercent < 80) {
                            moodGradient = 'from-pink-400 to-fuchsia-500'
                            moodText = '恢复中'
                          }

                          return (
                          <div key={index} className="p-3 bg-pink-500/10 dark:bg-pink-500/10 border border-pink-500/20 dark:border-pink-500/10 rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-pink-600 dark:text-pink-400">
                                  宿舍{index + 1}
                                </span>
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  Lv.{dorm.level || 1}
                                </span>
                              </div>
                              <span className="text-xs text-pink-600 dark:text-pink-400">
                                {workers.length}/5人
                              </span>
                            </div>
                            {/* 心情进度 */}
                            {workers.length > 0 ? (
                              <div>
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className="text-xs text-gray-500 dark:text-gray-400">心情</span>
                                  <div className="flex items-center gap-1.5">
                                    <span className={`text-xs font-medium bg-gradient-to-r ${moodGradient} bg-clip-text text-transparent`}>
                                      {moodText}
                                    </span>
                                    <span className="text-xs text-gray-600 dark:text-gray-300 font-medium">
                                      {Math.round(avgMood)}/24
                                    </span>
                                  </div>
                                </div>
                                <div className="h-2 bg-pink-100/50 dark:bg-pink-900/20 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full bg-gradient-to-r ${moodGradient} transition-all duration-500 rounded-full`}
                                    style={{ width: `${moodPercent}%` }}
                                  ></div>
                                </div>
                              </div>
                            ) : (
                              <div className="text-xs text-gray-400 text-center py-1">空闲</div>
                            )}
                          </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* 训练室 */}
                  {sklandData.building.training && (
                    <div>
                      <div className="text-sm font-bold text-gray-900 dark:text-white mb-2">训练室</div>
                      <div className={`p-3 rounded-lg border ${
                        sklandData.building.training.trainee
                          ? (sklandData.building.training.remainSecs || 0) <= 0
                            ? 'bg-green-500/10 border-green-500/30'
                            : 'bg-orange-500/10 border-orange-500/30'
                          : 'bg-gray-500/10 border-gray-500/30'
                      }`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-medium ${
                              sklandData.building.training.trainee
                                ? (sklandData.building.training.remainSecs || 0) <= 0
                                  ? 'text-green-600 dark:text-green-400'
                                  : 'text-orange-600 dark:text-orange-400'
                                : 'text-gray-600 dark:text-gray-400'
                            }`}>
                              {sklandData.building.training.trainee ? (
                                (sklandData.building.training.remainSecs || 0) <= 0 ? '训练完成' : '训练中'
                              ) : '空闲'}
                            </span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              Lv.{sklandData.building.training.level || 1}
                            </span>
                          </div>
                          {/* 训练进度 */}
                          {sklandData.building.training.trainee && (sklandData.building.training.remainSecs || 0) > 0 && (
                            <div className="text-right">
                              <div className="text-xs text-orange-600 dark:text-orange-400 font-medium">
                                {Math.floor((sklandData.building.training.remainSecs || 0) / 3600)}:{String(Math.floor(((sklandData.building.training.remainSecs || 0) % 3600) / 60)).padStart(2, '0')}:{String(Math.floor((sklandData.building.training.remainSecs || 0) % 60)).padStart(2, '0')}
                              </div>
                            </div>
                          )}
                        </div>
                        {/* 训练详情 */}
                        {sklandData.building.training.trainee && (
                          <div className="mt-2 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-gray-600 dark:text-gray-400">
                                学员: {sklandData.building.training.trainee.name || sklandData.building.training.trainee.charId}
                              </span>
                              {sklandData.building.training.trainer && (
                                <span className="text-gray-600 dark:text-gray-400">
                                  教官: {sklandData.building.training.trainer.name || sklandData.building.training.trainer.charId}
                                </span>
                              )}
                            </div>
                            {/* 训练进度条 */}
                            {(sklandData.building.training.remainSecs || 0) > 0 && (
                              <>
                                <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-gradient-to-r from-orange-500 to-red-500 transition-all duration-500"
                                    style={{
                                      width: `${Math.max(0, 100 - ((sklandData.building.training.remainSecs || 0) / (24 * 3600)) * 100)}%`
                                    }}
                                  ></div>
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 text-right">
                                  预计 {new Date(Date.now() + (sklandData.building.training.remainSecs || 0) * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 完成
                                </div>
                              </>
                            )}
                            {/* 训练完成提示 */}
                            {(sklandData.building.training.remainSecs || 0) <= 0 && sklandData.building.training.trainee && (
                              <div className="text-xs text-green-500 font-medium text-center">
                                ✓ 技能专精训练已完成
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* 最后更新时间 */}
        {lastUpdate && (
          <div className="text-center text-sm text-gray-500 dark:text-gray-400">
            最后更新: {lastUpdate.toLocaleString('zh-CN')}
          </div>
        )}
      </div>
    </div>
  )
}