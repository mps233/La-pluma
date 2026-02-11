import { useState, useEffect } from 'react'
import { maaApi } from '../services/api'
import Icons from './Icons'
import { PageHeader, StatusIndicator, Card, InfoCard, Input, Select, Checkbox, Button } from './common'
import type { 
  RoguelikeTasksProps, 
  RoguelikeTask, 
  RoguelikeAdvancedOption,
  RoguelikeTaskInputs,
  RoguelikeAdvancedParams
} from '@/types/components'

export default function RoguelikeTasks(_props: RoguelikeTasksProps) {
  const [isRunning, setIsRunning] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string>('')
  const [taskInputs, setTaskInputs] = useState<RoguelikeTaskInputs>({})
  const [advancedParams, setAdvancedParams] = useState<RoguelikeAdvancedParams>({})

  // 页面加载时从服务器或 localStorage 加载配置和恢复执行状态
  useEffect(() => {
    // 从后端获取真实的任务执行状态
    const checkBackendStatus = async () => {
      try {
        const result = await maaApi.getTaskStatus()
        if (result.success && result.data.isRunning) {
          // 后端确实有任务在运行
          const { taskName, startTime, taskType } = result.data
          
          // 只恢复属于肉鸽模式的任务
          if (taskType === 'roguelike') {
            const elapsedMinutes = (Date.now() - startTime) / 1000 / 60
            setIsRunning(true)
            if (elapsedMinutes > 5) {
              setStatusMessage(`${taskName} 可能已完成（已运行 ${Math.floor(elapsedMinutes)} 分钟）`)
            } else {
              setStatusMessage(`正在执行: ${taskName}`)
            }
            
            // 启动轮询，持续检查任务状态
            const pollInterval = setInterval(async () => {
              try {
                const statusResult = await maaApi.getTaskStatus()
                if (statusResult.success && !statusResult.data.isRunning) {
                  // 任务已完成
                  setIsRunning(false)
                  setStatusMessage('✓ 任务已完成')
                  await new Promise(resolve => setTimeout(resolve, 2000))
                  setStatusMessage('')
                  clearInterval(pollInterval)
                }
              } catch (error) {
                // 静默失败，不影响用户体验
                clearInterval(pollInterval)
              }
            }, 2000) // 每2秒检查一次
            
            // 组件卸载时清除轮询
            return () => clearInterval(pollInterval)
          }
        }
      } catch (error) {
        // 静默失败，不影响用户体验
      }
    }
    
    checkBackendStatus()
    
    // 加载保存的配置 - 优先从服务器加载
    const loadConfig = async () => {
      try {
        const serverConfig = await maaApi.loadUserConfig('roguelike-tasks')
        if (serverConfig.success && serverConfig.data) {
          const { taskInputs: inputs, advancedParams: advanced } = serverConfig.data
          if (inputs) {
            setTaskInputs(inputs)
            localStorage.setItem('roguelikeTaskInputs', JSON.stringify(inputs))
          }
          if (advanced) {
            setAdvancedParams(advanced)
            localStorage.setItem('roguelikeAdvancedParams', JSON.stringify(advanced))
          }
          return
        }
      } catch (error) {
        // 静默失败，从 localStorage 加载
      }
      
      // 服务器加载失败，从 localStorage 加载
      const savedInputs = localStorage.getItem('roguelikeTaskInputs')
      const savedAdvanced = localStorage.getItem('roguelikeAdvancedParams')
      
      if (savedInputs) {
        setTaskInputs(JSON.parse(savedInputs))
      }
      if (savedAdvanced) {
        setAdvancedParams(JSON.parse(savedAdvanced))
      }
    }
    
    loadConfig()
  }, [])

  // 自动保存配置
  useEffect(() => {
    localStorage.setItem('roguelikeTaskInputs', JSON.stringify(taskInputs))
    // 同时保存到服务器（静默失败）
    maaApi.saveUserConfig('roguelike-tasks', { taskInputs, advancedParams }).catch(() => {
      // 静默失败，不影响用户体验
    })
  }, [taskInputs, advancedParams])
  
  useEffect(() => {
    localStorage.setItem('roguelikeAdvancedParams', JSON.stringify(advancedParams))
    // 同时保存到服务器（静默失败）
    maaApi.saveUserConfig('roguelike-tasks', { taskInputs, advancedParams }).catch(() => {
      // 静默失败，不影响用户体验
    })
  }, [advancedParams, taskInputs])

  const tasks: RoguelikeTask[] = [
    { 
      id: 'roguelike', 
      name: '集成战略', 
      command: 'roguelike', 
      placeholder: '主题 (Phantom/Mizuki/Sami/Sarkaz/JieGarden)', 
      icon: 'Map', 
      hasAdvanced: true,
      description: '自动刷集成战略（肉鸽），支持多个主题'
    },
    { 
      id: 'reclamation', 
      name: '生息演算', 
      command: 'reclamation', 
      placeholder: '主题 (Tales)', 
      icon: 'Plant', 
      hasAdvanced: true,
      description: '自动生息演算模式'
    },
  ]

  const getAdvancedOptions = (taskId: string): RoguelikeAdvancedOption[] => {
    const options: Record<string, RoguelikeAdvancedOption[]> = {
      roguelike: [
        { key: 'mode', label: '模式', type: 'select', param: '--mode', options: [
          { value: '0', label: '刷分模式' },
          { value: '1', label: '刷源石锭' },
          { value: '4', label: '3层后退出' },
        ]},
        { key: 'squad', label: '起始分队', type: 'text', param: '--squad', placeholder: '指挥分队' },
        { key: 'coreChar', label: '核心干员', type: 'text', param: '--core-char', placeholder: '维什戴尔' },
        { key: 'startCount', label: '运行次数', type: 'number', param: '--start-count', placeholder: '无限' },
        { key: 'useSupport', label: '使用助战', type: 'checkbox', param: '--use-support' },
        { key: 'stopAtBoss', label: '最终Boss前停止', type: 'checkbox', param: '--stop-at-final-boss' },
      ],
      reclamation: [
        { key: 'mode', label: '模式', type: 'select', param: '-m', options: [
          { value: '0', label: '刷繁荣度（无存档）' },
          { value: '1', label: '制作工具刷繁荣度' },
        ]},
        { key: 'toolsToCraft', label: '制作工具名称', type: 'text', param: '-C', placeholder: '荧光棒' },
        { key: 'numBatches', label: '批次数', type: 'number', param: '--num-craft-batches', placeholder: '16' },
      ],
    }
    return options[taskId] || []
  }

  const buildCommandParams = (task: RoguelikeTask): string => {
    let params = taskInputs[task.id] || ''
    
    const advanced = advancedParams[task.id] || {}
    const options = getAdvancedOptions(task.id)
    
    options.forEach(option => {
      const value = advanced[option.key]
      if (value !== undefined && value !== '' && value !== false) {
        if (option.type === 'checkbox' && value === true) {
          params += ` ${option.param}`
        } else if (option.type !== 'checkbox') {
          params += ` ${option.param} ${value}`
        }
      }
    })
    
    return params
  }

  const handleExecute = async (task: RoguelikeTask) => {
    setIsRunning(true)
    setStatusMessage('正在执行命令...')
    
    try {
      const params = buildCommandParams(task)
      const result = await maaApi.executePredefinedTask(task.command, params, null, null, task.name, 'roguelike')
      
      if (result.success) {
        setStatusMessage(`✓ ${task.name} 执行成功`)
        await new Promise(resolve => setTimeout(resolve, 2000))
        setStatusMessage('')
      } else {
        setStatusMessage(`❌ 执行失败: ${result.error}`)
        await new Promise(resolve => setTimeout(resolve, 2000))
        setStatusMessage('')
      }
    } catch (error) {
      setStatusMessage(`❌ 网络错误: ${(error as Error).message}`)
      await new Promise(resolve => setTimeout(resolve, 2000))
      setStatusMessage('')
    } finally {
      setTimeout(() => {
        setIsRunning(false)
      }, 1000)
    }
  }

  const handleInputChange = (taskId: string, value: string) => {
    setTaskInputs({ ...taskInputs, [taskId]: value })
  }

  const handleAdvancedChange = (taskId: string, key: string, value: string | number | boolean) => {
    setAdvancedParams({
      ...advancedParams,
      [taskId]: {
        ...(advancedParams[taskId] || {}),
        [key]: value
      }
    })
  }

  const renderAdvancedOptions = (task: RoguelikeTask) => {
    const options = getAdvancedOptions(task.id)
    if (options.length === 0) return null
    
    const advanced = advancedParams[task.id] || {}
    
    return (
      <div className="space-y-3">
        {options.map(option => (
          <div key={option.key}>
            {option.type === 'checkbox' ? (
              <Checkbox
                checked={advanced[option.key] as boolean || false}
                onChange={(checked: boolean) => handleAdvancedChange(task.id, option.key, checked)}
                label={option.label}
              />
            ) : option.type === 'select' && option.options ? (
              <Select
                label={option.label}
                value={(advanced[option.key] as string) || (option.options[0]?.value || '')}
                onChange={(value: string) => handleAdvancedChange(task.id, option.key, value)}
                options={option.options}
              />
            ) : (
              <Input
                type={option.type === 'number' ? 'number' : 'text'}
                label={option.label}
                value={advanced[option.key] as string || ''}
                onChange={(value: string) => handleAdvancedChange(task.id, option.key, value)}
                placeholder={option.placeholder}
              />
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        icon={<Icons.DiceIcon />}
        title="肉鸽模式"
        subtitle="集成战略和生息演算 - 所有修改自动保存"
        gradientFrom="purple-400"
        gradientVia="fuchsia-400"
        gradientTo="pink-400"
        actions={
          <StatusIndicator
            isActive={isRunning}
            message={statusMessage}
            activeText="运行中"
            inactiveText="就绪"
            activeColor="fuchsia-400"
          />
        }
      />

      <InfoCard type="warning">
        <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-400 mb-3 flex items-center space-x-2">
          <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
          </svg>
          <span>使用说明</span>
        </h3>
        <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1.5">
          <li>• <strong className="text-gray-800 dark:text-gray-300">集成战略</strong>：支持 Phantom（傀影）、Mizuki（水月）、Sami（萨米）、Sarkaz（萨卡兹）、JieGarden（界园）</li>
          <li>• <strong className="text-gray-800 dark:text-gray-300">生息演算</strong>：支持 Tales（沙中之火）主题</li>
          <li>• 可以设置刷分模式或刷源石锭模式</li>
          <li>• 点击"高级选项"可以配置起始分队、核心干员、运行次数等</li>
        </ul>
      </InfoCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {tasks.map((task) => {
          const IconComponent = Icons[task.icon as keyof typeof Icons]
          
          return (
            <Card 
              key={task.id}
              theme="purple"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center space-x-3">
                  {IconComponent && <IconComponent />}
                  <h4 className="font-bold text-gray-900 dark:text-white text-xl">{task.name}</h4>
                  <span className="text-xs text-gray-500 dark:text-gray-500 px-3 py-1.5 rounded-full font-mono border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-gray-800/60">{task.command}</span>
                </div>
                
                <Button
                  onClick={() => handleExecute(task)}
                  disabled={isRunning}
                  variant="gradient"
                  gradientFrom="purple"
                  gradientTo="fuchsia"
                  size="sm"
                  icon={
                    <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                    </svg>
                  }
                >
                  立即执行
                </Button>
              </div>
              
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-5 leading-relaxed">{task.description}</p>
              
              <Input
                type="text"
                placeholder={task.placeholder}
                value={taskInputs[task.id] || ''}
                onChange={(value: string) => handleInputChange(task.id, value)}
                className="mb-5"
              />
              
              {task.hasAdvanced && (
                <div className="rounded-2xl p-4 border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-gray-800/40">
                  <h5 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">高级选项</h5>
                  {renderAdvancedOptions(task)}
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
