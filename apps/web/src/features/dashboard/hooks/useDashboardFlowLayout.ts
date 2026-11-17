import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { BREAKPOINTS } from '@/shared/lib/breakpoints'

const PREVIEW_ASPECT_RATIO = 16 / 9
const GRID_MIN_LEFT_WIDTH = 360
const GRID_MIN_PREVIEW_WIDTH = 520

export function useDashboardFlowLayout(enabled = true) {
  const flowGridRef = useRef<HTMLDivElement | null>(null)
  const flowCardRef = useRef<HTMLDivElement | null>(null)
  const flowPreviewRef = useRef<HTMLDivElement | null>(null)
  const [flowGridColumns, setFlowGridColumns] = useState<string | null>(null)

  useLayoutEffect(() => {
    if (!enabled) return

    const grid = flowGridRef.current
    const flowCard = flowCardRef.current
    const previewShell = flowPreviewRef.current

    if (!grid || !flowCard || !previewShell) return

    const mediaQuery = window.matchMedia(`(width >= ${BREAKPOINTS.xl}px)`)
    let frameId = 0

    const updateColumns = (columns: string | null) => {
      setFlowGridColumns(current => current === columns ? current : columns)
    }

    const syncColumns = () => {
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        if (!mediaQuery.matches) {
          updateColumns(null)
          return
        }

        const previewCard = previewShell.querySelector<HTMLElement>('[data-dashboard-preview-card]')
        const previewFrame = previewShell.querySelector<HTMLElement>('[data-dashboard-preview-frame]')

        if (!previewCard || !previewFrame) {
          updateColumns(null)
          return
        }

        const gridRect = grid.getBoundingClientRect()
        const flowRect = flowCard.getBoundingClientRect()
        const previewCardRect = previewCard.getBoundingClientRect()
        const previewFrameRect = previewFrame.getBoundingClientRect()
        const stages = flowCard.querySelector<HTMLElement>('[data-dashboard-flow-stages]')
        const stagesContent = stages?.lastElementChild
        let stagesExtraHeight = 0

        if (stages && stagesContent) {
          const stagesStyle = window.getComputedStyle(stages)
          const bottomInset = (Number.parseFloat(stagesStyle.paddingBottom) || 0)
            + (Number.parseFloat(stagesStyle.borderBottomWidth) || 0)
          stagesExtraHeight = Math.max(
            0,
            stages.getBoundingClientRect().bottom - stagesContent.getBoundingClientRect().bottom - bottomInset,
          )
        }

        if (
          gridRect.width <= 0 ||
          flowRect.height <= 0 ||
          previewCardRect.width <= 0 ||
          previewFrameRect.width <= 0
        ) {
          updateColumns(null)
          return
        }

        const gridStyle = window.getComputedStyle(grid)
        const columnGap = Number.parseFloat(gridStyle.columnGap) || 20
        const previewChromeHeight = Math.max(0, previewCardRect.height - previewFrameRect.height)
        const previewChromeWidth = Math.max(0, previewCardRect.width - previewFrameRect.width)
        // Ignore the stage section's empty stretch space.
        // Column sizing must use content height so equal-height cards cannot resize themselves.
        const stableFlowHeight = Math.max(0, flowRect.height - stagesExtraHeight)
        const targetFrameHeight = Math.max(180, stableFlowHeight - previewChromeHeight)
        const desiredPreviewWidth = targetFrameHeight * PREVIEW_ASPECT_RATIO + previewChromeWidth
        const minLeftWidth = Math.min(420, Math.max(GRID_MIN_LEFT_WIDTH, gridRect.width * 0.32))
        const minPreviewWidth = Math.min(560, Math.max(GRID_MIN_PREVIEW_WIDTH, gridRect.width * 0.42))
        const maxPreviewWidth = Math.max(minPreviewWidth, gridRect.width - columnGap - minLeftWidth)
        const nextPreviewWidth = Math.round(Math.min(Math.max(desiredPreviewWidth, minPreviewWidth), maxPreviewWidth))
        const nextLeftWidth = Math.max(0, Math.round(gridRect.width - columnGap - nextPreviewWidth))

        updateColumns(`minmax(0, ${nextLeftWidth}px) minmax(0, ${nextPreviewWidth}px)`)
      })
    }

    const resizeObserver = new ResizeObserver(syncColumns)
    resizeObserver.observe(grid)
    resizeObserver.observe(flowCard)
    resizeObserver.observe(previewShell)

    const previewCard = previewShell.querySelector<HTMLElement>('[data-dashboard-preview-card]')
    const previewFrame = previewShell.querySelector<HTMLElement>('[data-dashboard-preview-frame]')

    if (previewCard) resizeObserver.observe(previewCard)
    if (previewFrame) resizeObserver.observe(previewFrame)

    mediaQuery.addEventListener('change', syncColumns)
    window.addEventListener('resize', syncColumns)
    syncColumns()

    return () => {
      window.cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      mediaQuery.removeEventListener('change', syncColumns)
      window.removeEventListener('resize', syncColumns)
    }
  }, [enabled])

  const flowGridStyle = flowGridColumns === null
    ? undefined
    : ({ '--dashboard-flow-columns': flowGridColumns } as CSSProperties)

  return {
    flowGridRef,
    flowCardRef,
    flowPreviewRef,
    flowGridStyle,
  }
}
