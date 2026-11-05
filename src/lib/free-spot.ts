import type { DriverCommandIssuer } from "@drawdy/driver-protocol";

export type Rect = { x: number; y: number; width: number; height: number };

export const PLACE_GAP = 40;
const DRAWER_MARGIN_PX = 16;
// Drawer width plus its gap to the extension bar, used when the iframe rect can't be read.
const DRAWER_FALLBACK_PX = 360;
const SEARCH_COLUMNS = 4;
const SEARCH_TRIES = 24;
const FLY_DURATION_MS = 350;

export const rectRight = (r: Rect): number => r.x + r.width;
export const rectBottom = (r: Rect): number => r.y + r.height;

export function overlaps(a: Rect, b: Rect, gap = 0): boolean {
    return (
        a.x < rectRight(b) + gap &&
        b.x < rectRight(a) + gap &&
        a.y < rectBottom(b) + gap &&
        b.y < rectBottom(a) + gap
    );
}

export function contains(outer: Rect, inner: Rect): boolean {
    return (
        inner.x >= outer.x &&
        inner.y >= outer.y &&
        rectRight(inner) <= rectRight(outer) &&
        rectBottom(inner) <= rectBottom(outer)
    );
}

export function union(rects: Rect[]): Rect | null {
    if (rects.length === 0) return null;
    const x = Math.min(...rects.map((r) => r.x));
    const y = Math.min(...rects.map((r) => r.y));
    return {
        x,
        y,
        width: Math.max(...rects.map(rectRight)) - x,
        height: Math.max(...rects.map(rectBottom)) - y,
    };
}

/** The preferred rect first, then steps right across a row of columns, then the next row down. */
export function candidateRects(
    preferred: Rect,
    gap = PLACE_GAP,
    tries = SEARCH_TRIES
): Rect[] {
    const out: Rect[] = [];
    for (let i = 0; i < tries; i++) {
        const col = i % SEARCH_COLUMNS;
        const row = Math.floor(i / SEARCH_COLUMNS);
        out.push({
            ...preferred,
            x: preferred.x + col * (preferred.width + gap),
            y: preferred.y + row * (preferred.height + gap),
        });
    }
    return out;
}

export function firstFreeRect(
    candidates: Rect[],
    occupied: Rect[],
    gap = PLACE_GAP
): Rect | null {
    return (
        candidates.find((c) => occupied.every((o) => !overlaps(c, o, gap))) ??
        null
    );
}

export function centredIn(area: Rect, width: number, height: number): Rect {
    return {
        x: area.x + (area.width - width) / 2,
        y: area.y + (area.height - height) / 2,
        width,
        height,
    };
}

export function rightOf(
    source: Rect,
    width: number,
    height: number,
    gap = PLACE_GAP
): Rect {
    return { x: rectRight(source) + gap, y: source.y, width, height };
}

export function below(
    source: Rect,
    width: number,
    height: number,
    gap = PLACE_GAP
): Rect {
    return { x: source.x, y: rectBottom(source) + gap, width, height };
}

type Ctx = {
    issueCommand: DriverCommandIssuer;
    driverId: string;
    nextRequestId: () => string;
    /** The webview's dom id (`webviewDomId`), so the drawer can be measured. */
    webviewDomId?: string;
};

async function issue<T>(
    ctx: Ctx,
    type: string,
    req: unknown
): Promise<T | null> {
    try {
        const res = (await ctx.issueCommand({
            type,
            driverId: ctx.driverId,
            requestId: ctx.nextRequestId(),
            req,
        } as Parameters<DriverCommandIssuer>[0])) as {
            res: { error?: unknown; value?: unknown };
        };
        if (res?.res?.error !== undefined) return null;
        return (res.res.value as T | undefined) ?? null;
    } catch {
        return null;
    }
}

/** The part of the viewport not covered by the extension drawer, in canvas coordinates. */
export async function visibleArea(ctx: Ctx): Promise<Rect | null> {
    const view = await issue<{ rect: Rect }>(
        ctx,
        "command:camera:get-viewport-rect",
        undefined
    );
    if (!view) return null;
    const viewport = view.rect;
    let drawerLeft: number | null = null;
    if (ctx.webviewDomId) {
        const dom = await issue<Rect>(ctx, "command:dom:element-rect", {
            elementId: ctx.webviewDomId,
        });
        if (dom && dom.width > 0) {
            const p = await issue<{ x: number; y: number }>(
                ctx,
                "command:camera:screen-to-canvas",
                {
                    x: dom.x - DRAWER_MARGIN_PX,
                    y: dom.y,
                }
            );
            if (p) drawerLeft = p.x;
        }
    }
    if (drawerLeft === null) {
        const cam = await issue<{ zoom: number }>(
            ctx,
            "command:camera:get-info",
            undefined
        );
        const zoom = cam?.zoom && cam.zoom > 0 ? cam.zoom : 1;
        drawerLeft = rectRight(viewport) - DRAWER_FALLBACK_PX / zoom;
    }
    const width = Math.max(
        0,
        Math.min(rectRight(viewport), drawerLeft) - viewport.x
    );
    return { ...viewport, width: width > 0 ? width : viewport.width };
}

/**
 * Finds the first spot at or after `preferred` that overlaps nothing on the board.
 * Frames and the ids in `ignoreIds` (for example the element being replaced) don't count.
 */
export async function findFreeRect(
    ctx: Ctx,
    preferred: Rect,
    ignoreIds: string[] = [],
    gap = PLACE_GAP
): Promise<Rect> {
    const candidates = candidateRects(preferred, gap);
    const area = union(candidates);
    if (!area) return preferred;
    const hits = await issue<{
        drawdyElements: { id: string; type?: string }[];
    }>(ctx, "command:scene:query-rect", {
        rect: {
            x: area.x - gap,
            y: area.y - gap,
            width: area.width + 2 * gap,
            height: area.height + 2 * gap,
        },
        properties: ["type"],
    });
    if (!hits) return preferred;
    const ignore = new Set(ignoreIds);
    const ids = hits.drawdyElements
        .filter((e) => e.type !== "frame" && !ignore.has(e.id))
        .map((e) => e.id);
    if (ids.length === 0) return preferred;
    const rects = await issue<{
        rects: { drawdyElementId: string; rect: Rect }[];
    }>(ctx, "command:scene:element-rects", { drawdyElementIds: ids });
    if (!rects) return preferred;
    return (
        firstFreeRect(
            candidates,
            rects.rects.map((r) => r.rect),
            gap
        ) ?? preferred
    );
}

/**
 * Selects what was just placed and brings it into the area left of the drawer,
 * keeping the current zoom unless the result doesn't fit.
 */
export async function revealAndSelect(
    ctx: Ctx,
    ids: string[],
    placed: Rect
): Promise<void> {
    if (ids.length === 0) return;
    await issue(ctx, "command:scene:set-selection", { drawdyElementIds: ids });
    const area = await visibleArea(ctx);
    if (area && contains(area, placed)) return;
    const view = await issue<{ rect: Rect }>(
        ctx,
        "command:camera:get-viewport-rect",
        undefined
    );
    const cam = await issue<{ zoom: number }>(
        ctx,
        "command:camera:get-info",
        undefined
    );
    const zoom = cam?.zoom && cam.zoom > 0 ? cam.zoom : 1;
    const covered =
        area && view
            ? rectRight(view.rect) - rectRight(area)
            : DRAWER_FALLBACK_PX / zoom;
    await issue(ctx, "command:camera:fly-to-rect", {
        rect: { ...placed, width: placed.width + Math.max(0, covered) },
        flyDurationMs: FLY_DURATION_MS,
        zoom,
    });
}
