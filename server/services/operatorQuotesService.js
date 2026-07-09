/**
 * 干员台词服务
 * 从 PRTS Wiki 获取干员语音记录
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 数据文件路径
const DATA_FILE = path.join(__dirname, '../data/operatorQuotes.json')

// 默认状态文案（当数据文件不存在、为空或损坏时使用）
// 这些是项目内置兜底文案，不作为官方语音记录。
const DEFAULT_QUOTES = [
  { operator: '博士', quote: '准备就绪' },
  { operator: '阿米娅', quote: '今天也请多指教' },
  { operator: '凯尔希', quote: '作战记录已归档' },
  { operator: '陈', quote: '任务简报已经确认' },
  { operator: '煌', quote: '队伍状态不错' },
  { operator: '能天使', quote: '补给检查完成' },
  { operator: '银灰', quote: '战术安排已就绪' },
  { operator: '艾雅法拉', quote: '数据采集稳定' },
  { operator: '塞雷娅', quote: '防护流程正常' },
  { operator: '星熊', quote: '防线已经架好' },
  { operator: '推进之王', quote: '行动前先确认队形' },
  { operator: '德克萨斯', quote: '通讯频道保持畅通' },
  { operator: '拉普兰德', quote: '这次行动会很有趣' },
  { operator: '令', quote: '今日也宜从容落子' },
  { operator: '棘刺', quote: '药剂和装备都已备齐' },
  { operator: '史尔特尔', quote: '别让目标等太久' },
  { operator: 'W', quote: '装置都在正确位置' },
  { operator: '澄闪', quote: '信号稳定，可以开始' }
]

function normalizeQuotes(quotes) {
  if (!Array.isArray(quotes)) return []

  return quotes
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      operator: String(item.operator || '').trim(),
      quote: String(item.quote || '').trim()
    }))
    .filter((item) => item.operator && item.quote)
}

const OperatorQuotes = {
  /**
   * 读取台词数据
   */
  loadQuotes() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const data = fs.readFileSync(DATA_FILE, 'utf-8')
        const quotes = normalizeQuotes(JSON.parse(data))
        if (quotes.length > 0) return quotes
      }
    } catch (error) {
      console.error('读取干员台词数据失败:', error.message)
    }
    return DEFAULT_QUOTES
  },

  /**
   * 保存台词数据
   */
  saveQuotes(quotes) {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(quotes, null, 2), 'utf-8')
      return true
    } catch (error) {
      console.error('保存干员台词数据失败:', error.message)
      return false
    }
  },

  /**
   * 获取所有干员台词
   */
  getAllQuotes() {
    return this.loadQuotes()
  },

  /**
   * 根据日期获取今日台词
   */
  getDailyQuote() {
    const quotes = this.loadQuotes()
    const today = new Date()
    const dayOfYear = Math.floor((today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24))
    return quotes[dayOfYear % quotes.length]
  },

  /**
   * 随机获取一条台词
   */
  getRandomQuote() {
    const quotes = this.loadQuotes()
    const randomIndex = Math.floor(Math.random() * quotes.length)
    return quotes[randomIndex] || DEFAULT_QUOTES[0]
  },

  /**
   * 根据干员名获取台词
   */
  getQuoteByOperator(operatorName) {
    const quotes = this.loadQuotes()
    return quotes.find(q => q.operator === operatorName)
  },

  /**
   * 添加新台词
   */
  addQuote(quote) {
    const quotes = this.loadQuotes()
    quotes.push(quote)
    this.saveQuotes(quotes)
    return quotes
  },

  /**
   * 更新台词
   */
  updateQuote(operatorName, newQuote) {
    const quotes = this.loadQuotes()
    const index = quotes.findIndex(q => q.operator === operatorName)
    if (index !== -1) {
      quotes[index].quote = newQuote
      this.saveQuotes(quotes)
      return quotes[index]
    }
    return null
  },

  /**
   * 删除台词
   */
  deleteQuote(operatorName) {
    const quotes = this.loadQuotes()
    const filtered = quotes.filter(q => q.operator !== operatorName)
    this.saveQuotes(filtered)
    return filtered
  }
}

export default OperatorQuotes
