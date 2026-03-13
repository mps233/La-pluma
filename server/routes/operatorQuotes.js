import express from 'express'
import OperatorQuotes from '../services/operatorQuotesService.js'

const router = express.Router()

/**
 * 获取今日干员台词
 */
router.get('/daily', (req, res) => {
  const quote = OperatorQuotes.getDailyQuote()
  res.json(quote)
})

/**
 * 获取所有干员台词
 */
router.get('/all', (req, res) => {
  const quotes = OperatorQuotes.getAllQuotes()
  res.json(quotes)
})

/**
 * 随机获取一条台词
 */
router.get('/random', (req, res) => {
  const quote = OperatorQuotes.getRandomQuote()
  res.json(quote)
})

/**
 * 根据干员名获取台词
 */
router.get('/operator/:name', (req, res) => {
  const { name } = req.params
  const quote = OperatorQuotes.getQuoteByOperator(name)
  if (quote) {
    res.json(quote)
  } else {
    res.status(404).json({ error: '未找到该干员的台词' })
  }
})

/**
 * 添加新台词
 */
router.post('/', (req, res) => {
  const { operator, quote } = req.body
  if (!operator || !quote) {
    return res.status(400).json({ error: '缺少干员名或台词' })
  }
  const quotes = OperatorQuotes.addQuote({ operator, quote })
  res.json(quotes)
})

/**
 * 更新台词
 */
router.put('/operator/:name', (req, res) => {
  const { name } = req.params
  const { quote } = req.body
  if (!quote) {
    return res.status(400).json({ error: '缺少台词内容' })
  }
  const updated = OperatorQuotes.updateQuote(name, quote)
  if (updated) {
    res.json(updated)
  } else {
    res.status(404).json({ error: '未找到该干员的台词' })
  }
})

/**
 * 删除台词
 */
router.delete('/operator/:name', (req, res) => {
  const { name } = req.params
  const quotes = OperatorQuotes.deleteQuote(name)
  res.json(quotes)
})

export default router
