import {
    linearToSrgb,
    parseHex,
    srgbToLinear,
    toHex,
} from "../../src/shared/colour";
import { MAX_SWATCHES } from "../../src/shared/swatches";

export type Linear = [number, number, number];

export type Point = { x: number; y: number };

export const PATCH_RADIUS = 6;
const TRIM = 0.2;
const MIN_GAIN = 0.5;
const MAX_GAIN = 2;
const MIN_WHITE_LUMINANCE = 0.25;
const SAME_SWATCH_DELTA_E = 3;
const D65 = [0.95047, 1, 1.08883] as const;

const clamp = (value: number, lo: number, hi: number): number =>
    Math.min(hi, Math.max(lo, value));

export const luminance = ([r, g, b]: Linear): number =>
    0.2126 * r + 0.7152 * g + 0.0722 * b;

export function toSourcePoint(
    point: Point,
    mirrored: boolean,
    width: number,
    height: number
): Point {
    const x = mirrored ? 1 - point.x : point.x;
    return {
        x: clamp(Math.floor(x * width), 0, width - 1),
        y: clamp(Math.floor(point.y * height), 0, height - 1),
    };
}

export function sampleColour(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    point: Point,
    gains?: Linear
): { hex: string; linear: Linear } {
    const cx = clamp(Math.round(point.x), 0, width - 1);
    const cy = clamp(Math.round(point.y), 0, height - 1);
    const pixels: { linear: Linear; y: number }[] = [];
    for (
        let y = Math.max(0, cy - PATCH_RADIUS);
        y <= Math.min(height - 1, cy + PATCH_RADIUS);
        y++
    ) {
        for (
            let x = Math.max(0, cx - PATCH_RADIUS);
            x <= Math.min(width - 1, cx + PATCH_RADIUS);
            x++
        ) {
            const i = (y * width + x) * 4;
            const linear: Linear = [
                srgbToLinear(rgba[i]),
                srgbToLinear(rgba[i + 1]),
                srgbToLinear(rgba[i + 2]),
            ];
            pixels.push({ linear, y: luminance(linear) });
        }
    }
    pixels.sort((a, b) => a.y - b.y);
    const drop = Math.floor(pixels.length * TRIM);
    const kept = pixels.slice(drop, pixels.length - drop);
    const sum: Linear = [0, 0, 0];
    for (const { linear } of kept) {
        for (let c = 0; c < 3; c++) sum[c] += linear[c];
    }
    const linear = sum.map((total, c) =>
        clamp((total / kept.length) * (gains?.[c] ?? 1), 0, 1)
    ) as Linear;
    const [r, g, b] = linear.map(linearToSrgb);
    return { hex: toHex({ r, g, b }), linear };
}

export function whiteGains(linear: Linear): Linear {
    const target = (linear[0] + linear[1] + linear[2]) / 3;
    return linear.map((c) =>
        c > 0 ? clamp(target / c, MIN_GAIN, MAX_GAIN) : MAX_GAIN
    ) as Linear;
}

export const tooDarkForWhite = (linear: Linear): boolean =>
    luminance(linear) < MIN_WHITE_LUMINANCE;

function hexToLab(hex: string): [number, number, number] {
    const rgb = parseHex(hex) ?? { r: 0, g: 0, b: 0 };
    const [r, g, b] = [rgb.r, rgb.g, rgb.b].map(srgbToLinear);
    const xyz = [
        0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
        0.2126729 * r + 0.7151522 * g + 0.072175 * b,
        0.0193339 * r + 0.119192 * g + 0.9503041 * b,
    ];
    const [fx, fy, fz] = xyz.map((v, i) => {
        const t = v / D65[i];
        return t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116;
    });
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function deltaE76(a: string, b: string): number {
    const [l1, a1, b1] = hexToLab(a);
    const [l2, a2, b2] = hexToLab(b);
    return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

export function addSwatch(
    list: string[],
    hex: string,
    max = MAX_SWATCHES
): string[] {
    const same = list.findIndex(
        (swatch) => deltaE76(swatch, hex) < SAME_SWATCH_DELTA_E
    );
    if (same === -1) return [hex, ...list].slice(0, max);
    return [list[same], ...list.filter((_, i) => i !== same)].slice(0, max);
}
