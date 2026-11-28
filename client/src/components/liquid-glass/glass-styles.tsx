'use client'

/** The CSS the glass relies on. Rendered once per page by <GlassStyles /> (React 19 dedupes it). */
export const GLASS_CSS = `
/* Layered, so a utility class on the host (absolute, fixed) still wins over relative. */
@layer components{:where([data-glass-host]){position:relative;isolation:isolate}}
/* Unlayered on purpose: once the glass draws, it must beat the host's own fill utilities. */
[data-glass-host][data-glass-ready]{background:transparent!important;border-color:transparent!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
@keyframes glass-marquee{to{transform:translateX(-50%)}}
[data-glass-marquee]{animation:glass-marquee var(--glass-marquee-duration,5s) linear infinite}
/* Swapped labels and icons rise from a soft blur; a check draws itself in. */
@keyframes glass-in{from{opacity:0;filter:blur(3px);transform:translateY(4px)}}
[data-glass-in]{animation:glass-in .38s cubic-bezier(.2,.8,.2,1) both}
@keyframes glass-draw{from{stroke-dashoffset:25}}
[data-glass-draw]{stroke-dasharray:25;animation:glass-draw .42s cubic-bezier(.65,0,.35,1) .12s both}
@keyframes glass-spin{to{transform:rotate(1turn)}}
[data-glass-spin]{animation:glass-spin .8s linear infinite}
[data-glass-ready] [data-glass-fallback]{visibility:hidden}
/* A hidden fallback stops moving too. Its marquee ran on unseen, on the main thread, and made the browser work out the page's layers again on every frame of anything else on the page. */
[data-glass-ready] [data-glass-fallback] [data-glass-marquee]{animation:none}
@media (prefers-reduced-motion:reduce){[data-glass-marquee],[data-glass-in],[data-glass-draw],[data-glass-spin]{animation:none}}
`

/** Injects GLASS_CSS once (React 19 hoists and dedupes `<style href precedence>`). */
export function GlassStyles() {
  return (
    <style href="liquid-glass" precedence="default">
      {GLASS_CSS}
    </style>
  )
}
