'use client'

import type { ComponentType } from 'react'

import type { GlassLensProps } from './glass-lens'
import { useDeferredGlassComponent } from './use-deferred-glass'

let lensPromise: Promise<ComponentType<GlassLensProps>> | null = null

function loadGlassLens() {
  lensPromise ??= import('./glass-lens').then(module => module.GlassLens)
  return lensPromise
}

export function GlassLens(props: GlassLensProps) {
  const Impl = useDeferredGlassComponent(loadGlassLens)
  return Impl ? <Impl {...props} /> : null
}

export default GlassLens
