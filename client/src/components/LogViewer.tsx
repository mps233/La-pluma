import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icons from './Icons'
import { maaApi } from '../services/api'
import { PageHeader, Card, CardHeader, CardContent, Button, Select, Checkbox, Loading } from './common'
import FloatingStatusIndicator from './FloatingStatusIndicator'
import type { LogViewerProps, LogEntry, LogFile } from '@/types/components'

export default function LogViewer({}: LogViewerProps) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [autoScroll, setAutoScroll] = useState<boolean>(true)
  const [filter, setFilter] = useState<'all' | 'ERROR' | 'WARN' | 'INFO' | 'DEBUG'>('all')
  const [historyFiles, setHistoryFiles] = useState<LogFile[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [selectedFile, setSelectedFile] = useState<LogFile | null>(null)
  const [viewingHistory, setViewingHistory] = useState<boolean>(false)
  const logEndRef = useRef<HTMLDivElement>(null)
  const logContainerRef = useRef<HTMLDivElement>(null)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // 解析日志行
  const parseLogLine = (log: any): LogEntry => {
    // 后端返回的日志格式: { time: ISO时间, level: 'INFO', message: '消息' }
    const date = new Date(log.time)
    const timeStr = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`
    
    return {
      time: timeStr,
      level: log.level,
      message: log.message
    }
  }

  // 获取实时日志
  const loadRealtimeLogs = async () => {
    if (viewingHistory) return // 查看历史日志时不更新
    
    try {
      const result = await maaApi.getRealtimeLogs(200)
      if (result.success && result.data.length > 0) {
        const parsedLogs = result.data.map(parseLogLine)
        setLogs(parsedLogs)
      } else if (result.success && result.data.length === 0) {
        // 没有日志时显示提示
        if (logs.length === 0) {
          const now = new Date()
          const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
          setLogs([
            { time: timeStr, level: 'INFO', message: 'MAA WebUI 已启动，等待任务执行...' }
          ])
        }
      }
    } catch (error) {
      // 静默失败，不影响用户体验
    }
  }

  // 获取历史日志文件列表
  const loadHistoryFiles = async () => {
    try {
      const result = await maaApi.getLogFiles()
      if (result.success) {
        setHistoryFiles(result.data)
      }
    } catch (error) {
      // 静默失败，不影响用户体验
    }
  }

  // 查看历史日志文件
  const viewHistoryFile = async (file: LogFile) => {
    setLoading(true)
    setViewingHistory(true)
    setSelectedFile(file)
    setAutoScroll(false) // 查看历史日志时禁用自动滚动
    
    try {
      const result = await maaApi.readLogFile(file.path, 1000)
      if (result.success) {
        const lines = result.data.content.split('\n').filter((line: string) => line.trim())
        const parsedLogs = lines.map((line: string) => {
          // MAA 日志格式: [2026-02-01 18:23:28 ERROR] 消息内容
          const match = line.match(/\[(\d{4}-\d{2}-\d{2} (\d{2}:\d{2}:\d{2})) (\w+)\] (.+)/)
          if (match) {
            return {
              time: match[2],
              level: match[3] as LogEntry['level'],
              message: match[4]
            }
          }
          return {
            time: '',
            level: 'INFO' as const,
            message: line
          }
        })
        setLogs(parsedLogs)
      }
    } catch (error) {
      // 显示错误信息给用户
      const now = new Date()
      const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
      setLogs([
        { time: timeStr, level: 'ERROR', message: `读取日志文件失败: ${(error as Error).message}` }
      ])
    } finally {
      setLoading(false)
    }
  }

  // 返回实时日志
  const backToRealtime = () => {
    setViewingHistory(false)
    setSelectedFile(null)
    setAutoScroll(true) // 返回实时日志时启用自动滚动
    loadRealtimeLogs()
  }

  useEffect(() => {
    let isSubscribed = true
    
    // 初始化
    loadHistoryFiles()
    
    // 只在非历史查看模式下轮询实时日志
    if (!viewingHistory) {
      loadRealtimeLogs()
      pollIntervalRef.current = setInterval(() => {
        if (isSubscribed && !viewingHistory) {
          loadRealtimeLogs()
        }
      }, 1000)
    }

    return () => {
      isSubscribed = false
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }
  }, [viewingHistory])

  useEffect(() => {
    if (autoScroll && !viewingHistory && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logs, autoScroll, viewingHistory])

  const getLevelColor = (level: LogEntry['level']): string => {
    switch (level) {
      case 'ERROR': return 'text-rose-700 dark:text-rose-400 bg-rose-100 dark:bg-rose-500/10 border-rose-300 dark:border-rose-500/30'
      case 'WARN': return 'text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-500/10 border-amber-300 dark:border-amber-500/30'
      case 'INFO': return 'text-sky-700 dark:text-sky-400 bg-sky-100 dark:bg-sky-500/10 border-sky-300 dark:border-sky-500/30'
      case 'DEBUG': return 'text-gray-700 dark:text-gray-400 bg-gray-100 dark:bg-gray-500/10 border-gray-300 dark:border-gray-500/30'
      default: return 'text-gray-700 dark:text-gray-400 bg-gray-100 dark:bg-gray-500/10 border-gray-300 dark:border-gray-500/30'
    }
  }

  const filteredLogs = filter === 'all' 
    ? logs 
    : logs.filter(log => log.level === filter)

  const clearLogs = async () => {
    try {
      await maaApi.clearRealtimeLogs()
      setLogs([])
    } catch (error) {
      // 静默失败，不影响用户体验
    }
  }

  const exportLogs = () => {
    const logText = logs.map(log => `[${log.time}] [${log.level}] ${log.message}`).join('\n')
    const blob = new Blob([logText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `maa-log-${new Date().toISOString().split('T')[0]}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const cleanupHistoryLogs = async () => {
    if (!confirm('确定要清理旧日志文件吗？只会保留最新 10MB 的日志。')) {
      return
    }
    
    try {
      const result = await maaApi.cleanupLogs(10)
      if (result.success) {
        alert(result.message)
        loadHistoryFiles() // 重新加载日志列表
      }
    } catch (error) {
      alert('清理日志失败: ' + (error as Error).message)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        icon={<Icons.DocumentTextIcon />}
        title="日志查看器"
        subtitle="实时查看和管理 MAA 运行日志"
        gradientFrom="cyan-400"
        gradientVia="blue-400"
        gradientTo="indigo-400"
        actions={<FloatingStatusIndicator />}
      />

      <Card animated delay={0.1} theme="cyan">
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Checkbox
                checked={autoScroll}
                onChange={(checked: boolean) => setAutoScroll(checked)}
                label="自动滚动"
              />
              <Select
                value={filter}
                onChange={(value: string) => setFilter(value as typeof filter)}
                options={[
                  { value: 'all', label: '全部日志' },
                  { value: 'ERROR', label: '错误' },
                  { value: 'WARN', label: '警告' },
                  { value: 'INFO', label: '信息' },
                  { value: 'DEBUG', label: '调试' }
                ]}
              />
            </div>
            <div className="flex items-center space-x-2">
              <Button
                onClick={clearLogs}
                variant="outline"
                size="sm"
              >
                清空日志
              </Button>
              <Button
                onClick={exportLogs}
                variant="gradient"
                gradientFrom="cyan"
                gradientTo="blue"
                size="sm"
              >
                导出日志
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card animated delay={0.2} theme="cyan">
        <CardHeader 
          title={viewingHistory ? `历史日志: ${selectedFile?.name}` : '实时日志'}
          actions={
            viewingHistory ? (
              <Button
                onClick={backToRealtime}
                variant="outline"
                size="sm"
                className="text-cyan-700 dark:text-cyan-400 border-cyan-300 dark:border-cyan-500/30 hover:bg-cyan-50 dark:hover:bg-cyan-500/10"
              >
                返回实时日志
              </Button>
            ) : undefined
          }
        />
        <CardContent>
          {loading ? (
            <Loading text="加载中..." />
          ) : (
            <>
              {!viewingHistory && logs.length === 0 && (
                <div className="mb-3 p-3 rounded-xl bg-gray-100 dark:bg-gray-500/10 border border-gray-200 dark:border-gray-500/30">
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    等待任务执行...
                  </p>
                </div>
              )}
              <div 
                ref={logContainerRef}
                className="rounded-2xl p-5 h-96 overflow-y-auto font-mono text-sm bg-gray-50 dark:bg-[#000000]"
              >
                <AnimatePresence>
                  {filteredLogs.map((log, index) => (
                    <motion.div 
                      key={index} 
                      className="flex items-start space-x-3 mb-2"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.01 }}
                    >
                      {log.time && <span className="text-gray-500 dark:text-gray-600 flex-shrink-0">{log.time}</span>}
                      <span className={`px-2 py-0.5 rounded-lg text-xs font-semibold flex-shrink-0 border ${getLevelColor(log.level)}`}>
                        {log.level}
                      </span>
                      <span className="text-gray-800 dark:text-gray-300 flex-1 break-all">{log.message}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
                <div ref={logEndRef} />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card animated delay={0.3} theme="cyan">
        <CardHeader 
          title="历史日志文件"
          actions={
            <Button
              onClick={cleanupHistoryLogs}
              variant="outline"
              size="sm"
              className="text-rose-700 dark:text-rose-400 border-rose-300 dark:border-rose-500/30 bg-rose-50 dark:bg-transparent hover:bg-rose-100 dark:hover:bg-rose-500/10"
            >
              清理旧日志
            </Button>
          }
        />
        <CardContent>
          <div className="space-y-3">
            {historyFiles.length > 0 ? (
              historyFiles.map((file, index) => (
                <motion.div 
                  key={file.path} 
                  onClick={() => viewHistoryFile(file)}
                  className="flex items-center justify-between p-4 border border-gray-200 dark:border-white/10 rounded-2xl hover:border-cyan-400 dark:hover:border-cyan-500/30 hover:shadow-[0_4px_12px_rgba(6,182,212,0.1)] transition-all cursor-pointer bg-gray-50 dark:bg-gray-800/40"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 + index * 0.1 }}
                  whileHover={{ x: 4 }}
                >
                  <div className="flex items-center space-x-3 flex-1">
                    <span className="text-2xl">📄</span>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-200">{file.name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                        {new Date(file.modified).toLocaleString('zh-CN')} · {(file.size / 1024).toFixed(2)} KB
                      </div>
                    </div>
                  </div>
                  <motion.button 
                    className="text-sm text-cyan-600 dark:text-cyan-400 hover:text-cyan-700 dark:hover:text-cyan-300 font-medium transition-colors"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    查看
                  </motion.button>
                </motion.div>
              ))
            ) : (
              <div className="text-center py-8 text-gray-500 dark:text-gray-500">
                <p className="text-sm">暂无历史日志文件</p>
                <p className="text-xs mt-2">执行任务后会自动生成日志文件</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
