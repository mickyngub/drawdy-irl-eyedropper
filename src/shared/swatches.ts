export const MAX_SWATCHES = 16;

const HEX = /^#[0-9a-f]{6}$/i;

export const isHex = (value: unknown): value is string =>
    typeof value === "string" && HEX.test(value);

export function parseSwatches(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const hexes = raw.filter(isHex).map((hex) => hex.toUpperCase());
    return [...new Set(hexes)].slice(0, MAX_SWATCHES);
}
