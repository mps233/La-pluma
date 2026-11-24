import { useMemo, useSyncExternalStore, type CSSProperties } from 'react'
import { AsciiField, type AsciiFieldProps } from '@/components/uibrik/ascii-field/ascii-field'
import './AsciiBackdrop.css'

const LIGHT_ACCENT = '#007aff'
const DARK_ACCENT = '#64b5ff'
const LIGHT_BACKGROUND = '#f2f2f7'

function subscribeTheme(callback: () => void) {
  const observer = new MutationObserver(callback)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

const getIsDark = () => document.documentElement.classList.contains('dark')

interface AsciiFieldBackdropProps extends Omit<AsciiFieldProps, 'color' | 'colors' | 'background' | 'backgroundDark'> {
  /** Ink colour for a single-tone field. Defaults to the project accent. */
  color?: string
  /** Two to six hex colours, faintest glyphs first. Overrides color. */
  colors?: readonly string[]
  /** Base colour behind the glyphs. Defaults to the page background. */
  background?: string
  className?: string
  /** Layer opacity. Keeps the field behind content instead of competing with it. */
  intensity?: number
}

/**
 * Ambient ASCII field powered by the extracted uibrik WebGL2 renderer.
 *
 * Kept as a dedicated wrapper so the app keeps its own opacity, stacking and
 * theme rules around the third-party component.
 */
export default function AsciiFieldBackdrop({
  color,
  colors,
  background,
  className,
  intensity,
  ...props
}: AsciiFieldBackdropProps) {
  const dark = useSyncExternalStore(subscribeTheme, getIsDark, () => false)

  const theme = useMemo(() => {
    if (typeof window === 'undefined') {
      return { accent: LIGHT_ACCENT, background: LIGHT_BACKGROUND }
    }
    const styles = window.getComputedStyle(document.documentElement)
    const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback
    return {
      accent: read(dark ? '--app-accent-strong' : '--app-accent', dark ? DARK_ACCENT : LIGHT_ACCENT),
      background: read('--app-bg', LIGHT_BACKGROUND),
    }
  }, [dark])

  const style: CSSProperties = {}
  if (background) style.backgroundColor = background
  if (typeof intensity === 'number') {
    ;(style as CSSProperties & Record<string, string | number>)['--ascii-field-opacity'] = intensity
  }

  const fieldProps: AsciiFieldProps = {
    density: 0.64,
    fade: 0.56,
    glow: 0.5,
    twinkle: 0.42,
    ...props,
    color: color ?? theme.accent,
    ...(colors ? { colors: [...colors] } : {}),
    background: background ?? theme.background,
    className: 'h-full w-full',
  }

  return (
    <div
      aria-hidden="true"
      className={className ? 'ascii-field ' + className : 'ascii-field'}
      style={style}
    >
      <AsciiField {...fieldProps} />
    </div>
  )
}
