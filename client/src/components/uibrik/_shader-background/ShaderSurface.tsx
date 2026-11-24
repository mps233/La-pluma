// ShaderSurface — shared WebGL2 canvas surface used by the uibrik background
// components. Reconstructed from the shipped Ascii Field bundle.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*                                   Shaders                                  */
/* -------------------------------------------------------------------------- */

export const VERT = `#version 300 es
// one triangle that covers the whole canvas, no buffers needed
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const NOISE = `
// 3D simplex noise by Ian McEwan, Ashima Arts, and Stefan Gustavson.
// Copyright (C) 2011 Ashima Arts. Copyright (C) 2011-2016 Stefan Gustavson.
// Distributed under the MIT License: https://github.com/stegu/webgl-noise
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

export const HEADER = `#version 300 es
precision highp float;

uniform vec2 u_res;        // canvas size, device px
uniform float u_dpr;       // device px per css px
uniform float u_time;      // animation clock, seconds (already scaled by speed)
uniform float u_age;       // seconds of motion played since the surface first showed; large when still
uniform vec2 u_pointer;    // pointer position, device px, y up
uniform float u_pointerAmt; // 0..1, eased: how present the pointer is
uniform vec2 u_trail;      // a lazier point following u_pointer, device px, y up
uniform vec3 u_colors[6];  // palette, OKLab
uniform int u_count;       // palette size
uniform vec3 u_bg;         // page background, OKLab
uniform float u_dark;      // 0 light .. 1 dark, eased during a theme change
uniform float u_grain;     // film grain strength
uniform float u_grainSize; // grain speck size, device px
uniform vec3 u_ripples[3]; // click rings: position (device px, y up) and age (seconds)
uniform vec3 u_trailPts[16]; // the pointer's recent path, newest first: position and strength 0..1
uniform int u_trailCount;

out vec4 outColor;

// "Hash without Sine", Copyright (c) 2014 David Hoskins. MIT License:
// https://www.shadertoy.com/view/4djSRW
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

${NOISE}
vec3 oklabToLinear(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
}

vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// rings sent out by clicks: 1 on a ring's crest, fading as it travels outward
float ripples(vec2 frag) {
  float sum = 0.0;
  for (int i = 0; i < 3; i++) {
    vec3 r = u_ripples[i];
    if (r.z < 0.0 || r.z > 3.0) continue;
    float d = length(frag - r.xy) - r.z * 460.0 * u_dpr;
    float w = 34.0 * u_dpr;
    float life = 1.0 - r.z / 3.0;
    sum += exp(-d * d / (w * w)) * life * life;
  }
  return sum;
}

// distance from p to the segment between the trail and the pointer: a light shaped like a soft
// comet while the pointer moves, and a plain circle once it rests
float pointerDist(vec2 p, float trail) {
  vec2 a = u_pointer;
  vec2 b = mix(u_pointer, u_trail, trail);
  vec2 ab = b - a;
  float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
  return length(p - a - ab * h);
}

// the pointer's recent path as a soft stroke: 1 near the newest points, tapering (in width and
// strength) toward the oldest. Each segment between path points is a capsule.
float trailField(vec2 p, float radius) {
  float best = 0.0;
  for (int i = 0; i < 15; i++) {
    if (i + 1 >= u_trailCount) break;
    vec3 a = u_trailPts[i];
    vec3 b = u_trailPts[i + 1];
    vec2 ab = b.xy - a.xy;
    float h = clamp(dot(p - a.xy, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
    float s = mix(a.z, b.z, h);
    float r = radius * (0.35 + 0.65 * s);
    float d = length(p - a.xy - ab * h);
    best = max(best, exp(-d * d / (r * r)) * s);
  }
  if (u_trailCount == 1) {
    float d = length(p - u_trailPts[0].xy);
    best = exp(-d * d / (radius * radius)) * u_trailPts[0].z;
  }
  return best;
}

// mixes two OKLab colours in OKLCH: lightness and chroma blend straight, hue goes the short way
// round, so the middle of a mix stays as vivid as its ends instead of passing through grey
vec3 mixLch(vec3 a, vec3 b, float t) {
  float ca = length(a.yz);
  float cb = length(b.yz);
  float ha = atan(a.z, a.y);
  float hb = atan(b.z, b.y);
  // a near-grey has no real hue of its own: borrow the other colour's
  if (ca < 0.02) ha = hb;
  if (cb < 0.02) hb = ha;
  float dh = mod(hb - ha + 3.14159265, 6.2831853) - 3.14159265;
  float h = ha + dh * t;
  float c = mix(ca, cb, t);
  return vec3(mix(a.x, b.x, t), c * cos(h), c * sin(h));
}

// palette as a ramp, blended in OKLCH: 0 is the first colour, 1 the last
vec3 paletteRampLch(float x) {
  float f = clamp(x, 0.0, 1.0) * float(u_count - 1);
  int i = min(int(floor(f)), u_count - 2);
  return mixLch(u_colors[i], u_colors[i + 1], smoothstep(0.0, 1.0, f - float(i)));
}

// palette as a loop: 0..1 runs through every colour and back to the first
vec3 paletteLoop(float x) {
  float f = fract(x) * float(u_count);
  int i = int(floor(f));
  int j = i + 1 >= u_count ? 0 : i + 1;
  return mix(u_colors[i], u_colors[j], smoothstep(0.0, 1.0, fract(f)));
}

// palette as a ramp: 0 is the first colour, 1 the last
vec3 paletteRamp(float x) {
  float f = clamp(x, 0.0, 1.0) * float(u_count - 1);
  int i = min(int(floor(f)), u_count - 2);
  return mix(u_colors[i], u_colors[i + 1], smoothstep(0.0, 1.0, f - float(i)));
}
`;

const FRAG_MAIN = `
void main() {
  vec3 c = linearToSrgb(shade(gl_FragCoord.xy));
  // grain, plus a touch of per-pixel dither so slow gradients never band
  c += (hash12(floor(gl_FragCoord.xy / u_grainSize)) - 0.5) * u_grain;
  c += (hash12(gl_FragCoord.xy + 17.0) - 0.5) * (1.5 / 255.0);
  outColor = vec4(c, 1.0);
}
`;

/* -------------------------------------------------------------------------- */
/*                                   Helpers                                  */
/* -------------------------------------------------------------------------- */

function subscribeTheme(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

const isDark = () => document.documentElement.classList.contains("dark");

/** srgb hex -> OKLab */
export function hexToOklab(hex: string): [number, number, number] {
  let value = hex.trim().replace(/^#/, "");
  if (value.length === 3) value = [...value].map((c) => c + c).join("");
  const parsed = Number.isNaN(Number.parseInt(value.slice(0, 6), 16))
    ? [0.5, 0.5, 0.5]
    : [
        (Number.parseInt(value.slice(0, 6), 16) >> 16) & 255,
        (Number.parseInt(value.slice(0, 6), 16) >> 8) & 255,
        Number.parseInt(value.slice(0, 6), 16) & 255,
      ].map((c) => c / 255);
  const [r, g, b] = (parsed as number[]).map((e) =>
    e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4,
  );
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function isDarkColor(hex: string) {
  return hexToOklab(hex)[0] < 0.6;
}

const BACKGROUNDS = {
  light: hexToOklab("#ffffff"),
  dark: hexToOklab("#0a0a0a"),
};

function compileShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) || gl.isContextLost()) return shader;
  console.error(gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
}

export function createProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertex);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragment);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) || gl.isContextLost()) return program;
  console.error(gl.getProgramInfoLog(program));
  return null;
}

async function createProgramAsync(
  gl: WebGL2RenderingContext,
  vertex: string,
  fragment: string,
  aborted: () => boolean,
) {
  const parallel = gl.getExtension("KHR_parallel_shader_compile") as
    | (KHR_parallel_shader_compile & { COMPLETION_STATUS_KHR: number })
    | null;
  if (!parallel) return createProgram(gl, vertex, fragment);

  const shaders = [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ].map(([type, source]) => {
    const shader = gl.createShader(type as number)!;
    gl.shaderSource(shader, source as string);
    gl.compileShader(shader);
    return shader;
  });
  const program = gl.createProgram()!;
  for (const shader of shaders) gl.attachShader(program, shader);
  gl.linkProgram(program);

  return new Promise<WebGLProgram | null>((resolve) => {
    const finish = (ok: boolean) => {
      if (!ok && !gl.isContextLost()) {
        for (const shader of shaders) {
          const log = gl.getShaderInfoLog(shader);
          if (log) console.error(log);
        }
        console.error(gl.getProgramInfoLog(program));
      }
      for (const shader of shaders) gl.deleteShader(shader);
      if (!ok) gl.deleteProgram(program);
      resolve(ok ? program : null);
    };
    const poll = () => {
      if (aborted() || gl.isContextLost()) return finish(false);
      if (gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)) {
        return finish(!!gl.getProgramParameter(program, gl.LINK_STATUS));
      }
      requestAnimationFrame(poll);
    };
    poll();
  });
}

/* -------------------------------------------------------------------------- */
/*                                Source pass                                 */
/* -------------------------------------------------------------------------- */

export type PrepassOptions = {
  width: number;
  height: number;
  dpr: number;
  time: number;
  pointer: [number, number];
  pointerAmt: number;
  ripples?: Float32Array;
  uniforms: Record<string, number>;
};

export type Prepass = {
  render: (gl: WebGL2RenderingContext, options: PrepassOptions) => WebGLTexture | null;
  dispose: (gl: WebGL2RenderingContext) => void;
};

/** Renders an arbitrary GLSL `source(vec2)` field into a half-resolution texture. */
export function sourcePass(source: string, scale = 0.5) {
  const shader = `#version 300 es
precision highp float;
uniform vec2 u_res;       // full canvas size, device px
uniform vec2 u_texRes;    // this texture's size
uniform float u_dpr;
uniform float u_time;
uniform vec2 u_pointer;
uniform float u_pointerAmt;
out vec4 outColor;

// "Hash without Sine", Copyright (c) 2014 David Hoskins. MIT License:
// https://www.shadertoy.com/view/4djSRW
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
${NOISE}
${source}

void main() {
  vec2 frag = gl_FragCoord.xy / u_texRes * u_res;
  // stored at a quarter, so an 8-bit target still holds up to 4x
  outColor = vec4(vec3(max(source(frag), 0.0) * 0.25), 1.0);
}
`;
  return (gl: WebGL2RenderingContext): Prepass | null => {
    const program = createProgram(gl, VERT, shader);
    if (!program) return null;
    const useFloat = !!gl.getExtension("EXT_color_buffer_float");
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    let texWidth = 0;
    let texHeight = 0;
    const locations = new Map<string, WebGLUniformLocation | null>();
    const loc = (name: string) => {
      if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
      return locations.get(name)!;
    };
    return {
      render(gl, options) {
        const width = Math.max(1, Math.round(options.width * scale));
        const height = Math.max(1, Math.round(options.height * scale));
        if (width !== texWidth || height !== texHeight) {
          texWidth = width;
          texHeight = height;
          gl.bindTexture(gl.TEXTURE_2D, texture);
          if (useFloat) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
          } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          }
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.viewport(0, 0, width, height);
        gl.useProgram(program);
        gl.uniform2f(loc("u_res"), options.width, options.height);
        gl.uniform2f(loc("u_texRes"), width, height);
        gl.uniform1f(loc("u_dpr"), options.dpr);
        gl.uniform1f(loc("u_time"), options.time);
        gl.uniform2f(loc("u_pointer"), options.pointer[0], options.pointer[1]);
        gl.uniform1f(loc("u_pointerAmt"), options.pointerAmt);
        for (const [name, value] of Object.entries(options.uniforms)) gl.uniform1f(loc(name), value);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.generateMipmap(gl.TEXTURE_2D);
        return texture;
      },
      dispose(gl) {
        gl.deleteProgram(program);
        gl.deleteTexture(texture);
        gl.deleteFramebuffer(framebuffer);
      },
    };
  };
}

/* -------------------------------------------------------------------------- */
/*                               ShaderSurface                                */
/* -------------------------------------------------------------------------- */

export type ShaderSurfaceProps = {
  shader: string;
  uniforms?: Record<string, number>;
  vectors?: Record<string, [number, number, number]>;
  colors: string[];
  speed?: number;
  animate?: boolean;
  interactive?: boolean;
  grain?: number;
  grainSize?: number;
  seed?: number;
  background?: string;
  backgroundDark?: string;
  ripples?: boolean;
  follow?: number;
  trailLife?: number;
  prepass?: (gl: WebGL2RenderingContext) => Prepass | null;
  plainShader?: string;
  maxDpr?: number;
  maxFps?: number;
  fallback?: (dark: boolean, background: string) => string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

type Pointer = {
  x: number;
  y: number;
  lx: number;
  ly: number;
  tx: number;
  ty: number;
  amt: number;
  inside: boolean;
  seen: boolean;
};

type Ripple = { x: number; y: number; start: number };

const RESOLUTION_STEPS = [1, 0.75, 0.5] as const;
const MIN_FRAME = 1 / 48;

export function ShaderSurface({
  shader,
  uniforms,
  vectors,
  colors,
  speed,
  animate,
  interactive,
  grain,
  grainSize = 1,
  seed = 0,
  background = "",
  backgroundDark = "",
  ripples = false,
  follow = 0.6,
  trailLife = 0.9,
  prepass,
  plainShader,
  maxDpr = 1.5,
  maxFps = 60,
  fallback,
  className,
  style,
  children,
}: ShaderSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dark = useSyncExternalStore(subscribeTheme, isDark, () => false);
  const [failed, setFailed] = useState(false);

  const config = {
    uniforms,
    vectors,
    speed,
    animate,
    interactive,
    grain,
    grainSize,
    seed,
    background,
    backgroundDark,
    ripples,
    follow,
    trailLife,
    prepass,
    maxDpr,
    maxFps,
    dark,
    colorKey: colors.join(","),
  };
  const configRef = useRef(config);
  const restartRef = useRef<() => void>(() => {});

  useEffect(() => {
    configRef.current = config;
    restartRef.current();
  });

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let disposed = false;
    let idleHandle = 0;
    const hasIdle = "requestIdleCallback" in window;

    const init = () => {
      if (disposed) return;
      void (() => {
        const container = containerRef.current;
        if (!container) return;

        const canvas = document.createElement("canvas");
        canvas.setAttribute("aria-hidden", "true");
        canvas.className = "pointer-events-none absolute inset-0 -z-10 size-full";
        const gl = canvas.getContext("webgl2", {
          alpha: false,
          antialias: false,
          depth: false,
          stencil: false,
          powerPreference: "low-power",
        });
        if (!gl) {
          setFailed(true);
          return;
        }

        let program: WebGLProgram | null = null;
        let prepassInstance: Prepass | null = null;
        let locations = new Map<string, WebGLUniformLocation | null>();
        const loc = (name: string) => {
          if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program!, name));
          return locations.get(name)!;
        };
        return (async () => {
          prepassInstance = configRef.current.prepass?.(gl) ?? null;
          program = await createProgramAsync(
            gl,
            VERT,
            HEADER + (prepassInstance ? shader : plainShader || shader) + FRAG_MAIN,
            () => disposed,
          );
          locations = new Map();
          if (program) gl.useProgram(program);
          return !!program;
        })().then((ok) => {
          if (disposed) {
            prepassInstance?.dispose(gl);
            return;
          }
          if (!ok) {
            setFailed(true);
            return;
          }

          cleanup = (() => {
            container.prepend(canvas);
            const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
            let cssWidth = 1;
            let cssHeight = 1;
            let resolutionStep = 0;
            let resolutionScale: number = RESOLUTION_STEPS[0];
            let visible = true;
            let contextLost = false;
            let frame = 0;
            let lastFrame = 0;
            let nextFrame = 0;
            let clock = 12;
            let age = 0;
            let themeAcc = 0;
            let themeCount = 0;

            const isDarkNow = () =>
              configRef.current.background && !configRef.current.backgroundDark
                ? isDarkColor(configRef.current.background)
                : document.documentElement.classList.contains("dark");

            let darkAmount = Number(!!isDarkNow());
            let paletteCache = { key: "", data: new Float32Array(18), count: 2 };
            const pointer: Pointer = {
              x: 0,
              y: 0,
              lx: 0,
              ly: 0,
              tx: 0,
              ty: 0,
              amt: 0,
              inside: false,
              seen: false,
            };
            const ripplesList: Ripple[] = Array.from({ length: 3 }, () => ({
              x: 0,
              y: 0,
              start: -Infinity,
            }));
            const rippleData = new Float32Array(9);
            const trail: { x: number; y: number; t: number }[] = [];
            const trailData = new Float32Array(48);
            let backgroundKey = "-";
            let backgroundLight = BACKGROUNDS.light;
            let backgroundDarkColors = BACKGROUNDS.dark;

            const resize = () => {
              const rect = container.getBoundingClientRect();
              cssWidth = Math.max(1, rect.width);
              cssHeight = Math.max(1, rect.height);
              const dpr = Math.min(window.devicePixelRatio || 1, configRef.current.maxDpr) * resolutionScale;
              const width = Math.max(1, Math.round(cssWidth * dpr));
              const height = Math.max(1, Math.round(cssHeight * dpr));
              if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
              }
            };

            const upload = () => {
              if (contextLost || !program) return;
              const cfg = configRef.current;

              if (paletteCache.key !== cfg.colorKey) {
                const list = cfg.colorKey.split(",").filter(Boolean).slice(0, 6);
                if (list.length === 0) list.push("#808080");
                if (list.length === 1) list.push(list[0]);
                const data = new Float32Array(18);
                list.forEach((color, index) => data.set(hexToOklab(color), 3 * index));
                paletteCache = { key: cfg.colorKey, data, count: list.length };
              }

              const dpr = canvas.width / cssWidth;
              if (backgroundKey !== cfg.background + cfg.backgroundDark) {
                backgroundKey = cfg.background + cfg.backgroundDark;
                backgroundLight = cfg.background ? hexToOklab(cfg.background) : BACKGROUNDS.light;
                backgroundDarkColors = cfg.background
                  ? hexToOklab(cfg.backgroundDark || cfg.background)
                  : BACKGROUNDS.dark;
              }
              const bg = backgroundLight.map(
                (value, index) => value + (backgroundDarkColors[index] - value) * darkAmount,
              ) as [number, number, number];

              const now = performance.now() / 1000;
              ripplesList.forEach((ripple, index) =>
                rippleData.set([ripple.x * dpr, ripple.y * dpr, now - ripple.start], 3 * index),
              );
              trailData.fill(0);
              trail.forEach((point, index) => {
                const t = Math.min(1, (now - point.t) / cfg.trailLife);
                trailData.set([point.x * dpr, point.y * dpr, 1 - t * t * (3 - 2 * t)], 3 * index);
              });

              let texture: WebGLTexture | null = null;
              if (prepassInstance) {
                texture = prepassInstance.render(gl, {
                  width: canvas.width,
                  height: canvas.height,
                  dpr,
                  time: clock + 37.1 * cfg.seed,
                  pointer: [pointer.x * dpr, pointer.y * dpr],
                  pointerAmt: pointer.amt,
                  ripples: rippleData,
                  uniforms: cfg.uniforms ?? {},
                });
              }

              gl.bindFramebuffer(gl.FRAMEBUFFER, null);
              gl.bindVertexArray(null);
              gl.disable(gl.BLEND);
              gl.colorMask(true, true, true, true);
              gl.useProgram(program);
              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, texture);
              gl.uniform1i(loc("u_tex"), 0);
              gl.viewport(0, 0, canvas.width, canvas.height);
              gl.uniform2f(loc("u_res"), canvas.width, canvas.height);
              gl.uniform1f(loc("u_dpr"), dpr);
              gl.uniform1f(loc("u_time"), clock + 37.1 * cfg.seed);
              gl.uniform1f(loc("u_age"), cfg.animate && cfg.speed! > 0 && !motion.matches ? age : 1e4);
              gl.uniform2f(loc("u_pointer"), pointer.x * dpr, pointer.y * dpr);
              gl.uniform2f(loc("u_trail"), pointer.lx * dpr, pointer.ly * dpr);
              gl.uniform1f(loc("u_pointerAmt"), pointer.amt);
              gl.uniform3fv(loc("u_colors"), paletteCache.data);
              gl.uniform1i(loc("u_count"), paletteCache.count);
              gl.uniform3f(loc("u_bg"), bg[0], bg[1], bg[2]);
              gl.uniform1f(loc("u_dark"), darkAmount);
              gl.uniform1f(loc("u_grain"), cfg.grain!);
              gl.uniform1f(loc("u_grainSize"), Math.max(1, cfg.grainSize! * dpr));
              gl.uniform3fv(loc("u_ripples"), rippleData);
              gl.uniform3fv(loc("u_trailPts"), trailData);
              gl.uniform1i(loc("u_trailCount"), trail.length);
              for (const [name, value] of Object.entries(cfg.uniforms ?? {})) gl.uniform1f(loc(name), value);
              for (const [name, value] of Object.entries(cfg.vectors ?? {})) {
                gl.uniform3f(loc(name), value[0], value[1], value[2]);
              }
              gl.drawArrays(gl.TRIANGLES, 0, 3);
            };

            const isVisible = () => visible && !document.hidden && !contextLost;
            const request = () => {
              if (!frame && isVisible()) frame = requestAnimationFrame(tick);
            };
            const damp = (current: number, target: number, rate: number, dt: number, epsilon: number) => {
              const next = current + (target - current) * (1 - Math.exp(-rate * dt));
              return Math.abs(target - next) < epsilon ? target : next;
            };

            function tick(time: number) {
              frame = 0;
              const frameMs = 1000 / configRef.current.maxFps;
              if (lastFrame && time < nextFrame - 2) {
                frame = requestAnimationFrame(tick);
                return;
              }
              nextFrame = lastFrame && time - nextFrame < frameMs ? nextFrame + frameMs : time + frameMs;
              const dt = lastFrame ? Math.min((time - lastFrame) / 1000, 0.1) : 0;
              lastFrame = time;

              const cfg = configRef.current;
              const reduced = motion.matches;
              const running = cfg.animate && cfg.speed! > 0 && !reduced;
              if (running) {
                clock += dt * cfg.speed!;
                age += dt;
              }

              const targetDark = Number(!!isDarkNow());
              const themeReveal = document.documentElement.hasAttribute("data-theme-reveal");
              darkAmount = reduced || themeReveal ? targetDark : damp(darkAmount, targetDark, 7, dt, 0.002);

              const targetPointer = cfg.interactive && !reduced && pointer.inside ? 1 : 0;
              pointer.amt = damp(pointer.amt, targetPointer, 3.5, dt, 0.002);

              const followRate = 28 * Math.pow(1 / 9, Math.min(1, Math.max(0, cfg.follow)));
              pointer.x = damp(pointer.x, pointer.tx, followRate, dt, 0.1);
              pointer.y = damp(pointer.y, pointer.ty, followRate, dt, 0.1);
              pointer.lx = damp(pointer.lx, pointer.x, 0.35 * followRate, dt, 0.1);
              pointer.ly = damp(pointer.ly, pointer.y, 0.35 * followRate, dt, 0.1);

              const now = time / 1000;
              while (trail.length && now - trail[trail.length - 1].t > cfg.trailLife) trail.pop();
              if (pointer.amt > 0 && cfg.interactive && !reduced) {
                const head = trail[0];
                if (!head || Math.hypot(head.x - pointer.x, head.y - pointer.y) > 6) {
                  trail.unshift({ x: pointer.x, y: pointer.y, t: now });
                  if (trail.length > 16) trail.pop();
                }
              }

              upload();

              if (running && dt > 0 && age > 0.75 && resolutionStep < RESOLUTION_STEPS.length - 1) {
                themeAcc += dt;
                themeCount += 1;
                if (themeAcc >= 1) {
                  if (themeAcc / themeCount > Math.max(MIN_FRAME, 1.25 / configRef.current.maxFps)) {
                    resolutionStep += 1;
                    resolutionScale = RESOLUTION_STEPS[resolutionStep];
                    resize();
                  }
                  themeAcc = 0;
                  themeCount = 0;
                }
              }

              const needsFrame =
                ripplesList.some((ripple) => time / 1000 - ripple.start < 3) ||
                trail.length > 0 ||
                darkAmount !== targetDark ||
                pointer.amt !== targetPointer ||
                (pointer.amt > 0 &&
                  (pointer.x !== pointer.tx ||
                    pointer.y !== pointer.ty ||
                    pointer.lx !== pointer.x ||
                    pointer.ly !== pointer.y));

              if (running || needsFrame) request();
              else lastFrame = 0;
            }

            restartRef.current = () => {
              resize();
              if (!frame && isVisible()) {
                lastFrame = 0;
                frame = requestAnimationFrame(tick);
              }
            };

            const onPointerMove = (event: PointerEvent) => {
              const rect = container.getBoundingClientRect();
              pointer.tx = event.clientX - rect.left;
              pointer.ty = rect.bottom - event.clientY;
              pointer.inside =
                event.clientX >= rect.left &&
                event.clientX <= rect.right &&
                event.clientY >= rect.top &&
                event.clientY <= rect.bottom;
              if (!pointer.seen || pointer.amt === 0) {
                pointer.x = pointer.lx = pointer.tx;
                pointer.y = pointer.ly = pointer.ty;
                pointer.seen = true;
              }
              if (configRef.current.interactive) request();
            };

            const onPointerDown = (event: PointerEvent) => {
              onPointerMove(event);
              if (configRef.current.ripples && configRef.current.interactive && pointer.inside && !motion.matches) {
                const oldest = ripplesList.reduce((a, b) => (a.start < b.start ? a : b));
                Object.assign(oldest, { x: pointer.tx, y: pointer.ty, start: performance.now() / 1000 });
                request();
              }
            };

            const onPointerLeave = () => {
              pointer.inside = false;
              request();
            };
            const onVisibility = () => {
              lastFrame = 0;
              request();
            };
            const onContextLost = (event: Event) => {
              event.preventDefault();
              contextLost = true;
              cancelAnimationFrame(frame);
              frame = 0;
            };
            const onContextRestored = () => {
              contextLost = false;
              prepassInstance = configRef.current.prepass?.(gl) ?? null;
              program = createProgram(
                gl,
                VERT,
                HEADER + (prepassInstance ? shader : plainShader || shader) + FRAG_MAIN,
              );
              locations = new Map();
              if (program) gl.useProgram(program);
              if (program) request();
              else {
                canvas.remove();
                setFailed(true);
              }
            };

            window.addEventListener("pointermove", onPointerMove, { passive: true });
            window.addEventListener("pointerdown", onPointerDown, { passive: true });
            document.documentElement.addEventListener("pointerleave", onPointerLeave);
            window.addEventListener("blur", onPointerLeave);
            document.addEventListener("visibilitychange", onVisibility);
            motion.addEventListener("change", onVisibility);
            canvas.addEventListener("webglcontextlost", onContextLost);
            canvas.addEventListener("webglcontextrestored", onContextRestored);

            const resizeObserver = typeof ResizeObserver === 'function'
              ? new ResizeObserver(() => {
                resize();
                upload();
                request();
              })
              : null;
            resizeObserver?.observe(container);
            const intersectionObserver = typeof IntersectionObserver === 'function'
              ? new IntersectionObserver(([entry]) => {
                visible = entry.isIntersecting;
                lastFrame = 0;
                request();
              })
              : null;
            intersectionObserver?.observe(container);

            const rect = container.getBoundingClientRect();
            const visibleNow =
              !motion.matches &&
              rect.bottom > 0 &&
              rect.top < innerHeight &&
              (container.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) ?? false);
            if (visibleNow) {
              canvas.style.opacity = "0";
              canvas.style.transition = "opacity 500ms ease-out";
            }
            resize();
            upload();
            if (visibleNow) requestAnimationFrame(() => (canvas.style.opacity = "1"));
            request();

            return () => {
              cancelAnimationFrame(frame);
              restartRef.current = () => {};
              resizeObserver?.disconnect();
              intersectionObserver?.disconnect();
              window.removeEventListener("pointermove", onPointerMove);
              window.removeEventListener("pointerdown", onPointerDown);
              document.documentElement.removeEventListener("pointerleave", onPointerLeave);
              window.removeEventListener("blur", onPointerLeave);
              document.removeEventListener("visibilitychange", onVisibility);
              motion.removeEventListener("change", onVisibility);
              canvas.removeEventListener("webglcontextlost", onContextLost);
              canvas.removeEventListener("webglcontextrestored", onContextRestored);
              prepassInstance?.dispose(gl);
              gl.getExtension("WEBGL_lose_context")?.loseContext();
              canvas.remove();
            };
          })();
        });
      })();
    };

    const observer = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            observer?.disconnect();
            if (hasIdle) {
              idleHandle = (
                window as Window & {
                  requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number;
                }
              ).requestIdleCallback(init, { timeout: 1000 });
            } else {
              idleHandle = window.setTimeout(init, 1);
            }
          }
        },
        { rootMargin: "50% 0px" },
      )
      : null;
    if (observer && containerRef.current) observer.observe(containerRef.current);
    else if (!observer) init();

    return () => {
      disposed = true;
      observer?.disconnect();
      if (hasIdle) {
        (window as Window & { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(idleHandle);
      } else {
        clearTimeout(idleHandle);
      }
      cleanup?.();
    };
  }, [shader, plainShader]);

  const light = background || "#ffffff";
  const darkBackground = backgroundDark || background || "#0a0a0a";
  const lightGradient = fallback?.(isDarkColor(light), light) ?? light;
  const darkGradient = fallback?.(isDarkColor(darkBackground), darkBackground) ?? darkBackground;

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative isolate overflow-hidden [background:var(--shader-fallback)] dark:[background:var(--shader-fallback-dark)]",
        className,
      )}
      data-fallback={failed || undefined}
      style={
        {
          "--shader-fallback": lightGradient,
          "--shader-fallback-dark": darkGradient,
          ...style,
        } as CSSProperties
      }
    >
      {children}
    </div>
  );
}
