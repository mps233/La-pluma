import { useState, useEffect } from 'react'
import { maaApi } from '../services/api'
import { motion } from 'framer-motion'
import Icons from './Icons'
import ScreenMonitor from './ScreenMonitor'
import NotificationSettings from './NotificationSettings'
import { PageHeader, Button } from './common'
import { useStatusStore } from '../store/statusStore'
import FloatingStatusIndicator from './FloatingStatusIndicator'
import type {
  AutomationTasksProps,
  AutomationAvailableTask,
  TaskFlowItem,
  ConnectionTestStatus,
  StageConfig
} from '@/types/components'

export default function AutomationTasks({}: AutomationTasksProps) {
  const { setMessage: setStatusMessage, setActive: setIsActiveStatus } = useStatusStore()

  // 辅助函数：显示消息
  const showSuccess = async (msg: string) => {
    setStatusMessage(msg)
    await new Promise(resolve => setTimeout(resolve, 1500))
    setStatusMessage('')
  }
  const showError = async (msg: string) => {
    setStatusMessage(msg)
    await new Promise(resolve => setTimeout(resolve, 2000))
    setStatusMessage('')
  }
  const showInfo = (msg: string) => {
    setStatusMessage(msg)
  }

  const [isRunning, setIsRunning] = useState(false)
  const [taskFlow, setTaskFlow] = useState<TaskFlowItem[]>([])
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [scheduleTimes, setScheduleTimes] = useState<string[]>(['08:00', '14:00', '20:00'])
  const [currentStep, setCurrentStep] = useState(-1)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const [currentActivity, setCurrentActivity] = useState<any>(null)
  const [activityName, setActivityName] = useState<string | null>(null)
  const [notificationSettingsOpen, setNotificationSettingsOpen] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<Record<string, ConnectionTestStatus>>({})
  const [testingConnection, setTestingConnection] = useState<Record<string, boolean>>({})

  // 轮询定时任务执行状态
  useEffect(() => {
    let intervalId = null
    let isSubscribed = true // 用于防止组件卸载后的状态更新
    
    const checkScheduleStatus = async () => {
      if (!isSubscribed) return
      
      try {
        const result = await maaApi.getScheduleExecutionStatus()
        if (!isSubscribed) return // 再次检查
        
        if (result.success && result.data) {
          const status = result.data

          // 如果定时任务正在运行，更新 UI 状态
          if (status.isRunning) {
            setIsRunning(true)
            setIsActiveStatus(true)

            // 根据任务 ID 找到在 taskFlow 中的实际索引
            if (status.currentTaskId) {
              setCurrentStep(prev => {
                const actualIndex = taskFlow.findIndex(t => t.id === status.currentTaskId)
                return actualIndex !== -1 ? actualIndex : prev
              })
            } else {
              setCurrentStep(status.currentStep)
            }

            setStatusMessage(status.message || `正在执行: ${status.currentTask}`)
          } else {
            setIsActiveStatus(false)
            setIsRunning(prev => {
              if (prev) {
                // 定时任务刚完成
                setCurrentStep(-1)

              }
              return false
            })
          }
        }
      } catch (error) {
        // 静默失败，不影响用户体验
      }
    }
    
    // 每秒检查一次
    intervalId = setInterval(checkScheduleStatus, 1000)
    checkScheduleStatus() // 立即执行一次
    
    return () => {
      isSubscribed = false
      if (intervalId) clearInterval(intervalId)
    }
  }, [taskFlow]) // 只依赖 taskFlow

  // 可用的任务列表
  const availableTasks: AutomationAvailableTask[] = [
    { 
      id: 'startup' as const, 
      name: '启动游戏', 
      icon: <Icons.Play />,
      description: '启动游戏并进入主界面',
      defaultParams: { 
        clientType: 'Official',
        adbPath: '/opt/homebrew/bin/adb',
        address: '127.0.0.1:16384',
        accountName: ''
      },
      paramFields: [
        { key: 'clientType', label: '客户端类型', type: 'select', options: [
          { value: 'Official', label: '官服' },
          { value: 'Bilibili', label: 'B服' },
          { value: 'YoStarEN', label: '美服' },
          { value: 'YoStarJP', label: '日服' },
          { value: 'YoStarKR', label: '韩服' },
          { value: 'Txwy', label: '繁中服' }
        ]},
        { key: 'accountName', label: '切换账号', type: 'text', placeholder: '留空则不切换', helper: '输入已登录账号的部分字符即可，如 "123****4567" 可输入 "4567"' },
        { key: 'adbPath', label: 'ADB 路径', type: 'text', placeholder: '/opt/homebrew/bin/adb', helper: 'macOS 默认路径' },
        { key: 'address', label: '连接地址', type: 'text', placeholder: '127.0.0.1:16384', helper: 'MuMu 模拟器默认端口：16384' }
      ]
    },
    { 
      id: 'fight' as const, 
      name: '理智作战', 
      icon: <Icons.Sword />,
      description: '自动刷关卡消耗理智',
      defaultParams: { stage: '1-7', stages: [{ stage: '1-7', times: '' }], medicine: 0, expiringMedicine: 0, stone: 0, series: '1' },
      paramFields: [
        { key: 'stages', label: '关卡', type: 'multi-stages', placeholder: '1-7 或 HD-7', timesPlaceholder: '次数', helper: '使用 HD-数字 代表当前活动关卡，点击 + 添加更多关卡' },
        { key: 'medicine', label: '理智药', type: 'number', placeholder: '0', helper: '使用理智药数量' },
        { key: 'expiringMedicine', label: '过期理智药', type: 'number', placeholder: '0', helper: '优先使用 48 小时内过期的理智药' },
        { key: 'stone', label: '源石', type: 'number', placeholder: '0', helper: '使用源石数量' },
        { key: 'series', label: '连战', type: 'select', options: [
          { value: '-1', label: '禁用' },
          { value: '0', label: '自动' },
          { value: '1', label: '1次' },
          { value: '2', label: '2次' },
          { value: '3', label: '3次' },
          { value: '4', label: '4次' },
          { value: '5', label: '5次' },
          { value: '6', label: '6次' }
        ], helper: '单次代理作战重复次数（需要游戏支持）' },
      ]
    },
    { 
      id: 'infrast' as const, 
      name: '基建换班', 
      icon: <Icons.Building />,
      description: '自动基建换班收菜',
      defaultParams: { 
        mode: '0',
        facility: ['Mfg', 'Trade', 'Power', 'Control', 'Reception', 'Office', 'Dorm'],
        drones: 'Money',
        threshold: '0.3',
        replenish: false
      },
      paramFields: [
        { key: 'mode', label: '换班模式', type: 'select', options: [
          { value: '0', label: '默认换班' },
          { value: '10000', label: '自定义换班' }
        ]},
        { key: 'facility', label: '设施选择', type: 'facility-select', helper: '选择要换班的设施' },
        { key: 'drones', label: '无人机用途', type: 'select', options: [
          { value: 'Money', label: '龙门币' },
          { value: 'SyntheticJade', label: '合成玉' },
          { value: 'CombatRecord', label: '作战记录' },
          { value: 'PureGold', label: '赤金' },
          { value: 'OriginStone', label: '源石碎片' },
          { value: 'Chip', label: '芯片' }
        ]},
        { key: 'threshold', label: '心情阈值', type: 'number', placeholder: '0.3', step: '0.1', min: '0', max: '1' },
        { key: 'replenish', label: '自动补货', type: 'checkbox' },
      ],
      taskType: 'Infrast'
    },
    { 
      id: 'recruit' as const, 
      name: '自动公招', 
      icon: <Icons.Users />,
      description: '自动公开招募',
      defaultParams: {
        refresh: true,
        select: [4, 5, 6],
        confirm: [3, 4],
        times: '4',
        set_time: true,
        expedite: false,
        expedite_times: 0,
        skip_robot: true
      },
      paramFields: [
        { key: 'refresh', label: '刷新标签', type: 'checkbox' },
        { key: 'select', label: '招募星级', type: 'star-select', helper: '选择要招募的干员星级' },
        { key: 'confirm', label: '确认星级', type: 'star-select', helper: '选择招募完成后自动确认的干员星级' },
        { key: 'times', label: '招募次数', type: 'number', placeholder: '4' },
        { key: 'set_time', label: '设置时间', type: 'checkbox' },
        { key: 'expedite', label: '使用加急', type: 'checkbox' },
        { key: 'expedite_times', label: '加急次数', type: 'number', placeholder: '0' },
        { key: 'skip_robot', label: '跳过小车', type: 'checkbox' },
      ],
      taskType: 'Recruit'
    },
    { 
      id: 'mall' as const, 
      name: '信用收支', 
      icon: <Icons.Cash />,
      description: '访问好友、收取信用',
      defaultParams: {
        shopping: true,
        buy_first: '',
        blacklist: '',
        force_shopping_if_credit_full: false
      },
      paramFields: [
        { key: 'shopping', label: '自动购物', type: 'checkbox' },
        { key: 'buy_first', label: '优先购买', type: 'text', placeholder: '招聘许可,龙门币（逗号分隔）' },
        { key: 'blacklist', label: '黑名单', type: 'text', placeholder: '家具,碳（逗号分隔）' },
        { key: 'force_shopping_if_credit_full', label: '信用满强制购物', type: 'checkbox' },
      ],
      taskType: 'Mall'
    },
    { 
      id: 'award' as const, 
      name: '领取奖励', 
      icon: <Icons.Gift />,
      description: '领取每日/每周奖励',
      defaultParams: {
        award: true,
        mail: true,
        recruit: false,
        orundum: false,
        mining: false,
        specialaccess: false
      },
      paramFields: [
        { key: 'award', label: '每日奖励', type: 'checkbox' },
        { key: 'mail', label: '邮件奖励', type: 'checkbox' },
        { key: 'recruit', label: '公招奖励', type: 'checkbox' },
        { key: 'orundum', label: '合成玉奖励', type: 'checkbox' },
        { key: 'mining', label: '采矿奖励', type: 'checkbox' },
        { key: 'specialaccess', label: '特别通行证', type: 'checkbox' },
      ],
      taskType: 'Award'
    },
    { 
      id: 'closedown' as const, 
      name: '关闭游戏', 
      icon: <Icons.Stop />,
      description: '关闭游戏客户端',
      defaultParams: { clientType: 'Official' },
      paramFields: [
        { key: 'clientType', label: '客户端类型', type: 'select', options: [
          { value: 'Official', label: '官服' },
          { value: 'Bilibili', label: 'B服' },
          { value: 'YoStarEN', label: '美服' },
          { value: 'YoStarJP', label: '日服' },
          { value: 'YoStarKR', label: '韩服' },
          { value: 'Txwy', label: '繁中服' }
        ]}
      ]
    },
  ]

  const addTaskToFlow = (task: AutomationAvailableTask) => {
    const newFlow = [...taskFlow, {
      ...task,
      params: { ...task.defaultParams },
      enabled: true,
      commandId: task.id,
      id: `${task.id}-${Date.now()}`
    }]
    setTaskFlow(newFlow)
    autoSave(newFlow, scheduleEnabled, scheduleTimes)
  }

  const removeTaskFromFlow = (index: number) => {
    const newFlow = taskFlow.filter((_, i) => i !== index)
    setTaskFlow(newFlow)
    autoSave(newFlow, scheduleEnabled, scheduleTimes)
  }

  const toggleTaskEnabled = (index: number) => {
    const newFlow = [...taskFlow]
    const task = newFlow[index]
    if (task) {
      task.enabled = !task.enabled
      setTaskFlow(newFlow)
      autoSave(newFlow, scheduleEnabled, scheduleTimes)
    }
  }

  // moveTask 函数已被拖拽功能替代，已移除

  const handleDragStart = (index: number) => {
    setDraggedIndex(index)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (draggedIndex === null || draggedIndex === index) return
    
    const newFlow = [...taskFlow]
    const draggedItem = newFlow[draggedIndex]
    if (!draggedItem) return
    
    newFlow.splice(draggedIndex, 1)
    newFlow.splice(index, 0, draggedItem)
    
    setTaskFlow(newFlow)
    setDraggedIndex(index)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
    autoSave(taskFlow, scheduleEnabled, scheduleTimes)
  }

  const updateTaskParam = (index: number, key: string, value: any) => {
    const newFlow = [...taskFlow]
    const currentTask = newFlow[index]
    if (!currentTask) return
    
    // 如果修改的是 stages 参数，需要对关卡进行排序
    if (key === 'stages' && Array.isArray(value)) {
      // 分类：置顶关卡、智能养成关卡、普通关卡
      const pinnedStages = value.filter((s): s is StageConfig => 
        typeof s === 'object' && s.pinned === true && !!s.stage && s.stage.trim() !== ''
      );
      const smartStages = value.filter((s): s is StageConfig => 
        typeof s === 'object' && s.smart === true && !!s.stage && s.stage.trim() !== ''
      );
      const normalStages = value.filter((s): s is string | StageConfig => 
        (typeof s === 'string' && s.trim() !== '') || 
        (typeof s === 'object' && !s.pinned && !s.smart && !!s.stage && s.stage.trim() !== '')
      );
      
      // 重新组合：置顶 -> 智能养成 -> 普通
      currentTask.params[key] = [...pinnedStages, ...smartStages, ...normalStages];
    } else {
      currentTask.params[key] = value;
    }
    
    // 如果修改的是启动游戏的客户端类型，同步到关闭游戏
    if (currentTask.commandId === 'startup' && key === 'clientType') {
      newFlow.forEach((task, i) => {
        if (task.commandId === 'closedown' && newFlow[i]) {
          newFlow[i]!.params.clientType = value
        }
      })
    }
    // 如果修改的是关闭游戏的客户端类型，同步到启动游戏
    else if (currentTask.commandId === 'closedown' && key === 'clientType') {
      newFlow.forEach((task, i) => {
        if (task.commandId === 'startup' && newFlow[i]) {
          newFlow[i]!.params.clientType = value
        }
      })
    }
    
    setTaskFlow(newFlow)
    autoSave(newFlow, scheduleEnabled, scheduleTimes)
  }

  const testConnection = async (taskId: string, adbPath: string, address: string) => {
    setTestingConnection(prev => ({ ...prev, [taskId]: true }))
    setConnectionStatus(prev => ({ ...prev, [taskId]: { success: false, message: '' } }))
    
    try {
      const result = await maaApi.testConnection(adbPath, address)
      setConnectionStatus(prev => ({ ...prev, [taskId]: result as ConnectionTestStatus }))
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : '未知错误'
      setConnectionStatus(prev => ({ 
        ...prev, 
        [taskId]: { 
          success: false, 
          message: '测试失败: ' + errorMessage
        } 
      }))
    } finally {
      setTestingConnection(prev => ({ ...prev, [taskId]: false }))
    }
  }

  const autoSave = async (flow: TaskFlowItem[], enabled: boolean, times: string[]) => {
    const taskFlowToSave = flow.map(task => {
      const { icon, paramFields, ...rest } = task
      return rest
    })
    
    // 保存到 localStorage（快速访问）
    localStorage.setItem('maa-task-flow', JSON.stringify(taskFlowToSave))
    localStorage.setItem('maa-schedule', JSON.stringify({ enabled, times }))
    
    // 保存到服务器（跨设备同步）
    try {
      await maaApi.saveUserConfig('automation-tasks', {
        taskFlow: taskFlowToSave,
        schedule: { enabled, times }
      })
    } catch (error) {
      // 静默失败，不影响用户体验
    }
    
    if (enabled && times.length > 0) {
      try {
        await maaApi.setupSchedule('default', times, taskFlowToSave)
      } catch (error) {
        // 静默失败，不影响用户体验
      }
    } else {
      try {
        await maaApi.stopSchedule('default')
      } catch (error) {
        // 静默失败，不影响用户体验
      }
    }
  }

  const buildCommand = (task: TaskFlowItem) => {
    if (task.taskType) {
      const params = task.params || {}
      const taskConfig: any = {
        name: task.name,
        type: task.taskType,
        params: {}
      }
      
      // 某些字段应该保持字符串格式，不要转换为数字
      const keepAsString = ['mode']
      
      Object.keys(params).forEach(key => {
        const value = params[key]
        if (value === undefined || value === '' || value === null) return
        
        if (typeof value === 'boolean') {
          taskConfig.params[key] = value
        }
        else if (Array.isArray(value)) {
          if (value.length > 0) {
            taskConfig.params[key] = value
          }
        }
        else if (typeof value === 'string' && value.trim().startsWith('[') && value.trim().endsWith(']')) {
          taskConfig.params[key] = value.trim()
        }
        else if (typeof value === 'string' && value.includes(',') && !value.includes('[')) {
          taskConfig.params[key] = value.split(',').map(v => v.trim()).filter(v => v)
        }
        else if (typeof value === 'number') {
          taskConfig.params[key] = value
        }
        else if (typeof value === 'string' && !isNaN(Number(value)) && value.trim() !== '' && !keepAsString.includes(key)) {
          taskConfig.params[key] = Number(value)
        }
        else if (value) {
          taskConfig.params[key] = value
        }
      })
      
      return { 
        command: 'run', 
        params: task.commandId || task.id,
        taskConfig: JSON.stringify(taskConfig)
      }
    }

    const commandId = task.commandId || task.id.split('-')[0]
    let params = ''
    const extraArgs: string[] = []
    
    if (commandId === 'startup' || commandId === 'closedown') {
      params = task.params?.clientType || 'Official'
      if (task.params?.address) {
        extraArgs.push(`-a ${task.params.address}`)
      }
    } else if (commandId === 'fight') {
      // 对于 fight 命令，如果有多个关卡，只返回第一个关卡
      // 多关卡的处理在 executeTaskFlow 中进行
      params = task.params?.stage || ''
      if (task.params?.medicine !== undefined && task.params.medicine !== '' && task.params.medicine !== null) {
        params += ` -m ${task.params.medicine}`
      }
      if (task.params?.stone !== undefined && task.params.stone !== '' && task.params.stone !== null) {
        params += ` --stone ${task.params.stone}`
      }
      if (task.params?.times) params += ` --times ${task.params.times}`
      if (task.params?.series !== undefined && task.params.series !== '' && String(task.params.series) !== '1') {
        params += ` --series ${task.params.series}`
      }
    }
    
    if (extraArgs.length > 0) {
      params = `${extraArgs.join(' ')} ${params}`
    }
    
    return { command: commandId, params }
  }

  const executeTaskFlow = async () => {
    setIsRunning(true)
    setCurrentStep(-1)
    showInfo('开始执行任务流程...')

    try {
      // 清理 taskFlow，移除不能序列化的字段（如 React 组件）
      const cleanTaskFlow = taskFlow.map(task => ({
        id: task.id,
        name: task.name,
        commandId: task.commandId,
        taskType: task.taskType,
        params: task.params,
        enabled: task.enabled
      }))
      
      // 直接调用后端的定时任务执行接口，复用所有逻辑
      const result = await maaApi.executeScheduleNow('manual', cleanTaskFlow)
      
      if (result.success) {
        showSuccess('任务流程执行完成')
      } else {
        showError(`任务流程执行失败: ${result.message || '未知错误'}`)
      }
    } catch (error: any) {
      showError(`执行失败: ${error.message}`)
    } finally {
      setIsRunning(false)
      setCurrentStep(-1)
    }
  }

  const stopTaskFlow = async () => {
    if (abortController) {
      abortController.abort()
    }
    
    // 调用后端 API 终止任务
    try {
      const result = await maaApi.stopTask()
      if (result.success) {
        showSuccess('任务已终止')
      } else {
        showError('终止失败: ' + result.message)
      }
    } catch (error) {
      showError('终止任务失败')
    }
    
    setIsRunning(false)
    setCurrentStep(-1)
    setAbortController(null)
    localStorage.removeItem('maa-task-flow-execution')
  }

  const loadTaskFlow = async () => {
    try {
      // 优先从服务器加载配置
      const serverConfig = await maaApi.loadUserConfig('automation-tasks')
      
      if (serverConfig.success && serverConfig.data) {
        // 服务器有配置，使用服务器配置
        const { taskFlow: loadedTasks, schedule } = serverConfig.data
        
        if (loadedTasks) {
          const restoredTasks = loadedTasks.map((task: any) => {
            const originalTask = availableTasks.find(t => t.id === task.commandId || t.id === task.id.split('-')[0])
            return {
              ...task,
              icon: originalTask?.icon,
              paramFields: originalTask?.paramFields
            }
          })
          setTaskFlow(restoredTasks)
          
          // 同步到 localStorage
          localStorage.setItem('maa-task-flow', JSON.stringify(loadedTasks))
        }
        
        if (schedule) {
          const { enabled, times } = schedule
          setScheduleEnabled(enabled)
          if (times && Array.isArray(times)) {
            setScheduleTimes(times)
          }
          
          // 同步到 localStorage
          localStorage.setItem('maa-schedule', JSON.stringify(schedule))
          
          if (enabled && times && times.length > 0) {
            try {
              await maaApi.setupSchedule('default', times, loadedTasks)
            } catch (error) {
              // 静默失败，不影响用户体验
            }
          }
        }
        
        return
      }
    } catch (error) {
      // 静默失败，尝试从 localStorage 加载
    }
    
    // 服务器加载失败，从 localStorage 加载
    const saved = localStorage.getItem('maa-task-flow')
    const schedule = localStorage.getItem('maa-schedule')
    if (saved) {
      const loadedTasks = JSON.parse(saved)
      const restoredTasks = loadedTasks.map((task: any) => {
        const originalTask = availableTasks.find(t => t.id === task.commandId || t.id === task.id.split('-')[0])
        return {
          ...task,
          icon: originalTask?.icon,
          paramFields: originalTask?.paramFields
        }
      })
      setTaskFlow(restoredTasks)
      
      if (schedule) {
        const { enabled, times } = JSON.parse(schedule)
        setScheduleEnabled(enabled)
        if (times && Array.isArray(times)) {
          setScheduleTimes(times)
        }
        
        if (enabled && times && times.length > 0) {
          try {
            await maaApi.setupSchedule('default', times, loadedTasks)
          } catch (error) {
            // 静默失败，不影响用户体验
          }
        }
      }
    }
  }

  // updateScheduleTime 函数已被内联处理替代，已移除

  const handleScheduleEnabledChange = (enabled: boolean) => {
    setScheduleEnabled(enabled)
    autoSave(taskFlow, enabled, scheduleTimes)
  }

  const addScheduleTime = () => {
    const newTimes = [...scheduleTimes, '12:00']
    setScheduleTimes(newTimes)
    autoSave(taskFlow, scheduleEnabled, newTimes)
  }

  const removeScheduleTime = (index: number) => {
    const newTimes = scheduleTimes.filter((_, i) => i !== index)
    setScheduleTimes(newTimes)
    autoSave(taskFlow, scheduleEnabled, newTimes)
  }

  useEffect(() => {
    // 先加载任务流程
    const initializeAndRestore = async () => {
      // 1. 先加载任务流程
      await loadTaskFlow()
      
      // 2. 获取当前活动信息
      try {
        const activityResult = await maaApi.getActivity('Official')
        if (activityResult.success && activityResult.data.code) {
          setCurrentActivity(activityResult.data.code)
          setActivityName(activityResult.data.name)
        }
      } catch (error) {
        // 静默失败，不影响用户体验
      }
      
      // 3. 然后检查是否需要恢复执行
      try {
        const result = await maaApi.getTaskStatus()
        
        // 检查是否有任务流程正在执行
        const flowExecution = localStorage.getItem('maa-task-flow-execution')
        
        if (flowExecution) {
          const { isExecuting, tasks, currentIndex } = JSON.parse(flowExecution)
          
          if (isExecuting && tasks && tasks.length > 0) {
            setIsRunning(true)
            showInfo(`恢复任务流程执行...`)
            
            const continueTaskFlow = async () => {
              // 从 localStorage 加载任务流程，找到当前执行的任务
              const savedTaskFlow = localStorage.getItem('maa-task-flow')
              if (!savedTaskFlow) {
                showError('无法恢复任务流程')
                setIsRunning(false)
                setCurrentStep(-1)
                localStorage.removeItem('maa-task-flow-execution')
                return
              }
              
              const loadedTasks = JSON.parse(savedTaskFlow)
              
              // 如果后端有任务在运行，找到对应的卡片并显示转圈
              if (result.success && result.data.isRunning) {
                const currentTaskInfo = tasks[currentIndex]
                if (currentTaskInfo) {
                  // 找到当前任务在 taskFlow 中的索引
                  const currentTask = loadedTasks.find((t: any) => {
                    const tCommandId = t.commandId || t.id.split('-')[0]
                    return tCommandId === currentTaskInfo.commandId
                  })
                  
                  if (currentTask) {
                    const actualIndex = loadedTasks.findIndex((t: any) => t.id === currentTask.id)
                    setCurrentStep(actualIndex)
                  }
                }
                
                showInfo(`正在执行: ${result.data.taskName}`)
                
                // 等待当前任务完成
                await new Promise<void>((resolve) => {
                  const checkInterval = setInterval(async () => {
                    try {
                      const statusResult = await maaApi.getTaskStatus()
                      if (statusResult.success && !statusResult.data.isRunning) {
                        clearInterval(checkInterval)
                        resolve()
                      }
                    } catch (error) {
                      // 静默失败，继续检查
                    }
                  }, 1000)
                })
              }
              
              // 继续执行剩余任务
              const remainingTasks = tasks.slice(currentIndex + 1)
              
              if (remainingTasks.length > 0) {
                for (let i = 0; i < remainingTasks.length; i++) {
                  const taskInfo = remainingTasks[i]
                  
                  // 使用 commandId 匹配任务
                  const task = loadedTasks.find((t: any) => {
                    const tCommandId = t.commandId || t.id.split('-')[0]
                    return tCommandId === taskInfo.commandId && t.enabled
                  })
                  
                  if (!task) {
                    continue
                  }
                  
                  const actualIndex = loadedTasks.findIndex((t: any) => t.id === task.id)
                  setCurrentStep(actualIndex)
                  showInfo(`正在执行: ${task.name}`)
                  
                  localStorage.setItem('maa-task-flow-execution', JSON.stringify({
                    isExecuting: true,
                    tasks,
                    currentIndex: currentIndex + i + 1,
                    startTime: Date.now()
                  }))
                  
                  try {
                    const { command, params, taskConfig } = buildCommand(task)
                    const result = await maaApi.executePredefinedTask(
                      command, 
                      params, 
                      taskConfig as any, 
                      null,
                      task.name,
                      'automation',
                      false
                    )
                    
                    if (!result.success) {
                      showError(`${task.name} 提交失败: ${result.error}`)
                      break
                    }
                    
                    await new Promise<void>((resolve) => {
                      const checkInterval = setInterval(async () => {
                        try {
                          const statusResult = await maaApi.getTaskStatus()
                          if (statusResult.success && !statusResult.data.isRunning) {
                            clearInterval(checkInterval)
                            resolve()
                          }
                        } catch (error) {
                          // 静默失败，继续检查
                        }
                      }, 1000)
                    })
                    
                    // 任务完成后的延迟时间
                    // 启动游戏需要更长的等待时间，确保游戏完全启动
                    const commandId = task.commandId || task.id.split('-')[0]
                    const delayTime = commandId === 'startup' ? 15000 : commandId === 'closedown' ? 3000 : 2000
                    
                    showInfo(`${task.name} 完成，等待 ${delayTime / 1000} 秒后继续...`)
                    await new Promise<void>(resolve => setTimeout(resolve, delayTime))
                  } catch (error) {
                    break
                  }
                }
              }
              
              showSuccess('所有任务执行完成！')
              setIsRunning(false)
              setCurrentStep(-1)
              localStorage.removeItem('maa-task-flow-execution')
            }
            
            continueTaskFlow()
            return
          }
        }
        
        // 没有任务流程，检查单个任务
        if (result.success && result.data.isRunning) {
          const { taskName, startTime, taskType } = result.data
          
          if (taskType === 'automation') {
            const elapsedMinutes = (Date.now() - startTime) / 1000 / 60
            setIsRunning(true)
            setCurrentStep(0)
            if (elapsedMinutes > 5) {
              showInfo(`${taskName} 可能已完成（已运行 ${Math.floor(elapsedMinutes)} 分钟）`)
            } else {
              showInfo(`正在执行: ${taskName}`)
            }
            
            const pollInterval = setInterval(async () => {
              try {
                const statusResult = await maaApi.getTaskStatus()
                if (statusResult.success && !statusResult.data.isRunning) {
                  setIsRunning(false)
                  setCurrentStep(-1)
                  showSuccess('任务已完成')
                  clearInterval(pollInterval)
                }
              } catch (error) {
                clearInterval(pollInterval)
              }
            }, 2000)
            
            return () => clearInterval(pollInterval)
          }
        }
      } catch (error) {
        // 静默失败，不影响用户体验
      }
    }
    
    initializeAndRestore()
  }, [])

  // 监听养成计划应用事件，自动刷新任务流程
  useEffect(() => {
    const handleTrainingPlanApplied = async (event: any) => {
      await loadTaskFlow()
      showSuccess(`智能养成计划已更新：${event.detail?.stageCount || 0} 个关卡`)
    }

    window.addEventListener('training-plan-applied', handleTrainingPlanApplied)
    
    return () => {
      window.removeEventListener('training-plan-applied', handleTrainingPlanApplied)
    }
  }, [])

  // 监听页面可见性变化，切换回来时自动刷新
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (!document.hidden) {
        // 页面重新可见时，重新加载任务流程
        await loadTaskFlow()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  // 使用 IntersectionObserver 监听组件可见性
  useEffect(() => {
    const containerRef = document.querySelector('[data-automation-tasks]')
    if (!containerRef) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // 组件变为可见时，重新加载任务流程
            loadTaskFlow()
          }
        })
      },
      { threshold: 0.1 } // 当至少 10% 可见时触发
    )

    observer.observe(containerRef)

    return () => {
      observer.disconnect()
    }
  }, [])

  return (
    <>
      <div className="p-6" data-automation-tasks>
        <div className="max-w-7xl mx-auto space-y-6">
        {/* 页面标题 */}
        <PageHeader
          icon={<Icons.Robot />}
          title="自动化任务流程"
          subtitle="编排日常任务流程，一键执行或定时运行"
          gradientFrom="violet-400"
          gradientVia="purple-400"
          gradientTo="fuchsia-400"
          actions={
            <div className="flex items-center space-x-4">
              <FloatingStatusIndicator />
              {/* 活动状态 */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-medium border flex items-center space-x-1.5 sm:space-x-2 ${
                  currentActivity
                    ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-500/30'
                    : 'bg-gray-50 dark:bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-500/30'
                }`}
              >
                {currentActivity ? (
                  <>
                    <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span className="hidden sm:inline">当前活动: {activityName || currentActivity}</span>
                    <span className="sm:hidden">{currentActivity}</span>
                    {activityName && (
                      <span className="text-xs opacity-75 hidden sm:inline">({currentActivity})</span>
                    )}
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                    <span>长草中～</span>
                  </>
                )}
              </motion.div>
            </div>
          }
        />

        {/* 上半部分：截图监控 + 定时执行 */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
          {/* 模拟器监控 */}
          <div className="rounded-2xl sm:rounded-3xl p-4 sm:p-5 border border-gray-200 dark:border-white/10 bg-white dark:bg-[rgba(15,15,15,0.6)] transition-colors">
            <ScreenMonitor 
              adbPath={taskFlow.find(t => t.commandId === 'startup')?.params?.adbPath || '/opt/homebrew/bin/adb'}
              address={taskFlow.find(t => t.commandId === 'startup')?.params?.address || '127.0.0.1:16384'}
            />
          </div>

          {/* 定时执行 */}
          <div className="rounded-3xl p-6 border border-gray-200 dark:border-white/10 bg-white dark:bg-[rgba(15,15,15,0.6)] transition-colors">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center space-x-2">
                <Icons.Clock />
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">定时执行</h3>
              </div>
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => setNotificationSettingsOpen(true)}
                  className="p-2 rounded-lg hover:bg-orange-50 dark:hover:bg-orange-500/10 text-orange-500 transition-all"
                  title="通知设置"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                </button>
                <label className="flex items-center space-x-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={scheduleEnabled}
                    onChange={(e) => handleScheduleEnabledChange(e.target.checked)}
                    disabled={isRunning}
                    className="custom-checkbox cursor-pointer"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200 group-hover:text-purple-400 transition-colors">启用</span>
                </label>
              </div>
            </div>
            
            {scheduleEnabled ? (
              <motion.div
                className="space-y-3"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                transition={{ duration: 0.3 }}
              >
                <div className="backdrop-blur-sm p-4 rounded-2xl border border-gray-200 dark:border-white/10 space-y-3 bg-gray-50 dark:bg-[rgba(20,20,20,0.6)] transition-colors">
                  <label className="text-sm text-gray-700 dark:text-gray-300 font-medium">执行时间</label>
                  {scheduleTimes.map((time, index) => {
                    const [hour, minute] = time.split(':');
                    return (
                      <div key={index} className="flex items-center gap-2">
                        <div className="flex-1 flex items-center space-x-1 backdrop-blur-sm p-2 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-100 dark:bg-[rgba(10,10,10,0.6)] transition-colors">
                          <select
                            value={hour}
                            onChange={(e) => {
                              const newTimes = [...scheduleTimes];
                              newTimes[index] = `${e.target.value.padStart(2, '0')}:${minute}`;
                              setScheduleTimes(newTimes);
                              autoSave(taskFlow, scheduleEnabled, newTimes);
                            }}
                            disabled={isRunning}
                            className="flex-1 px-2 py-1 bg-transparent border-none text-center text-sm text-gray-900 dark:text-gray-200 focus:outline-none focus:ring-0 cursor-pointer"
                          >
                            {Array.from({ length: 24 }, (_, i) => (
                              <option key={i} value={i.toString().padStart(2, '0')}>
                                {i.toString().padStart(2, '0')}
                              </option>
                            ))}
                          </select>
                          <span className="text-gray-500 text-sm">:</span>
                          <select
                            value={minute}
                            onChange={(e) => {
                              const newTimes = [...scheduleTimes];
                              newTimes[index] = `${hour}:${e.target.value.padStart(2, '0')}`;
                              setScheduleTimes(newTimes);
                              autoSave(taskFlow, scheduleEnabled, newTimes);
                            }}
                            disabled={isRunning}
                            className="flex-1 px-2 py-1 bg-transparent border-none text-center text-sm text-gray-900 dark:text-gray-200 focus:outline-none focus:ring-0 cursor-pointer"
                          >
                            {Array.from({ length: 60 }, (_, i) => (
                              <option key={i} value={i.toString().padStart(2, '0')}>
                                {i.toString().padStart(2, '0')}
                              </option>
                            ))}
                          </select>
                        </div>
                        {scheduleTimes.length > 1 && (
                          <button
                            onClick={() => removeScheduleTime(index)}
                            disabled={isRunning}
                            className="flex items-center justify-center rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-all border border-red-500/20"
                            style={{ width: '40px', height: '40px', minWidth: '40px', minHeight: '40px', flexShrink: 0 }}
                          >
                            <svg className="flex-shrink-0" style={{ width: '16px', height: '16px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {scheduleTimes.length < 6 && (
                    <button
                      onClick={addScheduleTime}
                      disabled={isRunning}
                      className="w-full flex items-center justify-center p-2 rounded-xl border border-dashed border-gray-300 dark:border-white/20 hover:border-purple-500/50 hover:bg-purple-500/10 text-gray-500 dark:text-gray-400 hover:text-purple-400 dark:hover:text-purple-300 transition-all"
                    >
                      <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                      <span className="text-sm">添加时间点</span>
                    </button>
                  )}
                </div>
                <p className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 backdrop-blur-sm p-3 rounded-xl border border-emerald-300 dark:border-emerald-500/20">
                  ✨ 提示：定时任务在后台运行，无需保持浏览器打开。所有修改自动保存。
                </p>
              </motion.div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8">
                <div className="w-16 h-16 mb-4 rounded-2xl bg-violet-100 dark:bg-violet-500/10 flex items-center justify-center">
                  <svg className="w-8 h-8 text-violet-400 dark:text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-300 mb-1">定时执行未启用</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">开启后可设置自动执行时间</p>
              </div>
            )}
          </div>
        </div>

        {/* 下半部分：可用任务列表 + 任务流程 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* 可用任务列表 */}
          <div className="lg:col-span-1">
            <div className="rounded-3xl p-6 border border-gray-200 dark:border-white/10 bg-white dark:bg-[rgba(15,15,15,0.6)] transition-colors">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-5 flex items-center space-x-2">
                <Icons.Package />
                <span>可用任务</span>
              </h3>
              <div className="space-y-2.5">
                {availableTasks.map((task) => (
                  <button
                    key={task.id}
                    onClick={() => addTaskToFlow(task)}
                    disabled={isRunning}
                    className="w-full text-left p-4 border border-gray-200 dark:border-white/10 rounded-2xl hover:border-violet-500/50 hover:shadow-[0_8px_16px_rgb(139,92,246,0.2)] transition-all disabled:opacity-50 disabled:cursor-not-allowed group bg-gray-50 dark:bg-[rgba(20,20,20,0.6)]"
                  >
                    <div className="flex items-center space-x-3 mb-2">
                      <span className="text-2xl">{task.icon}</span>
                      <span className="font-semibold text-gray-800 dark:text-gray-200 group-hover:text-violet-400 transition-colors">{task.name}</span>
                      {task.taskType && (
                        <span className="text-xs bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 px-2.5 py-1 rounded-full font-medium border border-violet-300 dark:border-violet-500/30">{task.taskType}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-500 ml-9 leading-relaxed">{task.description}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 任务流程 */}
          <div className="lg:col-span-2">
            <div className="rounded-3xl p-6 border border-gray-200 dark:border-white/10 bg-white dark:bg-[rgba(15,15,15,0.6)] transition-colors">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center space-x-2">
                  <Icons.Clipboard />
                  <span>任务流程</span>
                  <span className="text-sm text-gray-600 dark:text-gray-400 font-normal px-3 py-1 rounded-full border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[rgba(20,20,20,0.6)] transition-colors">
                    {taskFlow.filter(t => t.enabled).length}/{taskFlow.length} 已启用
                  </span>
                </h3>
                <div className="flex space-x-2">
                  {taskFlow.length > 0 && (
                    <>
                      <Button
                        onClick={executeTaskFlow}
                        disabled={isRunning || taskFlow.filter(t => t.enabled).length === 0}
                        variant="gradient"
                        gradientFrom="violet-500"
                        gradientTo="purple-500"
                        icon={
                          isRunning ? (
                            <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                          ) : (
                            <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                            </svg>
                          )
                        }
                      >
                        {isRunning ? '执行中...' : '立即执行'}
                      </Button>
                      {isRunning && (
                        <Button
                          onClick={stopTaskFlow}
                          variant="gradient"
                          gradientFrom="rose-500"
                          gradientTo="rose-600"
                          icon={
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                            </svg>
                          }
                        >
                          终止执行
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {taskFlow.length === 0 ? (
                <div className="text-center py-16 text-slate-400">
                  <motion.div 
                    className="text-6xl mb-4"
                    animate={{ x: [-10, 0, -10] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  >
                    👈
                  </motion.div>
                  <p className="text-lg font-medium">从左侧选择任务添加到流程中</p>
                  <p className="text-sm mt-2">开始构建你的自动化工作流</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {taskFlow.map((task, index) => (
                    <div
                      key={task.id}
                      onDragOver={(e) => handleDragOver(e, index)}
                      className={`border rounded-3xl p-6 transition-all ${
                        draggedIndex === index ? 'opacity-50 scale-95' : ''
                      } ${
                        currentStep === index 
                          ? 'border-violet-500/60 bg-gradient-to-br from-violet-500/10 to-purple-500/10 shadow-[0_8px_20px_rgb(139,92,246,0.25)] ring-1 ring-violet-500/30' 
                          : task.enabled 
                            ? 'border-violet-200 dark:border-violet-500/20 hover:border-violet-500/30 hover:shadow-[0_4px_12px_rgba(139,92,246,0.15)] bg-gradient-to-br from-violet-50/50 to-purple-50/50 dark:from-violet-900/5 dark:to-purple-900/5' 
                            : 'border-gray-100 dark:border-white/5 opacity-60 bg-gray-50 dark:bg-[rgba(15,15,15,0.3)]'
                      }`}
                    >
                      {/* 顶部行：复选框 + 标题 + 删除按钮 */}
                      <div className="flex items-start gap-3 mb-4">
                        {/* 复选框 */}
                        <input
                          type="checkbox"
                          checked={task.enabled}
                          onChange={() => toggleTaskEnabled(index)}
                          disabled={isRunning}
                          className="mt-1 custom-checkbox cursor-pointer flex-shrink-0"
                        />
                        
                        {/* 标题信息 */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2 flex-wrap">
                            {!isRunning && (
                              <span 
                                draggable={true}
                                onDragStart={() => handleDragStart(index)}
                                onDragEnd={handleDragEnd}
                                className="text-gray-400 cursor-move hover:text-gray-600 dark:hover:text-gray-300 transition-colors" 
                                title="拖拽排序"
                              >
                                ⋮⋮
                              </span>
                            )}
                            <span className="text-xl">{task.icon}</span>
                            <span className="font-bold text-gray-900 dark:text-white text-base">{task.name}</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/10 px-2 py-0.5 rounded-full border border-gray-200 dark:border-white/10">#{index + 1}</span>
                          </div>
                        </div>
                        
                        {/* 删除按钮 */}
                        <div className="flex-shrink-0">
                          {currentStep === index ? (
                            <div className="w-7 h-7 flex items-center justify-center">
                              <svg className="w-5 h-5 animate-spin text-violet-400" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                            </div>
                          ) : (
                            <motion.button
                              onClick={() => removeTaskFromFlow(index)}
                              disabled={isRunning}
                              className="flex items-center justify-center rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 disabled:opacity-30 disabled:cursor-not-allowed transition-all border border-red-500/20 hover:border-red-500/40"
                              style={{ width: '28px', height: '28px', minWidth: '28px', minHeight: '28px', flexShrink: 0 }}
                              title="删除任务"
                              whileHover={{ scale: 1.1, rotate: 90 }}
                              whileTap={{ scale: 0.9 }}
                            >
                              <svg className="flex-shrink-0" style={{ width: '16px', height: '16px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </motion.button>
                          )}
                        </div>
                      </div>

                      {/* 参数配置区域 */}
                      {task.paramFields && task.paramFields.length > 0 && (
                        <div className="space-y-3">
                          {task.paramFields.map((field) => {
                            return (
                            <div key={field.key}>
                              {field.type === 'checkbox' ? (
                                <label className="flex items-center space-x-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer group">
                                  <input
                                    type="checkbox"
                                    checked={task.params[field.key] || false}
                                    onChange={(e) => updateTaskParam(index, field.key, e.target.checked)}
                                    disabled={isRunning || !task.enabled}
                                    className="custom-checkbox cursor-pointer"
                                  />
                                  <span className="group-hover:text-violet-400 transition-colors">{field.label}</span>
                                </label>
                              ) : field.type === 'multi-stages' ? (
                                <div className="space-y-2">
                                  {(task.params.stages || [{ stage: '', times: '' }]).map((stageItem, stageIndex) => (
                                    <div key={stageIndex}>
                                      <div className="flex items-center space-x-2">
                                        {stageIndex === 0 && (
                                          <label className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap" style={{ width: '80px', flexShrink: 0 }}>{field.label}:</label>
                                        )}
                                        {stageIndex > 0 && (
                                          <div style={{ width: '80px', flexShrink: 0 }}></div>
                                        )}
                                        <div className="flex items-center space-x-2 flex-1">
                                        <div className={`relative inline-flex items-center border rounded-xl focus-within:ring-2 focus-within:ring-violet-500 transition-all overflow-hidden ${
                                          typeof stageItem === 'object' && stageItem.pinned
                                            ? 'border-amber-300 dark:border-amber-500/50 bg-amber-50 dark:bg-amber-500/10'
                                            : typeof stageItem === 'object' && stageItem.smart
                                              ? 'border-blue-300 dark:border-blue-500/50 bg-blue-50 dark:bg-blue-500/10'
                                              : 'border-gray-200 dark:border-white/10 bg-white dark:bg-[#070707]'
                                        }`}>
                                        {/* 置顶/智能标识按钮 - 绝对定位在输入框内部左侧 */}
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const newStages = [...(task.params.stages || [{ stage: '', times: '' }])];
                                            const currentItem = newStages[stageIndex];
                                            // 切换置顶状态
                                            if (typeof currentItem === 'string') {
                                              newStages[stageIndex] = { stage: currentItem, times: '', pinned: true };
                                            } else if (currentItem) {
                                              newStages[stageIndex] = { ...currentItem, pinned: !currentItem.pinned };
                                            }
                                            updateTaskParam(index, 'stages', newStages);
                                          }}
                                          disabled={isRunning || !task.enabled || (typeof stageItem === 'object' && stageItem.smart)}
                                          className={`absolute left-1 top-1/2 -translate-y-1/2 p-1 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed z-10 ${
                                            (typeof stageItem === 'object' && stageItem.smart)
                                              ? 'text-blue-500 dark:text-blue-400'
                                              : (typeof stageItem === 'object' && stageItem.pinned)
                                                ? 'text-amber-500 hover:bg-amber-500/20'
                                                : 'text-gray-300/50 dark:text-gray-600/50 hover:bg-gray-500/10'
                                          }`}
                                          title={
                                            typeof stageItem === 'object' && stageItem.smart 
                                              ? '智能养成关卡' 
                                              : typeof stageItem === 'object' && stageItem.pinned 
                                                ? '取消置顶' 
                                                : '置顶'
                                          }
                                        >
                                          {(typeof stageItem === 'object' && stageItem.smart) ? (
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                            </svg>
                                          ) : (
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                                            </svg>
                                          )}
                                        </button>
                                        <input
                                          type="text"
                                          list="stage-suggestions"
                                          value={typeof stageItem === 'string' ? stageItem : stageItem.stage}
                                          onChange={(e) => {
                                            const newStages = [...(task.params.stages || [{ stage: '', times: '' }])];
                                            if (typeof newStages[stageIndex] === 'string') {
                                              newStages[stageIndex] = { stage: e.target.value, times: '' };
                                            } else {
                                              newStages[stageIndex] = { ...newStages[stageIndex], stage: e.target.value };
                                            }
                                            updateTaskParam(index, 'stages', newStages);
                                          }}
                                          placeholder={field.placeholder}
                                          disabled={isRunning || !task.enabled || (typeof stageItem === 'object' && stageItem.smart)}
                                          className="w-28 pl-7 pr-3 py-2 bg-transparent text-sm text-gray-900 dark:text-gray-200 focus:outline-none"
                                        />
                                        <datalist id="stage-suggestions">
                                          <option value="1-7">1-7 (固源岩)</option>
                                          <option value="4-6">4-6 (酮凝集)</option>
                                          <option value="S4-1">S4-1 (聚酸酯)</option>
                                          <option value="S5-9">S5-9 (异铁)</option>
                                          <option value="CE-6">CE-6 (龙门币)</option>
                                          <option value="LS-6">LS-6 (作战记录)</option>
                                          <option value="AP-5">AP-5 (技能书)</option>
                                          <option value="CA-5">CA-5 (芯片)</option>
                                          <option value="SK-5">SK-5 (碳)</option>
                                          <option value="Annihilation">Annihilation (剿灭)</option>
                                          <option value="HD-1">HD-1 (活动)</option>
                                          <option value="HD-2">HD-2 (活动)</option>
                                          <option value="HD-3">HD-3 (活动)</option>
                                          <option value="HD-4">HD-4 (活动)</option>
                                          <option value="HD-5">HD-5 (活动)</option>
                                          <option value="HD-6">HD-6 (活动)</option>
                                          <option value="HD-7">HD-7 (活动)</option>
                                          <option value="HD-8">HD-8 (活动)</option>
                                          <option value="HD-9">HD-9 (活动)</option>
                                          <option value="HD-10">HD-10 (活动)</option>
                                        </datalist>
                                        <div className="w-px h-6 bg-white/20"></div>
                                        <input
                                          type="number"
                                          value={typeof stageItem === 'string' ? '' : (stageItem.times || '')}
                                          onChange={(e) => {
                                            const newStages = [...(task.params.stages || [{ stage: '', times: '' }])];
                                            const currentStage = newStages[stageIndex];
                                            if (typeof currentStage === 'string') {
                                              newStages[stageIndex] = { stage: currentStage, times: e.target.value };
                                            } else if (currentStage) {
                                              newStages[stageIndex] = { ...currentStage, times: e.target.value };
                                            }
                                            updateTaskParam(index, 'stages', newStages);
                                          }}
                                          placeholder=""
                                          disabled={isRunning || !task.enabled || (typeof stageItem === 'object' && stageItem.smart)}
                                          className="w-10 px-1 py-2 bg-transparent text-sm text-gray-900 dark:text-gray-200 text-center focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                          min="0"
                                        />
                                        <div className="flex flex-col border-l border-white/10 self-stretch overflow-hidden">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const newStages = [...(task.params.stages || [{ stage: '', times: '' }])];
                                              const currentItem = newStages[stageIndex];
                                              if (!currentItem) return;
                                              const currentValue = typeof currentItem === 'string' ? 0 : (Number(currentItem.times) || 0);
                                              if (typeof currentItem === 'string') {
                                                newStages[stageIndex] = { stage: currentItem, times: (currentValue + 1).toString() };
                                              } else {
                                                newStages[stageIndex] = { ...currentItem, times: (currentValue + 1).toString() };
                                              }
                                              updateTaskParam(index, 'stages', newStages);
                                            }}
                                            disabled={isRunning || !task.enabled || (typeof stageItem === 'object' && stageItem.smart)}
                                            className="flex-1 px-1.5 bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                                          >
                                            <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                                            </svg>
                                          </button>
                                          <div className="w-full h-px bg-white/10"></div>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const newStages = [...(task.params.stages || [{ stage: '', times: '' }])];
                                              const currentItem = newStages[stageIndex];
                                              if (!currentItem) return;
                                              const currentValue = typeof currentItem === 'string' ? 0 : (Number(currentItem.times) || 0);
                                              if (currentValue > 0) {
                                                if (typeof currentItem === 'string') {
                                                  newStages[stageIndex] = { stage: currentItem, times: (currentValue - 1).toString() };
                                                } else {
                                                  newStages[stageIndex] = { ...currentItem, times: (currentValue - 1).toString() };
                                                }
                                                updateTaskParam(index, 'stages', newStages);
                                              }
                                            }}
                                            disabled={isRunning || !task.enabled || (typeof stageItem === 'object' && stageItem.smart)}
                                            className="flex-1 px-1.5 bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                                          >
                                            <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                            </svg>
                                          </button>
                                        </div>
                                      </div>
                                      {(task.params.stages || [{ stage: '', times: '' }]).length > 1 && !(typeof stageItem === 'object' && stageItem.smart) && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const newStages = (task.params.stages || [{ stage: '', times: '' }]).filter((_, i) => i !== stageIndex);
                                            updateTaskParam(index, 'stages', newStages.length > 0 ? newStages : [{ stage: '', times: '' }]);
                                          }}
                                          disabled={isRunning || !task.enabled}
                                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                                          title="删除此关卡"
                                        >
                                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                          </svg>
                                        </button>
                                      )}
                                        </div>
                                      </div>
                                      {/* 智能养成干员提示 - 只在最后一个智能养成关卡下显示 */}
                                      {(() => {
                                        // 找到所有智能养成关卡的索引
                                        const smartStageIndices = (task.params.stages || [])
                                          .map((s: any, idx: number) => ({ stage: s, index: idx }))
                                          .filter((item: any) => typeof item.stage === 'object' && item.stage.smart)
                                          .map((item: any) => item.index);
                                        
                                        // 检查当前是否是最后一个智能养成关卡
                                        const isLastSmartStage = smartStageIndices.length > 0 && 
                                          stageIndex === smartStageIndices[smartStageIndices.length - 1];
                                        
                                        // 只在最后一个智能养成关卡下显示
                                        return isLastSmartStage && 
                                          typeof stageItem === 'object' && 
                                          stageItem.smart && 
                                          stageItem.trainingOperators && 
                                          stageItem.trainingOperators.length > 0 && (
                                          <div className="flex items-center space-x-2 -mb-1 mt-1">
                                            <div style={{ width: '80px', flexShrink: 0 }}></div>
                                            <div className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 px-3 py-1.5 rounded-lg border border-blue-200 dark:border-blue-500/30 flex items-center space-x-1.5">
                                              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                              </svg>
                                              <span className="font-medium">正在养成:</span>
                                              <span>{stageItem.trainingOperators.join('、')}</span>
                                            </div>
                                          </div>
                                        );
                                      })()}
                                    </div>
                                  ))}
                                  <div className="flex items-center space-x-2">
                                    <div style={{ width: '80px', flexShrink: 0 }}></div>
                                    <div className="inline-flex space-x-2">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const currentStages = task.params.stages || [{ stage: '', times: '' }];
                                          updateTaskParam(index, 'stages', [...currentStages, { stage: '', times: '' }]);
                                        }}
                                        disabled={isRunning || !task.enabled}
                                        className="flex items-center justify-center space-x-1 border border-dashed border-gray-300 dark:border-gray-600 hover:border-violet-400 dark:hover:border-violet-500 rounded-xl py-1.5 px-3 text-sm text-gray-500 dark:text-gray-400 hover:text-violet-600 dark:hover:text-violet-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-white dark:bg-[#070707]"
                                      >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                                        </svg>
                                        <span>添加关卡</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          try {
                                            // 获取当前关卡列表
                                            const currentStages = task.params.stages || [{ stage: '', times: '' }];
                                            
                                            // 检查是否已有智能关卡
                                            const hasSmartStages = currentStages.some(s => typeof s === 'object' && s.smart);
                                            
                                            if (hasSmartStages) {
                                              // 如果已有智能关卡，则移除所有智能关卡
                                              const pinnedStages = currentStages.filter(s => 
                                                typeof s === 'object' && s.pinned && s.stage && s.stage.trim()
                                              );
                                              const normalStages = currentStages.filter(s => 
                                                (typeof s === 'string' && s.trim()) || 
                                                (typeof s === 'object' && !s.pinned && !s.smart && s.stage && s.stage.trim())
                                              );
                                              
                                              const allStages = [...pinnedStages, ...normalStages];
                                              updateTaskParam(index, 'stages', allStages.length > 0 ? allStages : [{ stage: '', times: '' }]);
                                              showSuccess('已移除智能养成关卡');
                                              return;
                                            }
                                            
                                            // 如果没有智能关卡，则添加
                                            // 从智能养成加载刷取计划
                                            const result = await maaApi.loadUserConfig('training-queue');
                                            if (!result.success || !result.data || !result.data.queue || result.data.queue.length === 0) {
                                              showError('智能养成队列为空，请先添加干员');
                                              return;
                                            }
                                            
                                            // 生成刷取计划
                                            const planResult = await maaApi.generateTrainingPlan('current');
                                            if (!planResult.success || !planResult.data) {
                                              showError('生成刷取计划失败');
                                              return;
                                            }
                                            
                                            const plan = planResult.data;
                                            if (!plan.stages || plan.stages.length === 0) {
                                              showSuccess('当前干员材料已集齐！');
                                              return;
                                            }
                                            
                                            // 获取正在养成的干员名称
                                            const trainingOperatorNames = plan.operators && plan.operators.length > 0
                                              ? plan.operators.map((op: any) => op.name)
                                              : [];
                                            
                                            // 将刷取计划转换为关卡列表，标记为智能养成
                                            const newStages = plan.stages.map((stage: any) => ({
                                              stage: stage.stage,
                                              times: stage.totalTimes.toString(),
                                              smart: true, // 标记为智能养成关卡
                                              trainingOperators: trainingOperatorNames // 添加干员信息
                                            }));
                                            
                                            // 分类：置顶关卡、普通关卡
                                            const pinnedStages = currentStages.filter((s): s is StageConfig => 
                                              typeof s === 'object' && s.pinned === true && !!s.stage && s.stage.trim() !== ''
                                            );
                                            const normalStages = currentStages.filter((s): s is string | StageConfig => 
                                              (typeof s === 'string' && s.trim() !== '') || 
                                              (typeof s === 'object' && !s.pinned && !s.smart && !!s.stage && s.stage.trim() !== '')
                                            );
                                            
                                            // 重新组合：置顶 -> 智能养成 -> 普通
                                            const allStages = [...pinnedStages, ...newStages, ...normalStages];
                                            
                                            updateTaskParam(index, 'stages', allStages);
                                            showSuccess(`已添加智能养成计划：${newStages.length} 个关卡`);
                                          } catch (error: unknown) {
                                            const errorMessage = error instanceof Error ? error.message : '未知错误'
                                            showError('操作失败: ' + errorMessage);
                                          }
                                        }}
                                        disabled={isRunning || !task.enabled}
                                        className={`flex items-center justify-center space-x-1 border border-dashed rounded-xl py-1.5 px-3 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                                          (task.params.stages || []).some(s => typeof s === 'object' && s.smart)
                                            ? 'border-blue-500 dark:border-blue-400 bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 hover:border-blue-600 dark:hover:border-blue-300 hover:bg-blue-200 dark:hover:bg-blue-500/30'
                                            : 'border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-700 dark:hover:text-blue-300'
                                        }`}
                                      >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                          {(task.params.stages || []).some(s => typeof s === 'object' && s.smart) ? (
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                          ) : (
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l9-5-9-5-9 5 9 5z M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
                                          )}
                                        </svg>
                                        <span>
                                          {(task.params.stages || []).some(s => typeof s === 'object' && s.smart) ? '关闭养成' : '智能养成'}
                                        </span>
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ) : field.type === 'stage-with-times' ? (
                                <div className="flex items-center space-x-2">
                                  <label className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap w-20">{field.label}:</label>
                                  <div className="flex items-center border border-gray-200 dark:border-white/10 rounded-xl focus-within:ring-2 focus-within:ring-violet-500 transition-all flex-1 max-w-[280px] bg-white dark:bg-[#070707]">
                                    <input
                                      type="text"
                                      value={task.params[field.key] || ''}
                                      onChange={(e) => updateTaskParam(index, field.key, e.target.value)}
                                      placeholder={field.placeholder}
                                      disabled={isRunning || !task.enabled}
                                      className="flex-1 px-3 py-2 bg-transparent text-sm text-gray-900 dark:text-gray-200 focus:outline-none min-w-0"
                                    />
                                    <div className="w-px h-6 bg-white/20"></div>
                                    <input
                                      type="number"
                                      value={task.params.times || ''}
                                      onChange={(e) => updateTaskParam(index, 'times', e.target.value)}
                                      placeholder=""
                                      disabled={isRunning || !task.enabled}
                                      className="w-16 px-2 py-2 bg-transparent text-sm text-gray-900 dark:text-gray-200 text-center focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                      min="0"
                                    />
                                    <div className="flex flex-col border-l border-white/10 self-stretch overflow-hidden">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const currentValue = Number(task.params.times) || 0;
                                          updateTaskParam(index, 'times', (currentValue + 1).toString());
                                        }}
                                        disabled={isRunning || !task.enabled}
                                        className="flex-1 px-1.5 bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center rounded-tr-xl"
                                      >
                                        <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                                        </svg>
                                      </button>
                                      <div className="w-full h-px bg-white/10"></div>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const currentValue = Number(task.params.times) || 0;
                                          if (currentValue > 0) {
                                            updateTaskParam(index, 'times', (currentValue - 1).toString());
                                          }
                                        }}
                                        disabled={isRunning || !task.enabled}
                                        className="flex-1 px-1.5 bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center rounded-br-xl"
                                      >
                                        <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                        </svg>
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ) : field.type === 'star-select' ? (
                                <div>
                                  <label className="text-sm text-gray-600 dark:text-gray-400 block mb-2">{field.label}:</label>
                                  <div className="flex items-center space-x-2 flex-wrap">
                                    {[3, 4, 5, 6].map(star => {
                                      const currentValue = Array.isArray(task.params[field.key]) ? task.params[field.key] : [];
                                      const isChecked = currentValue.includes(star);
                                      return (
                                        <label key={star} className="flex items-center space-x-1 text-sm text-gray-700 dark:text-gray-300 cursor-pointer group">
                                          <input
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={(e) => {
                                              const newValue = e.target.checked
                                                ? [...currentValue, star].sort()
                                                : currentValue.filter((s: number) => s !== star);
                                              updateTaskParam(index, field.key, newValue);
                                            }}
                                            disabled={isRunning || !task.enabled}
                                            className="custom-checkbox cursor-pointer"
                                          />
                                          <span className="group-hover:text-violet-400 transition-colors flex items-center space-x-1">
                                            <span>{star}</span>
                                            <svg className="w-3.5 h-3.5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                                              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                            </svg>
                                          </span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : field.type === 'facility-select' ? (
                                <div>
                                  <label className="text-sm text-gray-600 dark:text-gray-400 block mb-2">{field.label}:</label>
                                  <div className="grid grid-cols-2 gap-2">
                                    {[
                                      { value: 'Mfg', label: '制造站' },
                                      { value: 'Trade', label: '贸易站' },
                                      { value: 'Power', label: '发电站' },
                                      { value: 'Control', label: '控制中枢' },
                                      { value: 'Reception', label: '会客室' },
                                      { value: 'Office', label: '办公室' },
                                      { value: 'Dorm', label: '宿舍' }
                                    ].map(facility => {
                                      const currentValue = Array.isArray(task.params[field.key]) ? task.params[field.key] : [];
                                      const isChecked = currentValue.includes(facility.value);
                                      return (
                                        <label key={facility.value} className="flex items-center space-x-1 text-sm text-gray-700 dark:text-gray-300 cursor-pointer group">
                                          <input
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={(e) => {
                                              const newValue = e.target.checked
                                                ? [...currentValue, facility.value]
                                                : currentValue.filter((f: string) => f !== facility.value);
                                              updateTaskParam(index, field.key, newValue);
                                            }}
                                            disabled={isRunning || !task.enabled}
                                            className="custom-checkbox cursor-pointer"
                                          />
                                          <span className="group-hover:text-violet-400 transition-colors">{facility.label}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : field.type === 'select' ? (
                                <div className="flex items-center space-x-2">
                                  <label className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap w-20">{field.label}:</label>
                                  <select
                                    value={task.params[field.key] || (Array.isArray(field.options) && field.options.length > 0 ? (typeof field.options[0] === 'object' ? field.options[0].value : field.options[0]) : '')}
                                    onChange={(e) => updateTaskParam(index, field.key, e.target.value)}
                                    disabled={isRunning || !task.enabled}
                                    className="flex-1 px-3 py-2 border border-gray-200 dark:border-white/10 hover:border-violet-400 dark:hover:border-violet-500/50 rounded-xl text-sm text-gray-900 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500 transition-all bg-white dark:bg-[#070707]"
                                  >
                                    {Array.isArray(field.options) && field.options.map((opt) => {
                                      const value = typeof opt === 'object' ? opt.value : opt
                                      const label = typeof opt === 'object' ? opt.label : opt
                                      return <option key={String(value)} value={String(value)}>{label}</option>
                                    })}
                                  </select>
                                </div>
                              ) : (
                                <div className="flex items-center space-x-2">
                                  <label className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap w-20">{field.label}:</label>
                                  {field.type === 'number' ? (
                                    <div className="number-input-wrapper flex-1">
                                      <input
                                        type="number"
                                        value={task.params[field.key] || ''}
                                        onChange={(e) => updateTaskParam(index, field.key, e.target.value)}
                                        placeholder={field.placeholder}
                                        step={field.step}
                                        min={field.min}
                                        max={field.max}
                                        disabled={isRunning || !task.enabled}
                                        className="w-full px-3 py-2 border border-gray-200 dark:border-white/10 hover:border-violet-400 dark:hover:border-violet-500/50 rounded-xl text-sm text-gray-900 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500 transition-all bg-white dark:bg-[#070707]"
                                      />
                                      <div className="number-input-controls">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const currentValue = Number(task.params[field.key]) || 0;
                                            const step = Number(field.step) || 1;
                                            const max = field.max !== undefined ? Number(field.max) : Infinity;
                                            const newValue = Math.min(currentValue + step, max);
                                            updateTaskParam(index, field.key, newValue.toString());
                                          }}
                                          disabled={isRunning || !task.enabled}
                                        >
                                          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                                          </svg>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const currentValue = Number(task.params[field.key]) || 0;
                                            const step = Number(field.step) || 1;
                                            const min = field.min !== undefined ? Number(field.min) : -Infinity;
                                            const newValue = Math.max(currentValue - step, min);
                                            updateTaskParam(index, field.key, newValue.toString());
                                          }}
                                          disabled={isRunning || !task.enabled}
                                        >
                                          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                          </svg>
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <input
                                      type={field.type}
                                      value={task.params[field.key] || ''}
                                      onChange={(e) => updateTaskParam(index, field.key, e.target.value)}
                                      placeholder={field.placeholder}
                                      step={field.step}
                                      min={field.min}
                                      max={field.max}
                                      disabled={isRunning || !task.enabled}
                                      className="flex-1 px-3 py-2 border border-gray-200 dark:border-white/10 hover:border-violet-400 dark:hover:border-violet-500/50 rounded-xl text-sm text-gray-900 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500 transition-all bg-white dark:bg-[#070707]"
                                    />
                                  )}
                                </div>
                              )}
                              {field.helper && (
                                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 flex items-start gap-1.5">
                                  <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
                                  </svg>
                                  <span>{field.helper}</span>
                                </p>
                              )}
                            </div>
                            );
                          })}
                        </div>
                      )}
                      
                      {/* 启动游戏任务的测试连接按钮 */}
                      {task.commandId === 'startup' && task.params?.adbPath && task.params?.address && (
                        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-white/10">
                          <button
                            onClick={() => testConnection(task.id, task.params.adbPath || '', task.params.address || '')}
                            disabled={isRunning || !task.enabled || testingConnection[task.id]}
                            className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600 disabled:from-violet-500/50 disabled:to-purple-500/50 text-white rounded-xl text-sm font-medium transition-all disabled:cursor-not-allowed shadow-[0_4px_12px_rgb(139,92,246,0.3)] hover:shadow-[0_6px_20px_rgb(139,92,246,0.4)] disabled:shadow-none"
                          >
                            {testingConnection[task.id] ? (
                              <>
                                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                <span>测试中...</span>
                              </>
                            ) : (
                              <>
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                                <span>测试连接</span>
                              </>
                            )}
                          </button>
                          
                          {/* 连接状态显示 */}
                          {connectionStatus[task.id] && (
                            <div className={`mt-3 p-3 rounded-xl text-sm flex items-start space-x-2 ${
                              connectionStatus[task.id]?.success 
                                ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-500/30'
                                : 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-300 dark:border-rose-500/30'
                            }`}>
                              {connectionStatus[task.id]?.success ? (
                                <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              ) : (
                                <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              )}
                              <span>{connectionStatus[task.id]?.message}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        </div>
      </div>
      
      {/* 通知设置弹窗 */}
      <NotificationSettings 
        isOpen={notificationSettingsOpen} 
        onClose={() => setNotificationSettingsOpen(false)} 
      />
    </>
  )
}
