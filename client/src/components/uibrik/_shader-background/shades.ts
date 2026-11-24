import { hexToOklab } from "./ShaderSurface";

export type Shade = [lightness: number, chroma: number, hueShift: number];

const srgbHex = (value: number) =>
  Math.round(255 * Math.min(1, Math.max(0, value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055)))
    .toString(16)
    .padStart(2, "0");

/** Build a one-hue family of colours: lightness, chroma multiplier, hue shift (radians). */
export function shadesOf(color: string, shades: readonly Shade[]) {
  const [, a, b] = hexToOklab(color);
  const chroma = Math.hypot(a, b);
  const hue = Math.atan2(b, a);

  return shades.map(([lightness, chromaScale, hueShift]) => {
    let c = chroma * chromaScale;
    for (let attempt = 0; attempt < 24; attempt++, c *= 0.9) {
      const x = c * Math.cos(hue + hueShift);
      const y = c * Math.sin(hue + hueShift);
      const l = (lightness + 0.3963377774 * x + 0.2158037573 * y) ** 3;
      const m = (lightness - 0.1055613458 * x - 0.0638541728 * y) ** 3;
      const s = (lightness - 0.0894841775 * x - 1.291485548 * y) ** 3;
      const rgb = [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
      ];
      // pull chroma back in until the colour fits sRGB
      if (rgb.every((value) => value >= -0.001 && value <= 1.001) || attempt === 23) {
        return `#${rgb.map(srgbHex).join("")}`;
      }
    }
    return "#000000";
  });
}

export function paletteOf(color: string, colors: string[] | undefined, shades: readonly Shade[]) {
  const list = colors?.filter(Boolean).slice(0, 6);
  return list && list.length >= 2 ? list : shadesOf(color, shades);
}
