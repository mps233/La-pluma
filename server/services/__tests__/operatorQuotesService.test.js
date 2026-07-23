import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_QUOTES, normalizeQuotes } from '../operatorQuotesService.js'

test('built-in operator quotes always include a character avatar id', () => {
  assert.ok(DEFAULT_QUOTES.length > 0)
  assert.equal(DEFAULT_QUOTES.some(quote => quote.operator === '博士'), false)

  for (const quote of DEFAULT_QUOTES) {
    assert.match(quote.operatorId, /^char_/)
    assert.ok(quote.operator)
    assert.ok(quote.quote)
  }
})

test('legacy quotes gain known operator ids without discarding custom entries', () => {
  assert.deepEqual(normalizeQuotes([
    { operator: '银灰', quote: '战术安排已就绪' },
    { operator: '自定义干员', quote: '自定义台词' },
  ]), [
    {
      operatorId: 'char_172_svrash',
      operator: '银灰',
      quote: '战术安排已就绪',
    },
    {
      operatorId: '',
      operator: '自定义干员',
      quote: '自定义台词',
    },
  ])
})
