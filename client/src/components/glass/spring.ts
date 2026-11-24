// Spring helpers the swipe-mode track used to import from the retired
// glass library. Same semantics (createSpring / springFrom / Spring
// / tune / impulse), so the track's feel is unchanged; the physics lives here
// now that the old library is gone.

export interface SpringConfig {
  stiffness: number
  damping: number
}

export interface Spring {
  readonly value: number
  readonly velocity: number
  readonly target: number
  set: (target: number, instant?: boolean) => void
  tune: (next: SpringConfig) => void
  impulse: (velocity: number) => void
  stop: () => void
}

const active = new Set<InternalSpring>()
let frame = 0
let last = 0

type InternalSpring = {
  value: number
  target: number
  velocity: number
  k: number
  c: number
  onUpdate: (value: number, velocity: number) => void
}

function step(s: InternalSpring, dt: number) {
  const x = s.value - s.target
  const v = s.velocity
  const half = s.c / 2
  const disc = half * half - s.k
  if (Math.abs(disc) < 1e-6) {
    const decay = Math.exp(-half * dt)
    const b = v + half * x
    s.value = s.target + decay * (x + b * dt)
    s.velocity = decay * (v - half * b * dt)
  } else if (disc > 0) {
    const root = Math.sqrt(disc)
    const r1 = -half + root
    const r2 = -half - root
    const a = (v - r2 * x) / (r1 - r2)
    const b = x - a
    const e1 = Math.exp(r1 * dt)
    const e2 = Math.exp(r2 * dt)
    s.value = s.target + a * e1 + b * e2
    s.velocity = a * r1 * e1 + b * r2 * e2
  } else {
    const w = Math.sqrt(-disc)
    const decay = Math.exp(-half * dt)
    const cos = Math.cos(w * dt)
    const sin = Math.sin(w * dt)
    s.value = s.target + decay * (x * cos + ((v + half * x) / w) * sin)
    s.velocity = decay * (v * cos - ((half * v + s.k * x) / w) * sin)
  }
}

function loop(time: number) {
  frame = 0
  const dt = Math.min(0.064, Math.max(0, (time - last) / 1000))
  last = time
  for (const s of [...active]) {
    step(s, dt)
    if (Math.abs(s.value - s.target) < 1e-4 && Math.abs(s.velocity) < 1e-3) {
      s.value = s.target
      s.velocity = 0
      active.delete(s)
    }
    s.onUpdate(s.value, s.velocity)
  }
  if (active.size && !frame) frame = requestAnimationFrame(loop)
}

function wake() {
  if (frame) return
  last = performance.now()
  frame = requestAnimationFrame(loop)
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function createSpring(
  initial: number,
  config: SpringConfig,
  onUpdate: (value: number, velocity: number) => void,
): Spring {
  const s: InternalSpring = {
    value: initial,
    target: initial,
    velocity: 0,
    k: config.stiffness,
    c: config.damping,
    onUpdate,
  }
  return {
    get value() {
      return s.value
    },
    get velocity() {
      return s.velocity
    },
    get target() {
      return s.target
    },
    set(target, instant = false) {
      s.target = target
      if (instant || prefersReducedMotion() || (typeof document !== 'undefined' && document.hidden)) {
        s.value = target
        s.velocity = 0
        active.delete(s)
        onUpdate(s.value, 0)
        return
      }
      active.add(s)
      wake()
    },
    tune(next) {
      s.k = next.stiffness
      s.c = next.damping
    },
    impulse(velocity) {
      s.velocity += velocity
      active.add(s)
      wake()
    },
    stop() {
      active.delete(s)
    },
  }
}

export function springFrom(response: number, dampingFraction: number): SpringConfig {
  const w = 2 * Math.PI / response
  return { stiffness: w * w, damping: 2 * dampingFraction * w }
}
