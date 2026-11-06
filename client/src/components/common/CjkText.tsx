import { Fragment, useEffect, useState, type ReactNode } from 'react'
import type { Parser } from 'budoux/parser'
import { resolveCjkScript, type CjkScript } from '@/utils/cjkScript'

const HAN_RE = /\p{Script=Han}/u
const SEGMENT_CACHE_LIMIT = 512
const segmentCache = new Map<string, string[]>()

const CLOSING_PUNCTUATION = /^[、。，．！？；：）］｝〉》」』】〕”’〙〛…—～]/u
const OPENING_PUNCTUATION = /[（［｛〈《「『【〔“‘〘〚]$/u

let simplifiedChineseParser: Parser | undefined
let traditionalChineseParser: Parser | undefined
let simplifiedChineseParserPromise: Promise<Parser> | null = null

function loadSimplifiedChineseParser(): Promise<Parser> {
  simplifiedChineseParserPromise ??= Promise.all([
    import('budoux/parser'),
    import('budoux/model-zh-hans'),
  ]).then(([{ Parser }, { model }]) => new Parser(model))
  return simplifiedChineseParserPromise
}

function getParser(script: CjkScript) {
  if (script === 'hant') return traditionalChineseParser ?? null
  return simplifiedChineseParser ?? null
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
  const [, setParserReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    if (script === 'hant') {
      if (traditionalChineseParser) return undefined
      void import('@/utils/budouxHant')
        .then(({ getTraditionalChineseParser }) => {
          if (cancelled) return
          traditionalChineseParser = getTraditionalChineseParser()
          setParserReady(ready => !ready)
        })
        .catch(() => undefined)
      return () => {
        cancelled = true
      }
    }

    if (simplifiedChineseParser) return undefined
    void loadSimplifiedChineseParser()
      .then(parser => {
        if (cancelled) return
        simplifiedChineseParser = parser
        setParserReady(ready => !ready)
      })
      .catch(() => {
        simplifiedChineseParserPromise = null
      })

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
