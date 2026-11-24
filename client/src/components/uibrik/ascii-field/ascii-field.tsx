"use client";

import { useEffect, useRef, useState } from "react";
import {
  ShaderSurface,
  type ShaderSurfaceProps,
} from "../_shader-background/ShaderSurface";
import { paletteOf, type Shade } from "../_shader-background/shades";

const SHADER = `
uniform sampler2D u_tex; // glyph atlas: one row of cells, white on black
uniform float u_glyphs;  // glyphs in the atlas
uniform float u_cell;    // row height, css px
uniform float u_scale;   // size of the shapes
uniform float u_density; // how much of the field carries glyphs
uniform float u_fade;    // fade toward the edges
uniform float u_glow;    // tint under the dense areas
uniform float u_twinkle; // odd cells that flare now and then
uniform float u_radius;  // reach of the pointer lens, css px
uniform float u_magnify; // how much the lens enlarges the field under it
uniform float u_wake;    // strength of the trail the pointer leaves
uniform float u_pattern; // 0 flow, 1 waves, 2 rings

float fbm(vec3 p) {
  float sum = 0.0;
  float amp = 0.55;
  for (int i = 0; i < 3; i++) {
    sum += amp * snoise(p);
    p = p * 2.03 + vec3(3.1, 7.7, 0.0);
    amp *= 0.45;
  }
  return sum;
}

// brightness of the field, roughly 0..1
float field(vec2 p, float t) {
  if (u_pattern < 0.5) {
    // noise bent by noise: soft banks that fold into each other as they drift
    vec2 q = vec2(snoise(vec3(p * 0.6, t)), snoise(vec3(p * 0.6 + 5.2, t)));
    return 0.5 + fbm(vec3(p * 0.9 + q * 0.8, t * 0.8)) * 0.95;
  }
  if (u_pattern < 1.5) {
    // two swells crossing, bent a little so they never look ruled
    float n = snoise(vec3(p * 0.45, t * 0.6));
    float w = sin(p.x * 1.9 + p.y * 0.8 + n * 1.8 - t * 3.0) * 0.55
            + sin(-p.x * 0.9 + p.y * 2.3 + n * 1.3 - t * 2.1) * 0.35;
    return 0.5 + w * 0.6;
  }
  // rings spreading from a slowly wandering centre
  vec2 c = vec2(sin(t * 0.7), cos(t * 0.53)) * vec2(0.6, 0.3);
  float d = length(p - c);
  float n = snoise(vec3(p * 0.7, t * 0.5));
  return 0.5 + 0.55 * sin(d * 5.5 - t * 4.0 + n * 1.2) * exp(-d * 0.25);
}

float glyph(float idx, vec2 local, float ch) {
#ifdef NO_ATLAS
  // no atlas on this device: a dot that grows with the glyph's weight
  float r = 0.42 * idx / max(u_glyphs - 1.0, 1.0);
  float d = length((local - 0.5) * vec2(0.6250, 1.0));
  return smoothstep(r, r - 0.08, d) * step(0.5, idx);
#else
  vec2 uv = vec2((idx + local.x) / u_glyphs, 1.0 - local.y);
  float lod = max(log2(96.0 / ch), 0.0);
  return textureLod(u_tex, uv, lod).r;
#endif
}

// how present the lens is at a point, 0..1; round while resting, a soft comet while moving
float lensAt(vec2 px) {
  float d = pointerDist(px, 0.5) / (u_radius * u_dpr);
  return exp(-d * d * 2.2) * u_pointerAmt;
}

// where the field is read for a point: pulled toward the pointer inside the lens, so the shapes
// under it swell as if seen through glass while the grid itself stays still
vec2 lensed(vec2 px) {
  return mix(px, u_pointer, lensAt(px) * u_magnify * 0.45);
}

// the pointer's recent path; a resting pointer keeps a single point, which isn't a trail
float wakeAt(vec2 px, float radius) {
  return u_trailCount > 1 ? trailField(px, radius) * u_wake : 0.0;
}

vec3 shade(vec2 frag) {
  float ch = max(4.0, u_cell * u_dpr);
  vec2 size = vec2(ch * 0.6250, ch);
  vec2 cell = floor(frag / size);
  vec2 local = fract(frag / size);
  vec2 centre = (cell + 0.5) * size;

  float aspect = u_res.x / u_res.y;
  float t = u_time * 0.06;
  vec2 uvc = centre / u_res;
  float raw = field((lensed(centre) / u_res - 0.5) * vec2(aspect, 1.0) * (2.4 / u_scale), t);

  // the edges ease off, so content laid on top and the page around both stay calm
  vec2 e = (uvc - 0.5) * 2.0;
  float mask = mix(1.0, 1.0 - smoothstep(0.35, 1.25, length(e * vec2(0.85, 1.0))), u_fade);

  float lo = 1.0 - u_density;
  float v = smoothstep(lo, lo + u_density * 0.85, raw) * mask;

  // the lens lifts what it covers; the pointer's recent path leaves a fading wake of type; clicks
  // send rings out. The lens only lifts a little, so the shapes stay readable under it.
  float lens = lensAt(centre);
  float wake = wakeAt(centre, u_radius * u_dpr * 0.4);
  float ring = min(ripples(centre), 1.0);
  // how fast the pointer moves, from how far its lazy tail lags behind: 0 resting .. 1 quick
  float pace = smoothstep(0.02, 0.5, length(u_trail - u_pointer) / (u_radius * u_dpr));
  v = clamp(v + lens * 0.22 + wake * 0.55 + ring * 0.55, 0.0, 1.0);

  float h = hash12(cell + 0.37);
  float flare = step(h, 0.05) * pow(0.5 + 0.5 * sin(u_time * 0.8 + h * 1256.0), 28.0) * u_twinkle * mask;
  v = max(v, flare);

  float n = u_glyphs - 1.0;
  float idx = clamp(floor(v * n + (h - 0.5) * 0.7 + 0.5), 0.0, n);
  // glyphs reshuffle only where something is moving: the wake, the rings, and the lens while it
  // travels; a resting lens settles back to the real glyphs
  float tick = floor(u_time * 14.0);
  float stir = max(max(wake * 0.85, ring), lens * pace);
  if (hash12(cell * 1.31 + tick * 7.17) < stir * 0.75) {
    idx = clamp(floor(hash12(cell + tick) * n) + 1.0, 1.0, n);
  }
  float cov = glyph(idx, local, ch);

  // glyphs take the darker half of the ramp on light pages and the lighter half on dark ones
  float tone = mix(0.16 + 0.42 * v, 0.34 + 0.56 * v, u_dark) + flare * 0.1 + (wake + ring) * mix(-0.04, 0.08, u_dark);
  vec3 ink = paletteRampLch(tone);
  float alpha = cov * (0.3 + 0.7 * v);

  // a soft wash of colour under the busy areas, drawn from the smooth field so it has no cells
  float soft = smoothstep(lo, 1.0, field((lensed(frag) / u_res - 0.5) * vec2(aspect, 1.0) * (2.4 / u_scale), t)) * mask;
  float halo = lensAt(frag) * 0.6 + wakeAt(frag, u_radius * u_dpr * 0.5) * 0.4;
  vec3 ground = mix(u_bg, paletteRampLch(mix(0.55, 0.45, u_dark)), (soft * soft + halo) * u_glow * mix(0.1, 0.2, u_dark));

  return oklabToLinear(mix(ground, ink, clamp(alpha, 0.0, 1.0)));
}
`;

const PLAIN_SHADER = "#define NO_ATLAS\n" + SHADER;

const DEFAULT_COLOR = "#3f6bff";

const SHADES: Shade[] = [
  [0.26, 0.6, 0.05],
  [0.42, 0.9, 0.025],
  [0.58, 1, 0],
  [0.74, 0.85, -0.03],
  [0.9, 0.5, -0.06],
];

const PATTERNS = { flow: 0, waves: 1, rings: 2 } as const;

export type AsciiFieldProps = Omit<
  ShaderSurfaceProps,
  "shader" | "plainShader" | "prepass" | "uniforms" | "colors"
> & {
  /** Colour of the glyphs; drawn in shades of it. */
  color?: string;
  /** Hex colours, 2 to 6, from the faintest glyphs to the densest. Overrides color. */
  colors?: string[];
  /** Glyphs from empty to dense; the first is usually a space. Up to 24. */
  characters?: string;
  /** Shape of the field. */
  pattern?: "flow" | "waves" | "rings";
  /** Height of a row of type. */
  cellSize?: number;
  /** Size of the shapes; larger is calmer. */
  scale?: number;
  /** How much of the field carries glyphs. */
  density?: number;
  /** How far the glyphs fade toward the edges. */
  fade?: number;
  /** Tint under the dense areas. */
  glow?: number;
  /** Odd cells that flare now and then. */
  twinkle?: number;
  /** How far the pointer lens reaches. */
  radius?: number;
  /** How much the lens enlarges the field under it. */
  magnify?: number;
  /** Strength of the fading trail the pointer leaves. */
  wake?: number;
};

export function AsciiField({
  color = DEFAULT_COLOR,
  colors,
  characters = " .:-=+*#%@",
  pattern = "flow",
  cellSize = 14,
  scale = 1,
  density = 0.7,
  fade = 0.6,
  glow = 0.6,
  twinkle = 0.5,
  radius = 100,
  magnify = 0.6,
  wake = 0.7,
  speed = 1,
  animate = true,
  interactive = true,
  seed = 0,
  background,
  ...rest
}: AsciiFieldProps) {
  const palette = paletteOf(color || DEFAULT_COLOR, colors, SHADES);
  const glyphList = Array.from(characters || " ").slice(0, 24);
  const glyphs = glyphList.length > 1 ? glyphList : [" ", ...glyphList];
  const glyphsRef = useRef(glyphs);

  useEffect(() => {
    glyphsRef.current = glyphs;
  });

  const [glyphAtlas] = useState(() => {
    const getGlyphs = () => glyphsRef.current;

    return (gl: WebGL2RenderingContext) => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const texture = gl.createTexture();
      if (!ctx || !texture) return null;
      let lastKey = "";

      return {
        render() {
          const chars = getGlyphs();
          if (chars.join("") !== lastKey) {
            lastKey = chars.join("");
            canvas.width = 60 * chars.length;
            canvas.height = 96;
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = "#fff";
            ctx.font = `500 ${Math.round(63.36)}px ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            chars.forEach((char, index) => ctx.fillText(char, 60 * (index + 0.5), 50.88));
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.generateMipmap(gl.TEXTURE_2D);
          }
          return texture;
        },
        dispose(gl: WebGL2RenderingContext) {
          gl.deleteTexture(texture);
        },
      };
    };
  });

  return (
    <ShaderSurface
      shader={SHADER}
      plainShader={PLAIN_SHADER}
      prepass={glyphAtlas}
      uniforms={{
        u_glyphs: glyphs.length,
        u_cell: cellSize,
        u_scale: scale,
        u_density: density,
        u_fade: fade,
        u_glow: glow,
        u_twinkle: twinkle,
        u_radius: radius,
        u_magnify: magnify,
        u_wake: wake,
        u_pattern: PATTERNS[pattern] ?? 0,
      }}
      colors={palette}
      speed={speed}
      animate={animate}
      interactive={interactive}
      grain={0}
      seed={seed}
      ripples
      follow={0.5}
      trailLife={1.1}
      background={background}
      maxDpr={2}
      fallback={(dark, backgroundColor) => {
        const accent = palette[dark ? palette.length - 2 : 1] ?? palette[0];
        return `radial-gradient(ellipse at 50% 45%, ${accent}1f, transparent 65%), ${backgroundColor}`;
      }}
      {...rest}
    />
  );
}

/** Preview wrapper: fills the viewport and switches between a single colour and a palette. */
export default function AsciiFieldDemo({
  multicolor,
  color,
  colors,
  ...props
}: AsciiFieldProps & { multicolor?: boolean }) {
  return (
    <AsciiField
      {...props}
      {...(multicolor ? { colors } : { color })}
      className="h-screen w-full"
    />
  );
}
