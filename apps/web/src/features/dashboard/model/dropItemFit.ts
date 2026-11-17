export interface FittedDropItems {
  readonly visible: readonly string[]
  readonly truncated: boolean
}

export function fitDropItems(
  items: readonly string[],
  availableWidth: number,
  measure: (text: string) => number,
): FittedDropItems {
  if (items.length === 0) return { visible: [], truncated: false }

  const separatorWidth = measure('、')
  const suffixWidth = measure('、…')
  const widths = items.map(measure)
  const totalWidth = widths.reduce(
    (sum, width, index) => sum + width + (index === 0 ? 0 : separatorWidth),
    0,
  )

  if (totalWidth <= availableWidth) return { visible: items, truncated: false }

  let usedWidth = 0
  let visibleCount = 0
  for (let index = 0; index < widths.length; index += 1) {
    const nextWidth = usedWidth + widths[index]! + (index === 0 ? 0 : separatorWidth)
    if (nextWidth + suffixWidth > availableWidth) break
    usedWidth = nextWidth
    visibleCount += 1
  }

  return { visible: items.slice(0, visibleCount), truncated: true }
}
