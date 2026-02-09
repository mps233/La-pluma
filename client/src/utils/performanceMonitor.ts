/**
 * 性能监控工具
 */

interface PerformanceMetric {
  name: string
  startTime: number
  endTime?: number
  duration?: number
  metadata?: Record<string, any>
}

class PerformanceMonitor {
  private metrics: Map<string, PerformanceMetric> = new Map()
  private enabled: boolean = true

  /**
   * 启用性能监控
   */
  enable(): void {
    this.enabled = true
  }

  /**
   * 禁用性能监控
   */
  disable(): void {
    this.enabled = false
  }

  /**
   * 开始测量
   */
  start(name: string, metadata?: Record<string, any>): void {
    if (!this.enabled) return

    this.metrics.set(name, {
      name,
      startTime: performance.now(),
      metadata
    })
  }

  /**
   * 结束测量
   */
  end(name: string): number | null {
    if (!this.enabled) return null

    const metric = this.metrics.get(name)
    if (!metric) {
      console.warn(`Performance metric "${name}" not found`)
      return null
    }

    const endTime = performance.now()
    const duration = endTime - metric.startTime

    metric.endTime = endTime
    metric.duration = duration

    // 记录到控制台
    console.log(`[Performance] ${name}: ${duration.toFixed(2)}ms`, metric.metadata)

    return duration
  }

  /**
   * 测量函数执行时间
   */
  async measure<T>(
    name: string,
    fn: () => T | Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> {
    if (!this.enabled) return fn()

    this.start(name, metadata)
    try {
      const result = await fn()
      this.end(name)
      return result
    } catch (error) {
      this.end(name)
      throw error
    }
  }

  /**
   * 获取指标
   */
  getMetric(name: string): PerformanceMetric | undefined {
    return this.metrics.get(name)
  }

  /**
   * 获取所有指标
   */
  getAllMetrics(): PerformanceMetric[] {
    return Array.from(this.metrics.values())
  }

  /**
   * 清除指标
   */
  clear(): void {
    this.metrics.clear()
  }

  /**
   * 获取页面加载性能
   */
  getPageLoadMetrics(): Record<string, number> | null {
    if (!window.performance || !window.performance.timing) {
      return null
    }

    const timing = window.performance.timing
    const navigation = timing.navigationStart

    return {
      // DNS 查询时间
      dns: timing.domainLookupEnd - timing.domainLookupStart,
      // TCP 连接时间
      tcp: timing.connectEnd - timing.connectStart,
      // 请求时间
      request: timing.responseStart - timing.requestStart,
      // 响应时间
      response: timing.responseEnd - timing.responseStart,
      // DOM 解析时间
      domParse: timing.domInteractive - timing.domLoading,
      // DOM 内容加载完成时间
      domContentLoaded: timing.domContentLoadedEventEnd - navigation,
      // 页面完全加载时间
      pageLoad: timing.loadEventEnd - navigation,
      // 首次渲染时间
      firstPaint: this.getFirstPaint(),
      // 首次内容渲染时间
      firstContentfulPaint: this.getFirstContentfulPaint()
    }
  }

  /**
   * 获取首次渲染时间
   */
  private getFirstPaint(): number {
    const paint = performance.getEntriesByType('paint')
    const firstPaint = paint.find(entry => entry.name === 'first-paint')
    return firstPaint ? firstPaint.startTime : 0
  }

  /**
   * 获取首次内容渲染时间
   */
  private getFirstContentfulPaint(): number {
    const paint = performance.getEntriesByType('paint')
    const fcp = paint.find(entry => entry.name === 'first-contentful-paint')
    return fcp ? fcp.startTime : 0
  }

  /**
   * 获取资源加载性能
   */
  getResourceMetrics(): Array<{
    name: string
    type: string
    duration: number
    size: number
  }> {
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
    
    return resources.map(resource => ({
      name: resource.name,
      type: resource.initiatorType,
      duration: resource.duration,
      size: resource.transferSize || 0
    }))
  }

  /**
   * 监控长任务
   */
  observeLongTasks(callback: (entries: PerformanceEntry[]) => void): void {
    if (!('PerformanceObserver' in window)) {
      console.warn('PerformanceObserver not supported')
      return
    }

    try {
      const observer = new PerformanceObserver((list) => {
        callback(list.getEntries())
      })
      observer.observe({ entryTypes: ['longtask'] })
    } catch (error) {
      console.warn('Failed to observe long tasks:', error)
    }
  }

  /**
   * 生成性能报告
   */
  generateReport(): string {
    const metrics = this.getAllMetrics()
    const pageLoad = this.getPageLoadMetrics()
    const resources = this.getResourceMetrics()

    const report = {
      timestamp: new Date().toISOString(),
      pageLoad,
      customMetrics: metrics,
      resources: {
        total: resources.length,
        totalSize: resources.reduce((sum, r) => sum + r.size, 0),
        totalDuration: resources.reduce((sum, r) => sum + r.duration, 0)
      }
    }

    return JSON.stringify(report, null, 2)
  }
}

// 导出单例
export const performanceMonitor = new PerformanceMonitor()

// 开发环境下自动启用
if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
  performanceMonitor.enable()
}
