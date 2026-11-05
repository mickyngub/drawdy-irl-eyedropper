export type Rgb = { r: number; g: number; b: number };

export type Lab = { L: number; a: number; b: number };

export const LABEL_DARK = "#1f2937";
export const LABEL_LIGHT = "#ffffff";

const clamp = (value: number, lo: number, hi: number): number =>
    Math.min(hi, Math.max(lo, value));

export function parseHex(hex: string): Rgb | null {
    const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
    if (!match) return null;
    let digits = match[1];
    if (digits.length === 3) {
        digits = digits
            .split("")
            .map((d) => d + d)
            .join("");
    }
    const n = parseInt(digits, 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

export function toHex(rgb: Rgb): string {
    const part = (v: number) =>
        Math.round(clamp(v, 0, 255))
            .toString(16)
            .padStart(2, "0");
    return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`.toUpperCase();
}

export function srgbToLinear(channel: number): number {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(linear: number): number {
    const c = clamp(linear, 0, 1);
    const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return v * 255;
}

export function rgbToOklab(rgb: Rgb): Lab {
    const r = srgbToLinear(rgb.r);
    const g = srgbToLinear(rgb.g);
    const b = srgbToLinear(rgb.b);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return {
        L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    };
}

export function hexToOklab(hex: string): Lab | null {
    const rgb = parseHex(hex);
    return rgb ? rgbToOklab(rgb) : null;
}

export function deltaE(x: Lab, y: Lab): number {
    return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
}

export function relativeLuminance(rgb: Rgb): number {
    return (
        0.2126 * srgbToLinear(rgb.r) +
        0.7152 * srgbToLinear(rgb.g) +
        0.0722 * srgbToLinear(rgb.b)
    );
}

export function contrastRatio(x: Rgb, y: Rgb): number {
    const a = relativeLuminance(x);
    const b = relativeLuminance(y);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function labelColour(hex: string): string {
    const rgb = parseHex(hex);
    if (!rgb) return LABEL_DARK;
    const dark = contrastRatio(rgb, parseHex(LABEL_DARK)!);
    const light = contrastRatio(rgb, parseHex(LABEL_LIGHT)!);
    return dark >= light ? LABEL_DARK : LABEL_LIGHT;
}
