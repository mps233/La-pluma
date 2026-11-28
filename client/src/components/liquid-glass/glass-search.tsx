'use client'

// GlassSearch — a search field that looks in several layers at once (apps, files, people: whatever
// you name) and opens into its results, one body of liquid glass throughout.
//
//   empty, waited on   [ Search          ] (A) (F) (P)   the layers bud off its end as droplets
//   typing             [ no|tes — Apps              ]    they melt back in; the best match completes the text
//   results            [ notes                      ]    the field grows down into the list, and the
//                      | Apps  Files  People        |    layers that answered line up as chips
//                      | Notes                      |
//
//   <GlassSearch
//     label="Search"
//     placeholder="Search"
//     layers={[
//       { value: 'apps', label: 'Apps', icon: <Grid />, items: [{ value: 'notes', label: 'Notes' }] },
//       { value: 'files', label: 'Files', icon: <Folder />, search: (query, signal) => findFiles(query, signal) },
//     ]}
//     onAction={(item, layer) => open(layer.value, item.value)}
//   />
//
// Typing looks in every layer and ranks what it finds; a layer with `search` answers when its
// promise settles, and its results join the list then. Press a droplet or a chip and the field
// looks in that layer alone (it shows in the field; Backspace in the empty field lets it go).
// Tab or → takes the completion, Enter runs the highlighted result, Escape empties the field.
// Once a chosen result's `onAction` has settled, the field empties.
// Left empty for `layersAfter` ms under focus or the pointer, the field lets its layers out: up to
// four bud off as droplets, as many as leave the field room to type in (the rest show as chips
// once there are results). Each droplet's icon rides with it and comes into focus as it lands.
// A placeholder that does not fit the field (it is at its narrowest with the droplets out) flows
// through it without end, as a marquee does.
// `arrive` plays the field's arrival when it mounts (out of a blur, a little large): for a field
// that is summoned, in a dialog or on a shortcut.
//
// UI SDK's Command owns the behaviour (the listbox, the highlight and arrow keys, Enter, the
// announcements, ARIA); the kit's engine owns the material. The field is a surface, droplets
// included: a press lights it where it lands and nothing is pulled. Needs @ui-sdk/core and
// @ui-sdk/react. Without WebGL2 it is a plain frosted field with round buttons at its end.
// COPY VERBATIM. MIT — https://github.com/bilalgursen/liquid-glass

import { Command, CommandEmpty, CommandInput, CommandItem, CommandList, createCommandController } from '@ui-sdk/react/command'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

import { stepSpring, type Spring } from './engine'
import { GlassLayer, type GlassMaterial, type GlassOptics } from './glass-layer'

export type GlassSearchItem = {
  /** Identifies the result inside its layer. */
  value: string
  /** The text shown, and what typing is matched against. */
  label: string
  /** A second, quieter line under the label. */
  description?: string
  /** Default: its layer's icon. */
  icon?: ReactNode
  /** More words typing matches. */
  keywords?: string[]
  disabled?: boolean
}

export type GlassSearchLayer = {
  value: string
  /** Names the layer: its droplet's and its chip's accessible name, and the chip's text. */
  label: string
  icon: ReactNode
  /** Results known up front. Typing ranks them. */
  items?: GlassSearchItem[]
  /**
   * Results that take a while: called with what was typed, and aborted when it changes. What it
   * resolves with joins the list when it arrives (it is not filtered again, only ranked).
   */
  search?: (query: string, signal: AbortSignal) => Promise<GlassSearchItem[]>
}

export type GlassSearchProps = {
  layers: GlassSearchLayer[]
  /** The field's accessible name. */
  label: string
  placeholder?: string
  /** Runs when a result is chosen: Enter on the highlighted one, or a press. Return a promise and the result stays pending until it settles; then the field empties. */
  onAction?: (item: GlassSearchItem, layer: GlassSearchLayer) => unknown
  onQueryChange?: (query: string) => void
  /** The layer the field looks in alone at first (its `value`). Default: every layer. */
  defaultLayer?: string | null
  onLayerChange?: (layer: string | null) => void
  /** How long the empty field waits, under focus or the pointer, before its layers bud off, in ms. Default 2000. */
  layersAfter?: number
  /** Play the field's arrival when it mounts: it comes in a little large, out of a blur. For a field that is summoned. Default `false`. */
  arrive?: boolean
  /** Shown when nothing matches. */
  empty?: ReactNode
  /** The most results listed at once. Default 50. */
  limit?: number
  /** Glass look. Default `clear`: frosts and bends what is behind. `tinted` takes the field's own `bg-*` class. */
  material?: GlassMaterial
  /** Clear glass: how much tint covers the backdrop (0–1, default 0.74). */
  tint?: number
  /** Clear glass: how much the backdrop is frosted, in px like CSS `blur()` (default 3.5). */
  blur?: number
  /** Fine-tuning of the glass (see GlassOptics). */
  optics?: GlassOptics
  /** Sizes the field: its width is yours (`w-96`, `w-full max-w-xl`). */
  className?: string
}

// The field is 48 px tall and so are its droplets. The engine draws four droplets at most.
const HEIGHT = 48
const DROPLETS = 4

/**
 * The field's own timing and measures, read on every render (the droplets' motion itself is the
 * engine's: BUD and SPRINGS.bud* in engine.ts). These values are the look: do not tune them casually.
 */
export const SEARCH = {
  /** The gap between droplets, and between the field and the first one (px). */
  gap: 8,
  /** The field keeps at least this much of itself (px) when its droplets are out: fewer come out of a narrow one. */
  bodyMin: 120,
  /**
   * The field growing into its results, and shutting over them: its height rides a spring with
   * some weight. More `mass` makes it slower to start and to stop (and, past what `damping`
   * holds, it swings past its place before it settles); more `stiffness` pulls it there harder;
   * more `damping` calms it. Shutting is the softer of the two, so an emptied field never snaps.
   */
  opening: { mass: 7, stiffness: 586, damping: 132 },
  closing: { mass: 4, stiffness: 307, damping: 132 },
  /** Typed in while its droplets are out, the field takes them back in first: it opens this much later (ms). */
  meltMs: 91,
  /** The text's own room follows the field's end: over this long as the droplets come out (ms), and this long as they go back in. */
  rowMs: 500,
  rowBackMs: 248,
  /**
   * A droplet's icon rides with its droplet and comes in as it lands: it begins to show once the
   * droplet is `iconFrom` of the way out (0–1) and is all there at `iconTo`. On the way it fades
   * up, grows from its own centre (from `iconScale` × its size) and clears out of `iconBlur` px
   * of blur. Each droplet has its own way out, so the icons come in order.
   */
  iconFrom: 0.7,
  iconTo: 0.99,
  iconScale: 0.4,
  iconBlur: 7,
  /** A placeholder too long for the field flows through it at this speed (px a second), its two copies this far apart (px). */
  flowSpeed: 44,
  flowGap: 40,
  /** With `arrive`: the field comes in over this long (ms), from this much larger (×). */
  arriveMs: 149,
  arriveScale: 1.1,
}

// A flowing placeholder fades out at both ends of its room instead of being cut.
const FLOW_FADE = 'linear-gradient(to right,transparent,#000 14px,#000 calc(100% - 14px),transparent)'
const FLOW_MASK: CSSProperties = { maskImage: FLOW_FADE, WebkitMaskImage: FLOW_FADE }

const ARRIVE_CSS = `
@keyframes glass-search-in{from{opacity:0;scale:var(--glass-search-from,1.1);filter:blur(4px)}}
[data-glass-arrive]{animation:glass-search-in var(--glass-search-ms,149ms) cubic-bezier(.2,.9,.3,1.12)}
@media (prefers-reduced-motion:reduce){[data-glass-arrive]{animation:none}}
`

// The field's own glass, under yours: Button's glass with a frosted face that takes only a
// quarter of the kit's light (inner shading, the reflection across the top, the caustic), a
// hairline of dark on its very edge over a faint light one, and vivid colour through it. The rim
// keeps its light, which leans towards the pointer as it moves around the field: that is why
// `light` stays as it is and only the face's shares are turned down. Its shadow is Card's: as
// soft, as deep and as faint, whatever the field's own height (Card casts its in CSS; here the
// glass casts it, so it follows the droplets too), and it begins right at the field's edge.
const OPTICS: GlassOptics = {
  borderColor: '#ffffff',
  borderAlpha: 0.27,
  borderWidth: 0,
  outlineColor: '#000000',
  outlineAlpha: 0.13,
  outlineWidth: 0.85,
  inner: 0.25,
  reflection: 0.25,
  caustic: 0.25,
  rim: 0.75,
  mirror: 0.25,
  saturation: 2,
  shadow: 1.74,
  shadowSoftness: 4.17,
  shadowOffset: 1.82,
  shadowFlush: true,
}

// The look before the glass draws (first paint, and the permanent look without WebGL2).
const fallback: Record<GlassMaterial, string> = {
  // Text follows the glass's own tone once it draws, so it reads on any backdrop.
  clear:
    'border border-black/10 bg-white/70 text-neutral-900 shadow-sm backdrop-blur-md dark:border-white/15 dark:bg-neutral-900/70 dark:text-white data-[glass-tone=dark]:text-white data-[glass-tone=light]:text-neutral-900',
  tinted: '',
}

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const
const Lens = () => (
  <svg {...svg} className="size-[18px] shrink-0 opacity-60">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
)

// Letters compare without case or accents (ç = c, İ = i), so "sik" finds "Şikâyet".
const fold = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .toLowerCase()

/** How well a result answers what was typed: 0 = not at all. The start of the label counts most, then the start of a word, then anywhere, then a keyword. */
function rank(item: GlassSearchItem, typed: string) {
  if (!typed) return 1
  const text = fold(item.label)
  if (text.startsWith(typed)) return 5
  if (text.split(/[\s\-_./]+/).some((word) => word.startsWith(typed))) return 4
  if (text.includes(typed)) return 3
  if (item.keywords?.some((word) => fold(word).includes(typed))) return 2
  return 0
}

type Row = { key: string; item: GlassSearchItem; layer: GlassSearchLayer; score: number }

export function GlassSearch({
  layers,
  label,
  placeholder,
  onAction,
  onQueryChange,
  defaultLayer = null,
  onLayerChange,
  layersAfter = 2000,
  arrive = false,
  empty = 'No results',
  limit = 50,
  material = 'clear',
  tint = 0.74,
  blur = 3.5,
  optics,
  className = '',
}: GlassSearchProps) {
  const { gap: GAP, bodyMin: BODY_MIN, meltMs: MELT_MS } = SEARCH
  // Yours over the field's own.
  const glass = useMemo<GlassOptics>(() => ({ ...OPTICS, ...optics, dark: { ...OPTICS.dark, ...optics?.dark } }), [optics])
  const [controller] = useState(createCommandController)
  const [query, setQuery] = useState('')
  const [layer, setLayer] = useState<string | null>(defaultLayer)
  const chosen = layers.find((l) => l.value === layer) ?? null
  // Looking: something is typed, or one layer is chosen (it lists what it has).
  const active = query !== '' || chosen !== null

  const pick = (next: string | null) => {
    setLayer(next)
    onLayerChange?.(next)
    controller.focus()
  }
  const type = (next: string) => {
    setQuery(next)
    onQueryChange?.(next)
  }

  // Layers that answer later. What one sent last stays listed until its next answer arrives.
  const [remote, setRemote] = useState<Record<string, GlassSearchItem[]>>({})
  const [waiting, setWaiting] = useState(0)
  const layersRef = useRef(layers)
  layersRef.current = layers
  useEffect(() => {
    if (!active) {
      setRemote({})
      return
    }
    const asked = layersRef.current.filter((l) => l.search && (!layer || l.value === layer))
    if (!asked.length) return
    const abort = new AbortController()
    let live = true
    setWaiting(asked.length)
    for (const l of asked) {
      Promise.resolve()
        .then(() => l.search!(query, abort.signal))
        .then(
          (items) => live && setRemote((before) => ({ ...before, [l.value]: items })),
          () => {},
        )
        .finally(() => live && setWaiting((n) => n - 1))
    }
    return () => {
      live = false
      abort.abort()
      setWaiting(0)
    }
  }, [query, layer, active])

  const { rows, answered } = useMemo<{ rows: Row[]; answered: Set<GlassSearchLayer> }>(() => {
    if (!active) return { rows: [], answered: new Set() }
    const typed = fold(query.trim())
    const seen = new Set<string>()
    const found: Row[] = []
    for (const l of layers) {
      if (chosen && l !== chosen) continue
      const own = (l.items ?? []).map((item) => ({ item, score: rank(item, typed) }))
      // A layer that searched for itself has matched already: its results are only ranked.
      const sent = (remote[l.value] ?? []).map((item) => ({ item, score: Math.max(1, rank(item, typed)) }))
      for (const { item, score } of [...own, ...sent]) {
        const key = `${l.value}:${item.value}`
        if (score <= 0 || seen.has(key)) continue
        seen.add(key)
        found.push({ key, item, layer: l, score })
      }
    }
    // The best first; equals keep the layers' order. Every layer that answered is named, also one whose results the limit left out.
    return { rows: found.sort((a, b) => b.score - a.score).slice(0, Math.max(1, limit)), answered: new Set(found.map((row) => row.layer)) }
  }, [active, query, layers, chosen, remote, limit])

  // The layers that answered, as chips: a press narrows the search to one.
  const chips = useMemo(() => (chosen ? [] : layers.filter((l) => answered.has(l))), [chosen, layers, answered])
  const top = rows[0]
  // The best match completes what is typed, when it begins with it.
  const completion = top && query && query.length < 32 && top.item.label.length > query.length && fold(top.item.label.slice(0, query.length)) === fold(query) ? top.item.label.slice(query.length) : ''

  const loading = waiting > 0
  const open = active && (rows.length > 0 || !loading)
  // Closing, the results stay in the glass until it has shut over them: the edge cuts them, they do not fade.
  const [was, setWas] = useState(open)
  const [leaving, setLeaving] = useState(false)
  if (was !== open) {
    setWas(open)
    setLeaving(!open)
  }
  const last = useRef({ rows, chips, root: !chosen })
  if (open) last.current = { rows, chips, root: !chosen }
  const shown = open ? { rows, chips, root: !chosen } : last.current

  // The results' own height: the field grows by it. And the field's width: it decides how many droplets fit.
  const body = useRef<HTMLDivElement>(null)
  const [bodyHeight, setBodyHeight] = useState(0)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = body.current
    const host = el?.closest<HTMLElement>('[data-glass-host]')
    if (!el || !host) return
    const ro = new ResizeObserver(() => {
      setBodyHeight(el.offsetHeight)
      setWidth(host.offsetWidth)
    })
    ro.observe(el)
    ro.observe(host)
    return () => ro.disconnect()
  }, [])

  // The layers bud off once the empty field has been waited on, under focus or the pointer.
  const [focused, setFocused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [rested, setRested] = useState(false)
  // As many droplets as leave the field room to type in; fewer than two are none (the chips still name every layer).
  const fit = Math.min(DROPLETS, Math.floor((width - BODY_MIN) / (HEIGHT + GAP)))
  const droplets = layers.length > 1 && fit > 1 ? layers.slice(0, fit) : []
  const waitable = (focused || hovered) && !active && droplets.length > 0
  useEffect(() => {
    if (!waitable) {
      setRested(false)
      return
    }
    const id = setTimeout(() => setRested(true), Math.max(0, layersAfter))
    return () => clearTimeout(id)
  }, [waitable, layersAfter])
  const apart = waitable && rested
  const room = droplets.length * (HEIGHT + GAP)
  // How far an icon is into focus (0–1 once clamped), from how far out its droplet is.
  const focus = `(var(--glass-drop-out, 1) - ${SEARCH.iconFrom}) / ${Math.max(0.01, SEARCH.iconTo - SEARCH.iconFrom)}`
  // The droplets on their way back in: the body is still short of its end, so the field waits for it before it opens.
  const [wasApart, setWasApart] = useState(apart)
  const [melting, setMelting] = useState(false)
  if (wasApart !== apart) {
    setWasApart(apart)
    setMelting(!apart)
  }
  useEffect(() => {
    if (!melting) return
    const id = setTimeout(() => setMelting(false), MELT_MS)
    return () => clearTimeout(id)
  }, [melting, MELT_MS])

  // The field's height rides a spring (SEARCH.opening / SEARCH.closing): it grows into its
  // results once the droplets are back in, and shuts over them. Written straight to the host,
  // frame by frame; the glass follows the host's size. Once shut, the results it kept are let go.
  const host = useRef<HTMLDivElement>(null)
  const clip = useRef<HTMLDivElement>(null)
  const tall = useRef<Spring>({ x: HEIGHT, v: 0 })
  const goal = HEIGHT + (open && !melting ? bodyHeight : 0)
  useEffect(() => {
    const el = host.current
    const inside = clip.current
    if (!el || !inside) return
    const spring = tall.current
    const land = () => {
      spring.x = goal
      spring.v = 0
      el.style.height = inside.style.height = `${goal}px`
      el.dispatchEvent(new Event('glass-measure'))
      if (!open) setLeaving(false)
    }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return land()
    let raf = 0
    let last = 0
    const tick = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60
      last = now
      const { mass, stiffness, damping } = open ? SEARCH.opening : SEARCH.closing
      const m = Math.max(0.05, mass)
      const k = Math.max(1, stiffness)
      const moving = stepSpring(spring, goal, { omega: Math.sqrt(k / m), zeta: Math.max(0.05, damping) / (2 * Math.sqrt(k * m)) }, dt)
      // Asked for before the glass is told: on the next frame this runs first, and the glass
      // then draws the height it has just been given.
      if (moving) raf = requestAnimationFrame(tick)
      // What cuts the results stays a frame behind the host, so they never show past the glass
      // on a frame the glass is late for.
      inside.style.height = el.style.height
      // A swing past the shut field is held just short of it: the field never thins to a line.
      el.style.height = `${Math.max(HEIGHT * 0.85, spring.x).toFixed(2)}px`
      el.dispatchEvent(new Event('glass-measure'))
      if (!moving) land()
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [goal, open])

  // The placeholder is the field's own text (not the input's), so one too long for the field can
  // flow through it: measured against the room the text has, which narrows as the droplets come out.
  const room2 = useRef<HTMLDivElement>(null)
  const sizer = useRef<HTMLSpanElement>(null)
  const [flow, setFlow] = useState(0)
  useEffect(() => {
    const box = room2.current
    const text = sizer.current
    if (!box || !text) return
    const measure = () => setFlow(text.offsetWidth > box.clientWidth + 0.5 ? text.offsetWidth : 0)
    const ro = new ResizeObserver(measure)
    ro.observe(box)
    ro.observe(text)
    return () => ro.disconnect()
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget
    const atEnd = input.selectionStart === query.length && input.selectionEnd === query.length
    if (completion && top && ((e.key === 'Tab' && !e.shiftKey) || (e.key === 'ArrowRight' && atEnd))) {
      e.preventDefault()
      type(top.item.label)
    } else if (e.key === 'Backspace' && !query && chosen) {
      e.preventDefault()
      pick(null)
    } else if (e.key === 'Escape' && (query || chosen)) {
      e.preventDefault()
      if (query) type('')
      else pick(null)
    }
  }

  // A press on the field's own glass (not on a button or a result) goes to the text.
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.target instanceof Element && e.target.closest('button, input, [role="option"]')) return
    e.preventDefault()
    controller.focus()
  }

  const line = (row: Row, rootList: boolean) => (
    <>
      <span aria-hidden className="grid size-7 shrink-0 place-items-center [&_svg]:size-5">
        {row.item.icon ?? row.layer.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] leading-5 font-medium">{row.item.label}</span>
        {row.item.description && <span className="block truncate text-xs leading-4 opacity-60">{row.item.description}</span>}
      </span>
      {rootList && <span className="shrink-0 pr-1 text-xs opacity-50">{row.layer.label}</span>}
    </>
  )
  const rowClass =
    'flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl px-2.5 py-1.5 outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-current/10 data-[pending]:opacity-60'

  return (
    <Command
      controller={controller}
      query={query}
      onQueryChange={type}
      // The layers are searched and ranked here: UI SDK keeps every result it is given.
      filter={false}
      status={loading ? 'loading' : 'idle'}
      onAction={(value: string) => {
        const row = rows.find((r) => r.key === value)
        if (!row) return
        const result = onAction?.(row.item, row.layer)
        // The result is found: the field empties once its action has settled (a failed one keeps the text).
        Promise.resolve(result).then(
          () => type(''),
          () => {},
        )
        return result
      }}
      onFocus={() => setFocused(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setFocused(false)}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      data-glass-arrive={arrive ? '' : undefined}
      style={arrive ? ({ '--glass-search-from': SEARCH.arriveScale, '--glass-search-ms': `${SEARCH.arriveMs}ms` } as CSSProperties) : undefined}
      className={`relative h-12 w-80 max-w-full ${open || leaving ? 'z-20' : ''} ${className}`}
    >
      {arrive && (
        <style href="liquid-glass-search" precedence="default">
          {ARRIVE_CSS}
        </style>
      )}
      <div
        ref={host}
        data-glass-host=""
        data-state={open ? 'open' : 'closed'}
        onPointerDown={onPointerDown}
        className={`group/glass absolute inset-x-0 top-0 h-12 cursor-text rounded-[24px] text-[16px] ${fallback[material]}`}
      >
        {/* The glass layer must be the host's first child. It is shaded for the field's height, however far it has opened. */}
        <GlassLayer material={material} tint={tint} blur={blur} swell={false} droplet={apart ? 'apart' : 'merged'} restHeight={HEIGHT} optics={glass} />
        <div ref={clip} className="absolute inset-x-0 top-0 h-12 overflow-hidden rounded-[inherit]">
          <div className="flex h-12 items-center gap-2.5 pl-4 transition-[padding] ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none" style={{ paddingRight: apart ? room + 8 : 14, transitionDuration: `${apart ? SEARCH.rowMs : SEARCH.rowBackMs}ms` }}>
            <Lens />
            {chosen && (
              <button
                type="button"
                aria-label={chosen.label}
                aria-pressed="true"
                onClick={() => pick(null)}
                className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-current/10 pr-2.5 pl-2 text-[13px] font-medium outline-none select-none hover:bg-current/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3291FF] [&_svg]:size-3.5 [&_svg]:shrink-0"
              >
                {chosen.icon}
                {chosen.label}
              </button>
            )}
            <div ref={room2} className="relative h-full min-w-0 flex-1">
              <CommandInput
                aria-label={label}
                placeholder={placeholder}
                onKeyDown={onKeyDown}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="search"
                className="relative h-full w-full bg-transparent font-medium outline-none placeholder:text-transparent"
              />
              {/* The placeholder, drawn here: still while it fits, flowing without end (two copies, sliding by one) while it does not. */}
              {placeholder && (
                <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre text-current/50" style={flow && !query ? FLOW_MASK : undefined}>
                  <span ref={sizer} className="invisible absolute">
                    {placeholder}
                  </span>
                  {query ? null : flow ? (
                    <span data-glass-marquee="" className="flex w-max" style={{ '--glass-marquee-duration': `${((flow + SEARCH.flowGap) / Math.max(1, SEARCH.flowSpeed)).toFixed(2)}s` } as CSSProperties}>
                      {[0, 1].map((half) => (
                        <span key={half} style={{ paddingRight: SEARCH.flowGap }}>
                          {placeholder}
                        </span>
                      ))}
                    </span>
                  ) : (
                    placeholder
                  )}
                </span>
              )}
              {completion && (
                <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center overflow-hidden font-medium whitespace-pre">
                  <span className="invisible">{query}</span>
                  <span className="rounded-[5px] bg-current/15">{completion}</span>
                  <span className="truncate font-normal opacity-50"> — {top.layer.label}</span>
                </span>
              )}
            </div>
            {/* The best match's icon, at the field's end once the field has it back. */}
            {open && top && !melting && (
              <span key={top.key} aria-hidden className="grid size-6 shrink-0 place-items-center [&_svg]:size-5">
                {top.item.icon ?? top.layer.icon}
              </span>
            )}
          </div>
          <div ref={body}>
            {(open || leaving) && <div aria-hidden className="mx-4 h-px bg-current/10" />}
            {(open || leaving) && shown.chips.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto px-3 pt-2.5 [scrollbar-width:none]">
                {shown.chips.map((l) => (
                  <button
                    key={l.value}
                    type="button"
                    data-glass-pick=""
                    aria-pressed="false"
                    tabIndex={open ? 0 : -1}
                    onClick={() => pick(l.value)}
                    className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-current/10 pr-2.5 pl-2 text-[13px] font-medium whitespace-nowrap outline-none select-none hover:bg-current/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3291FF] [&_svg]:size-3.5 [&_svg]:shrink-0"
                  >
                    {l.icon}
                    {l.label}
                  </button>
                ))}
              </div>
            )}
            <CommandList className={`max-h-[min(20rem,60vh)] overflow-y-auto outline-none ${open && rows.length ? 'p-1.5' : ''}`}>
              {open &&
                rows.map((row) => (
                  <CommandItem key={row.key} value={row.key} label={row.item.label} disabled={row.item.disabled} data-glass-item="" className={rowClass}>
                    {line(row, shown.root)}
                  </CommandItem>
                ))}
            </CommandList>
            {/* Shut over: the same rows as a picture, out of the keyboard's and the reader's way. */}
            {leaving && shown.rows.length > 0 && (
              <div aria-hidden className="max-h-[min(20rem,60vh)] overflow-hidden p-1.5">
                {shown.rows.map((row, i) => (
                  <div key={row.key} data-highlighted={i === 0 ? '' : undefined} className={rowClass}>
                    {line(row, shown.root)}
                  </div>
                ))}
              </div>
            )}
            {open && !loading && rows.length === 0 && (
              <CommandEmpty className="px-4 py-6 text-center text-sm opacity-60">{empty}</CommandEmpty>
            )}
          </div>
        </div>
        {/* The layers, as droplets at the field's end. The glass draws them (they are the host's
            `data-glass-drop` children) and tells each button where its droplet is: the button
            rides with it, and its icon fades up, grows from its centre and clears as the droplet lands. */}
        {droplets.map((l, i) => (
          <button
            key={l.value}
            type="button"
            data-glass-drop=""
            aria-label={l.label}
            title={l.label}
            aria-pressed="false"
            aria-hidden={!apart || undefined}
            tabIndex={apart ? 0 : -1}
            onClick={() => pick(l.value)}
            style={{ right: (droplets.length - 1 - i) * (HEIGHT + GAP), translate: 'var(--glass-drop-x, 0px) 0', scale: 'var(--glass-drop-size, 1)' }}
            // Without the glass nothing tells the button where it is: it is simply shown or not.
            className={`absolute top-0 grid size-12 cursor-pointer place-items-center rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3291FF] [&_svg]:size-5 ${apart ? '' : 'pointer-events-none [[data-glass-host]:not([data-glass-ready])_&]:opacity-0'}`}
          >
            <span aria-hidden data-glass-fallback="" className="absolute inset-0 -z-10 rounded-full border border-black/10 bg-white/70 backdrop-blur-md dark:border-white/15 dark:bg-neutral-900/70" />
            <span aria-hidden className="grid place-items-center" style={{ opacity: `clamp(0, ${focus}, 1)`, scale: `calc(${SEARCH.iconScale} + ${1 - SEARCH.iconScale} * clamp(0, ${focus}, 1))`, filter: `blur(calc((1 - clamp(0, ${focus}, 1)) * ${SEARCH.iconBlur}px))` }}>
              {l.icon}
            </span>
          </button>
        ))}
      </div>
    </Command>
  )
}

export default GlassSearch
