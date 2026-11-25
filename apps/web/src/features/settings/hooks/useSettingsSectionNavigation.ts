import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  isConfigSectionId,
  subscribeConfigSection,
  writeConfigSection,
} from '../model/configSection'
import {
  SETTINGS_SECTION_IDS,
  isSettingsSectionId,
  type SettingsSectionId,
} from '../model/settingsSections'

const SCROLL_HOST_SELECTOR = '[data-region="scroll"]'
const SECTION_SELECTOR = '[data-settings-section]'
const ACTIVE_SECTION_OFFSET = 24
const SCROLL_LOCK_MS = 700

export interface SettingsSectionNavigation {
  readonly activeSection: SettingsSectionId
  readonly selectSection: (section: SettingsSectionId) => void
}

const findScrollHost = (element: HTMLElement | null): HTMLElement | null => {
  const host = element?.closest(SCROLL_HOST_SELECTOR)
  return host instanceof HTMLElement ? host : null
}

const findSection = (container: HTMLElement, section: SettingsSectionId): HTMLElement | null => (
  container.querySelector<HTMLElement>(`[data-settings-section="${section}"]`)
)

export function useSettingsSectionNavigation(
  containerRef: RefObject<HTMLElement | null>,
): SettingsSectionNavigation {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(SETTINGS_SECTION_IDS[0])
  const activeRef = useRef(activeSection)
  const frameRef = useRef<number | null>(null)
  const lockRef = useRef<SettingsSectionId | null>(null)
  const lockTimerRef = useRef<number | null>(null)

  const setActive = useCallback((section: SettingsSectionId) => {
    if (activeRef.current === section) return
    activeRef.current = section
    setActiveSection(section)
  }, [])

  const selectSection = useCallback((section: SettingsSectionId) => {
    const container = containerRef.current
    if (!container) return
    const target = findSection(container, section)
    if (!target) return

    // 平滑滚动会经过中间区块；短暂锁定点击目标，避免高亮被中途的滚动事件改写。
    lockRef.current = section
    if (lockTimerRef.current !== null) window.clearTimeout(lockTimerRef.current)
    lockTimerRef.current = window.setTimeout(() => {
      lockRef.current = null
      lockTimerRef.current = null
    }, SCROLL_LOCK_MS)

    setActive(section)
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    target.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'start',
    })
  }, [containerRef, setActive])

  useEffect(() => {
    if (!isConfigSectionId(activeSection)) return
    writeConfigSection(activeSection)
  }, [activeSection])

  useEffect(() => {
    const container = containerRef.current
    const host = findScrollHost(container)
    if (!container || !host) return

    let resizeObserver: ResizeObserver | null = null

    const measure = () => {
      frameRef.current = null
      if (lockRef.current !== null) return
      const sections = Array.from(container.querySelectorAll<HTMLElement>(SECTION_SELECTOR))
      if (sections.length === 0) return

      const activationLine = host.getBoundingClientRect().top + ACTIVE_SECTION_OFFSET
      let next: SettingsSectionId = SETTINGS_SECTION_IDS[0]

      for (const section of sections) {
        if (section.getBoundingClientRect().top > activationLine) break
        const id = section.dataset.settingsSection
        if (isSettingsSectionId(id)) next = id
      }

      const canScroll = host.scrollHeight > host.clientHeight + 1
      const atBottom = canScroll && host.scrollTop + host.clientHeight >= host.scrollHeight - 1
      if (atBottom) {
        const last = sections[sections.length - 1]?.dataset.settingsSection
        if (isSettingsSectionId(last)) next = last
      }

      setActive(next)
    }

    const scheduleMeasure = () => {
      if (frameRef.current !== null) return
      frameRef.current = window.requestAnimationFrame(measure)
    }

    host.addEventListener('scroll', scheduleMeasure, { passive: true })
    window.addEventListener('resize', scheduleMeasure)
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(scheduleMeasure)
      resizeObserver.observe(container)
      resizeObserver.observe(host)
    }
    scheduleMeasure()

    return () => {
      host.removeEventListener('scroll', scheduleMeasure)
      window.removeEventListener('resize', scheduleMeasure)
      resizeObserver?.disconnect()
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [containerRef, setActive])

  useEffect(() => subscribeConfigSection(section => {
    selectSection(section)
  }), [selectSection])

  useEffect(() => () => {
    lockRef.current = null
    if (lockTimerRef.current !== null) {
      window.clearTimeout(lockTimerRef.current)
      lockTimerRef.current = null
    }
  }, [])

  return { activeSection, selectSection }
}
