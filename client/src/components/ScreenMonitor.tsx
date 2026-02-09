/**
 * Screen Monitor Component
 * 模拟器监控组件 - 定时截图显示模拟器画面
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import Icons from './Icons'
import { useApiMutation } from '../hooks/useApi'
import { Button } from './common'

// 自动检测 API 地址
const getApiBaseUrl = (): string => {
  const hostname = window.location.hostname
  const port = window.location.port || '3000'
  
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `http://localhost:${port}/api`
  }
  return `http://${hostname}:${port}/api`
}

interface ScreenshotResponse {
  success: boolean
  data?: {
    image: string
    timestamp?: string
  }
  screenshot?: {
    image: string
    timestamp?: string
  }
  error?: string
}

// 截图 API 函数
const fetchScreenshot = async (address: string, adbPath: string): Promise<ScreenshotResponse> => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000) // 10秒超时
  
  try {
    const response = await fetch(
      `${getApiBaseUrl()}/maa/screenshot`,
      { 
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ address, adbPath }),
        signal: controller.signal 
      }
    )
    
    clearTimeout(timeoutId)
    return await response.json()
  } catch (err) {
    clearTimeout(timeoutId)
    if ((err as Error).name === 'AbortError') {
      throw new Error('截图超时，请检查设备连接')
    }
    throw new Error('网络错误或设备未连接')
  }
}

interface ScreenMonitorProps {
  adbPath?: string
  address?: string
}

export default function ScreenMonitor({ 
  adbPath = '/opt/homebrew/bin/adb', 
  address = '127.0.0.1:16384' 
}: ScreenMonitorProps) {
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [isCapturing, setIsCapturing] = useState(false)
  const [refreshInterval, setRefreshInterval] = useState(3) // 默认 3 秒
  const [lastUpdateTime, setLastUpdateTime] = useState<Date | null>(null)
  const isRequestingRef = useRef(false) // 防止并发请求
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  // 使用 useApiMutation 处理截图请求
  const { error, execute: executeScreenshot } = useApiMutation(
    () => fetchScreenshot(address, adbPath),
    {
      onSuccess: (data: any) => {
        if (data?.image) {
          setScreenshot(data.image)
          setLastUpdateTime(new Date())
        } else if (typeof data === 'string') {
          setScreenshot(data)
          setLastUpdateTime(new Date())
        }
      },
      onError: () => {
        // 静默失败，错误信息已通过 error 状态显示
      }
    }
  )

  const captureScreenshot = useCallback(async () => {
    // 如果正在请求中，跳过
    if (isRequestingRef.current) {
      return
    }

    isRequestingRef.current = true
    
    try {
      await executeScreenshot()
    } finally {
      isRequestingRef.current = false
    }
  }, [executeScreenshot])

  useEffect(() => {
    // 清理旧的定时器
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    
    if (isCapturing) {
      // 立即截图一次
      captureScreenshot()
      
      // 设置定时器
      timerRef.current = setInterval(() => {
        captureScreenshot()
      }, refreshInterval * 1000)
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [isCapturing, refreshInterval, captureScreenshot])

  const toggleCapture = () => {
    setIsCapturing(!isCapturing)
  }

  return (
    <div className="space-y-4">
      {/* 控制栏 - 标题和所有控制按钮在同一行 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center space-x-3">
          <Icons.Monitor />
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">模拟器监控</h3>
        </div>
        
        <div className="flex items-center space-x-2 sm:space-x-3 flex-1 sm:flex-initial justify-end">
          <Button
            onClick={toggleCapture}
            variant="outline"
            size="sm"
            className={
              isCapturing
                ? 'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 border-red-300 dark:border-red-500/30 hover:bg-red-200 dark:hover:bg-red-500/30 focus:ring-0 focus:outline-none'
                : 'bg-violet-100 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400 border-violet-300 dark:border-violet-500/30 hover:bg-violet-200 dark:hover:bg-violet-500/30 focus:ring-0 focus:outline-none'
            }
            icon={
              isCapturing ? (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                </svg>
              )
            }
          >
            <span className="hidden sm:inline">{isCapturing ? '停止' : '开始'}</span>
          </Button>

          {/* 刷新间隔选择 - 始终显示 */}
          <div style={{ height: '32px' }} className="flex items-center space-x-1.5 sm:space-x-2 px-2 sm:px-3 rounded-lg bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10">
            <span className="text-gray-500 dark:text-gray-400 text-xs hidden sm:inline">间隔:</span>
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              disabled={isCapturing}
              className={`bg-transparent text-violet-500 dark:text-violet-400 text-xs sm:text-sm font-semibold focus:outline-none ${isCapturing ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
            >
              <option value={1}>1秒</option>
              <option value={2}>2秒</option>
              <option value={3}>3秒</option>
              <option value={5}>5秒</option>
              <option value={10}>10秒</option>
            </select>
          </div>

          {/* 手动截图按钮 */}
          {!isCapturing && (
            <Button
              onClick={captureScreenshot}
              variant="outline"
              size="sm"
              className="focus:ring-0 focus:outline-none"
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              }
            >
              <span className="hidden sm:inline">截图</span>
            </Button>
          )}
        </div>
      </div>

      {/* 截图显示 */}
      <div className="rounded-2xl overflow-hidden border border-gray-200 dark:border-white/10 bg-gray-100 dark:bg-black/50 transition-colors">
        {screenshot ? (
          <div>
            <div className="relative">
              <img
                src={`data:image/png;base64,${screenshot}`}
                alt="Screen Monitor"
                className="w-full h-auto"
                style={{ maxHeight: '70vh', objectFit: 'contain', backgroundColor: '#000' }}
              />
              {isCapturing && (
                <div className="absolute top-4 right-4 px-3 py-1.5 rounded-lg bg-violet-500/20 border border-violet-500/30 backdrop-blur-sm">
                  <div className="flex items-center space-x-2">
                    <motion.div
                      className="w-2 h-2 rounded-full bg-violet-400"
                      animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    />
                    <span className="text-xs text-violet-300 font-medium">监控中</span>
                  </div>
                </div>
              )}
            </div>
            {/* 时间戳显示在截图下方 */}
            <div className="px-4 py-2 bg-gray-50 dark:bg-white/5 border-t border-gray-200 dark:border-white/10 transition-colors">
              <div className="flex items-center justify-center space-x-2">
                <svg className="w-3.5 h-3.5 text-violet-500 dark:text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-xs text-gray-600 dark:text-gray-400">
                  {lastUpdateTime ? lastUpdateTime.toLocaleTimeString('zh-CN', { hour12: false }) : '--:--:--'}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div className="aspect-[16/9] flex flex-col items-center justify-center text-gray-400">
              {error ? (
                <>
                  <svg className="w-16 h-16 mb-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" 
                          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  <p className="text-lg font-medium text-red-400 mb-2">{error}</p>
                  <p className="text-sm text-gray-400">请使用以下命令连接模拟器：</p>
                  <code className="block mt-2 px-4 py-2 bg-black/50 rounded-lg text-xs text-gray-300 font-mono">
                    {adbPath} connect {address}
                  </code>
                </>
              ) : (
                <>
                  <svg className="w-16 h-16 mb-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" 
                          d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <p className="text-lg font-medium text-gray-700 dark:text-gray-300">点击"开始"或"截图"查看模拟器画面</p>
                  <p className="text-sm mt-2 opacity-60 text-gray-600 dark:text-gray-400">定时截图监控</p>
                </>
              )}
            </div>
            {/* 时间戳显示区域（无截图时） */}
            <div className="px-4 py-2 bg-gray-50 dark:bg-white/5 border-t border-gray-200 dark:border-white/10 transition-colors">
              <div className="flex items-center justify-center space-x-2">
                <svg className="w-3.5 h-3.5 text-violet-500 dark:text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-xs text-gray-600 dark:text-gray-400">--:--:--</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
