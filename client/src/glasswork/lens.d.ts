export interface LiquidGlassOptions {
  rim?: number
  edge?: number
  power?: number
  dispersion?: number
  radius?: number | null
  corner?: number | null
  enabled?: boolean
  property?: string
}

export interface LiquidGlassHandle {
  supported: boolean
  bezel: number
  update(options?: LiquidGlassOptions): void
  refresh(): void
  destroy(): void
}

export declare const LENS_DEFAULTS: Required<LiquidGlassOptions>

export declare function isLensSupported(): boolean

export declare function liquidGlass(
  element: Element,
  options?: LiquidGlassOptions
): LiquidGlassHandle
