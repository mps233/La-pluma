export type CjkScript = 'hans' | 'hant'

const HANT_RE = /hant|(^|-)(tw|hk|mo)(-|$)/i

/**
 * The document language is the source of truth. An empty value is the app's
 * Simplified Chinese default; navigator.language is deliberately not read.
 */
export function resolveCjkScript(lang?: string): CjkScript {
  const value = (
    lang
    ?? (typeof document === 'undefined' ? '' : document.documentElement.lang)
    ?? ''
  ).trim()

  return HANT_RE.test(value) ? 'hant' : 'hans'
}
