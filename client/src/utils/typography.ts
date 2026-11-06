/**
 * Typography helpers that cannot be expressed in CSS.
 */

export const NBSP = '\u00A0'

/**
 * Turns the existing space between a number and a Chinese unit (or %, °) into
 * a non-breaking space, so the pair never splits across two lines. It never
 * inserts a new space: text that was written without one is left to
 * `text-autospace` and the font.
 */
export function keepNumberWithUnit(text: string): string {
  return text.replace(
    /(\d)[ \u00A0]+(?=[\p{Script=Han}%°]|(?:KB|MB|GB|TB|FPS|M)\b)/gu,
    `$1${NBSP}`,
  )
}
