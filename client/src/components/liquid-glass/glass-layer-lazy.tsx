'use client'

import type { ComponentType } from 'react'

import type { GlassLayerProps } from './glass-layer'
import { useDeferredGlassComponent } from './use-deferred-glass'

let layerPromise: Promise<ComponentType<GlassLayerProps>> | null = null

function loadGlassLayer() {
  layerPromise ??= import('./glass-layer').then(module => module.GlassLayer)
  return layerPromise
}

export function GlassLayer(props: GlassLayerProps) {
  const Impl = useDeferredGlassComponent(loadGlassLayer)
  return Impl ? <Impl {...props} /> : null
}

export default GlassLayer
