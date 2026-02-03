import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icons from './Icons'
import { maaApi } from '../services/api'

export default function LogViewer() {
  const [logs, setLogs] = useState([])
  const [autoScroll, setAutoScroll] = useState(true)
  const [filter, setFilter] = useState('all')
  const [historyFiles, setHistoryFiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedFile, setSelectedFile] = useState(null)
  const [viewingHistory, setViewingHistory] = useState(false)
  const logEndRef = useRef(null)
  const logContainerRef = useRef(null)
  const pollIntervalRef = useRef(null)

  // 解析日志行
  const parseLogLine = (log) => {
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
      console.error('获取实时日志失败:', error)
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
      console.error('获取历史日志失败:', error)
    }
  }

  // 查看历史日志文件
  const viewHistoryFile = async (file) => {
    setLoading(true)
    setViewingHistory(true)
    setSelectedFile(file)
    setAutoScroll(false) // 查看历史日志时禁用自动滚动
    
    try {
      const result = await maaApi.readLogFile(file.path, 1000)
      if (result.success) {
        const lines = result.data.content.split('\n').filter(line => line.trim())
        const parsedLogs = lines.map(line => {
          // MAA 日志格式: [2026-02-01 18:23:28 ERROR] 消息内容
          const match = line.match(/\[(\d{4}-\d{2}-\d{2} (\d{2}:\d{2}:\d{2})) (\w+)\] (.+)/)
          if (match) {
            return {
              time: match[2],
              level: match[3],
              message: match[4]
            }
          }
          return {
            time: '',
            level: 'INFO',
            message: line
          }
        })
        setLogs(parsedLogs)
      }
    } catch (error) {
      console.error('读取日志文件失败:', error)
      const now = new Date()
      const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
      setLogs([
        { time: timeStr, level: 'ERROR', message: `读取日志文件失败: ${error.message}` }
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

  const getLevelColor = (level) => {
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
      console.error('清空日志失败:', error)
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
      console.error('清理日志失败:', error)
      alert('清理日志失败: ' + error.message)
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* 页面标题 */}
      <motion.div 
        className="flex items-center justify-between"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center space-x-3">
          <Icons.DocumentTextIcon />
          <div>
            <h2 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-400 bg-clip-text text-transparent">
              日志查看器
            </h2>
            <p className="text-gray-600 dark:text-gray-500 text-sm hidden sm:block">实时查看和管理 MAA 运行日志</p>
          </div>
        </div>
      </motion.div>

      {/* 控制栏 */}
      <motion.div 
        className="rounded-3xl p-5 border border-gray-200 dark:border-white/10 bg-white dark:bg-gray-900/60"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <label className="flex items-center space-x-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="custom-checkbox-cyan cursor-pointer"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors">自动滚动</span>
            </label>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 dark:border-white/10 hover:border-cyan-400 dark:hover:border-cyan-500/50 rounded-xl text-sm text-gray-900 dark:text-gray-200 bg-white dark:bg-[#070707] focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-all"
            >
              <option value="all">全部日志</option>
              <option value="ERROR">错误</option>
              <option value="WARN">警告</option>
              <option value="INFO">信息</option>
              <option value="DEBUG">调试</option>
            </select>
          </div>
          <div className="flex items-center space-x-2">
            <motion.button 
              onClick={clearLogs}
              className="px-4 py-2 text-sm text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-white/10 rounded-xl transition-all bg-gray-50 dark:bg-gray-800/60"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              清空日志
            </motion.button>
            <motion.button 
              onClick={exportLogs}
              className="px-4 py-2 text-sm text-white bg-gradient-to-r from-cyan-500 to-blue-500 rounded-xl hover:from-cyan-600 hover:to-blue-600 transition-all"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              导出日志
            </motion.button>
          </div>
        </div>
      </motion.div>

      {/* 日志显示区域 */}
      <motion.div 
        className="rounded-3xl border border-gray-200 dark:border-white/10 overflow-hidden bg-white dark:bg-gray-900/60"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="px-6 py-4 border-b border-gray-200 dark:border-white/10">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              {viewingHistory ? `历史日志: ${selectedFile?.name}` : '实时日志'}
            </h3>
            {viewingHistory && (
              <motion.button
                onClick={backToRealtime}
                className="px-3 py-1.5 text-sm text-cyan-700 dark:text-cyan-400 border border-cyan-300 dark:border-cyan-500/30 rounded-lg hover:bg-cyan-50 dark:hover:bg-cyan-500/10 transition-all"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                返回实时日志
              </motion.button>
            )}
          </div>
        </div>
        <div className="p-5">
          {loading ? (
            <div className="flex items-center justify-center h-96">
              <div className="text-center">
                <svg className="w-8 h-8 animate-spin text-cyan-500 dark:text-cyan-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <p className="text-sm text-gray-600 dark:text-gray-400">加载中...</p>
              </div>
            </div>
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
        </div>
      </motion.div>

      {/* 历史日志 */}
      <motion.div 
        className="rounded-3xl border border-gray-200 dark:border-white/10 bg-white dark:bg-gray-900/60"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <div className="px-6 py-4 border-b border-gray-200 dark:border-white/10 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">历史日志文件</h3>
          <motion.button
            onClick={cleanupHistoryLogs}
            className="px-3 py-1.5 text-sm text-rose-700 dark:text-rose-400 border border-rose-300 dark:border-rose-500/30 rounded-lg bg-rose-50 dark:bg-transparent hover:bg-rose-100 dark:hover:bg-rose-500/10 transition-all"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            清理旧日志
          </motion.button>
        </div>
        <div className="p-6">
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
        </div>
      </motion.div>
    </div>
  )
}
