import type { DrawdyElementSchema } from "@drawdy/driver-protocol";
import { contrastRatio, labelColour, parseHex } from "../shared/colour";
import { nearestCssName } from "../shared/css-names";

export type Point = { x: number; y: number };

export const COLUMNS = 6;
export const CELL = 72;
export const SQUARE_GAP = 8;
export const ROW_GAP = 16;
export const NAME_GAP = 8;
export const CORNER_RADIUS = 8;
export const MIN_FONT = 8;
export const HEX_FONT_MAX = 16;
export const NAME_FONT_MAX = 14;
// Measured in Drawdy's handwriting font: a hex label runs up to 0.6 em per
// character, and colour-name words 0.47 to 0.61.
export const CHAR_EM = 0.6;
// The host pads a shape's label by 8 on each side.
const SHAPE_TEXT_PADDING = 8;
const LINE_HEIGHT = 1.4;
// Drawdy's board colours (--surface-canvas) in light and dark theme.
export const BOARD_COLOURS = { light: "#f4f4f5", dark: "#18181b" } as const;
// Upper case, like the swatch colours, so the host's theme swap leaves it alone.
export const NEUTRAL_STROKE = "#A1A1AA";
const NEAR_BOARD_CONTRAST = 1.4;

export function nearBoard(hex: string, board: string): boolean {
    const a = parseHex(hex);
    const b = parseHex(board);
    return !!a && !!b && contrastRatio(a, b) < NEAR_BOARD_CONTRAST;
}

export function fitFont(
    chars: number,
    available: number,
    max: number
): number | null {
    if (chars <= 0) return null;
    const size = Math.min(max, Math.floor(available / (chars * CHAR_EM)));
    return size >= MIN_FONT ? size : null;
}

export function hexFont(cellWidth: number): number | null {
    return fitFont(7, cellWidth - SHAPE_TEXT_PADDING * 2, HEX_FONT_MAX);
}

export function nameFont(name: string, cellWidth: number): number | null {
    const longest = Math.max(...name.split(" ").map((word) => word.length));
    return fitFont(longest, cellWidth, NAME_FONT_MAX);
}

function nameLines(name: string, font: number, cellWidth: number): number {
    const perLine = Math.max(1, Math.floor(cellWidth / (font * CHAR_EM)));
    let lines = 1;
    let used = 0;
    for (const word of name.split(" ")) {
        const need = used === 0 ? word.length : used + 1 + word.length;
        if (need > perLine && used > 0) {
            lines += 1;
            used = word.length;
        } else {
            used = need;
        }
    }
    return lines;
}

export type SwatchPlan = {
    x: number;
    y: number;
    hex: string;
    label: { text: string; font: number; colour: string } | null;
    name: { text: string; font: number } | null;
};

export type PalettePlan = {
    swatches: SwatchPlan[];
    width: number;
    height: number;
};

// Rows of up to six squares, the size of palette-extractor's six-colour row,
// so all sixteen swatches keep readable labels.
export function planPalette(hexes: string[]): PalettePlan {
    const columns = Math.min(COLUMNS, hexes.length);
    const swatches: SwatchPlan[] = [];
    let top = 0;
    let height = 0;
    for (let start = 0; start < hexes.length; start += COLUMNS) {
        let nameHeight = 0;
        const row = hexes.slice(start, start + COLUMNS).map((raw, col) => {
            const hex = raw.toUpperCase();
            const labelSize = hexFont(CELL);
            const name = nearestCssName(hex).name;
            const nameSize = nameFont(name, CELL);
            if (nameSize !== null) {
                const lines = nameLines(name, nameSize, CELL);
                nameHeight = Math.max(
                    nameHeight,
                    NAME_GAP + ((lines - 1) * LINE_HEIGHT + 1) * nameSize
                );
            }
            return {
                x: col * (CELL + SQUARE_GAP),
                y: top,
                hex,
                label:
                    labelSize === null
                        ? null
                        : {
                              text: hex,
                              font: labelSize,
                              colour: labelColour(hex),
                          },
                name: nameSize === null ? null : { text: name, font: nameSize },
            };
        });
        swatches.push(...row);
        height = top + CELL + nameHeight;
        top = height + ROW_GAP;
    }
    return {
        swatches,
        width: columns * CELL + Math.max(0, columns - 1) * SQUARE_GAP,
        height,
    };
}

export function paletteElements({
    hexes,
    origin,
    ink,
    board = BOARD_COLOURS.light,
    driverId,
    generateId,
    at,
}: {
    hexes: string[];
    origin: Point;
    ink: string;
    board?: string;
    driverId: string;
    generateId: () => string;
    at: number;
}): DrawdyElementSchema[] {
    const plan = planPalette(hexes);
    const shared = {
        groupId: generateId(),
        meta: { [driverId]: { at } },
    };
    const rects: DrawdyElementSchema[] = plan.swatches.map((s) => ({
        type: "shape",
        componentType: "rect",
        drawdyElementId: generateId(),
        ...shared,
        x: origin.x + s.x,
        y: origin.y + s.y,
        width: CELL,
        height: CELL,
        // Upper case so the host's theme swap, which matches its own lower
        // case palette hexes exactly, never repaints a swatch in dark mode.
        strokeColor: nearBoard(s.hex, board) ? NEUTRAL_STROKE : s.hex,
        fillColor: s.hex,
        fillStyle: "solid",
        strokeWidth: 1,
        roughness: 0,
        cornerRadius: CORNER_RADIUS,
        ...(s.label
            ? {
                  text: s.label.text,
                  fontSize: s.label.font,
                  textColor: s.label.colour,
                  textAlign: "center" as const,
                  textVerticalAlign: "middle" as const,
              }
            : {}),
    }));
    const names: DrawdyElementSchema[] = plan.swatches.flatMap((s) =>
        s.name
            ? [
                  {
                      type: "text" as const,
                      drawdyElementId: generateId(),
                      ...shared,
                      x: origin.x + s.x,
                      y: origin.y + s.y + CELL + NAME_GAP,
                      width: CELL,
                      text: s.name.text,
                      fontSize: s.name.font,
                      color: ink,
                      textAlign: "center" as const,
                  },
              ]
            : []
    );
    return [...rects, ...names];
}
