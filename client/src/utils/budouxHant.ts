import { Parser } from 'budoux/parser'
import { model as zhHantModel } from 'budoux/model-zh-hant'

let traditionalChineseParser: Parser | undefined

/**
 * Built on first use. This module is only loaded when the document language
 * resolves to Traditional Chinese, so zh-CN never pays for the extra model.
 */
export function getTraditionalChineseParser() {
  traditionalChineseParser ??= new Parser(zhHantModel)
  return traditionalChineseParser
}
