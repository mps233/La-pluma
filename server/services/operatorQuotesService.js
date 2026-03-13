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

// 默认台词（当数据文件不存在时使用）
const DEFAULT_QUOTES = [
  { operator: '博士', quote: '准备就绪' }
]

const OperatorQuotes = {
  /**
   * 读取台词数据
   */
  loadQuotes() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const data = fs.readFileSync(DATA_FILE, 'utf-8')
        return JSON.parse(data)
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
    return quotes[randomIndex]
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
