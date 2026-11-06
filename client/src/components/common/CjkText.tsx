import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { Parser } from 'budoux/parser'
import { model as zhHansModel } from 'budoux/model-zh-hans'
import { resolveCjkScript, type CjkScript } from '@/utils/cjkScript'

const HAN_RE = /\p{Script=Han}/u
const SEGMENT_CACHE_LIMIT = 512
const segmentCache = new Map<string, string[]>()

const CLOSING_PUNCTUATION = /^[、。，．！？；：）］｝〉》」』】〕”’〙〛…—～]/u
const OPENING_PUNCTUATION = /[（［｛〈《「『【〔“‘〘〚]$/u

let simplifiedChineseParser: Parser | undefined
let traditionalChineseParser: Parser | undefined

function getParser(script: CjkScript) {
  if (script === 'hant') return traditionalChineseParser ?? null
  simplifiedChineseParser ??= new Parser(zhHansModel)
  return simplifiedChineseParser
}

function segmentText(text: string, script: CjkScript) {
  if (!text || !HAN_RE.test(text)) return [text]

  const parser = getParser(script)
  if (!parser) return [text]

  const cacheKey = `${script}\u0000${text}`
  const cached = segmentCache.get(cacheKey)
  if (cached) return cached

  const segments = parser.parse(text)
  if (segmentCache.size >= SEGMENT_CACHE_LIMIT) segmentCache.clear()
  segmentCache.set(cacheKey, segments)
  return segments
}

/**
 * A soft break is not useful where the text already has a space, and it must
 * not violate the Chinese line-start / line-end punctuation rules.
 */
function canBreakBetween(previous: string, next: string) {
  if (!previous || !next) return false
  if (/\s$/.test(previous) || /^\s/.test(next)) return false
  if (CLOSING_PUNCTUATION.test(next)) return false
  if (OPENING_PUNCTUATION.test(previous)) return false
  return true
}

export interface CjkTextProps {
  children: ReactNode
  lang?: string
  className?: string
}

/**
 * Inserts <wbr> between BudouX word chunks for Chinese headings. Short labels
 * that BudouX treats as one word are returned untouched, so keep-all is never
 * applied without break points. <wbr> contributes no text, so textContent,
 * ids and aria-labelledby targets stay exactly as before.
 */
export default function CjkText({ children, lang, className = '' }: CjkTextProps) {
  const script = resolveCjkScript(lang)
  const [, setTraditionalReady] = useState(false)

  useEffect(() => {
    if (script !== 'hant' || traditionalChineseParser) return undefined

    let cancelled = false
    void import('@/utils/budouxHant')
      .then(({ getTraditionalChineseParser }) => {
        if (cancelled) return
        traditionalChineseParser = getTraditionalChineseParser()
        setTraditionalReady(true)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [script])

  const text = typeof children === 'string' ? children : null
  const segments = text === null ? null : segmentText(text, script)

  if (segments === null || segments.length < 2) return <>{children}</>

  return (
    <span className={`app-cjk-breaks${className ? ` ${className}` : ''}`}>
      {segments.map((segment, index) => {
        const previous = index > 0 ? segments[index - 1] : undefined
        return (
          <Fragment key={index}>
            {previous !== undefined && canBreakBetween(previous, segment) ? <wbr /> : null}
            {segment}
          </Fragment>
        )
      })}
    </span>
  )
}
