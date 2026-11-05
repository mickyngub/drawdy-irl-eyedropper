import type {
    DriverCommandIssuer,
    DriverManifest,
    DriverModule,
    ModuleStyling,
    ProtocolCommandError,
} from "@drawdy/driver-protocol";
import { ACTION_BUTTON_SVG } from "./action-button";
import { errorReason } from "./lib/error-reason";
import {
    centredIn,
    findFreeRect,
    revealAndSelect,
    visibleArea,
} from "./lib/free-spot";
import { BOARD_COLOURS, paletteElements, planPalette } from "./lib/layout";
import { PAINT_PROPERTIES, paintUpdates } from "./lib/paint";
import type {
    DriverToWebview,
    ErrorDuring,
    WebviewToDriver,
} from "./shared/messages";
import { isHex, parseSwatches } from "./shared/swatches";
import { WEBVIEW_HTML } from "./webview-html";

export const STREAM_SIZE = { width: 1280, height: 720 };
export const SWATCHES_KEY = "swatches";
export const USE_FOR_DRAWING_KEY = "useForDrawing";
// LIGHT_FOREGROUND in Drawdy's palette: adaptive, so it flips to light ink in dark mode.
const FALLBACK_INK = "oklch(0.25 0.005 260)";

let requestId = 0;

let driver: {
    manifest: DriverManifest;
    issueCommand: DriverCommandIssuer;
    generateId: () => string;
    styling: ModuleStyling;
    actionButtonId: string;
    webviewId: string;
    watchingSelection: boolean;
} | null = null;

let chain: Promise<void> = Promise.resolve();

const nextRequestId = (): string => String(requestId++);

function stylingCssVars(styling: ModuleStyling): string {
    const { tokens, ...flat } = styling as ModuleStyling & {
        tokens?: Record<string, string>;
    };
    const vars = Object.entries(flat).map(([key, value]) =>
        key === "theme"
            ? `color-scheme: ${value};`
            : `--drawdy-${key.replace(
                  /[A-Z]/g,
                  (c) => `-${c.toLowerCase()}`
              )}: ${value};`
    );
    for (const [name, value] of Object.entries(tokens ?? {}))
        vars.push(`${name}: ${value};`);
    return vars.join("");
}

function enqueue(task: () => Promise<void>): Promise<void> {
    const next = chain.then(task).catch(() => undefined);
    chain = next;
    return next;
}

async function post(
    message: DriverToWebview,
    transfer?: Transferable[]
): Promise<boolean> {
    if (!driver) return false;
    const sent = await driver.issueCommand({
        type: "command:webview:post-message",
        driverId: driver.manifest.driverId,
        requestId: nextRequestId(),
        req: {
            webviewDomId: driver.webviewId,
            message,
            ...(transfer ? { transfer } : {}),
        },
    });
    return sent.res.error === undefined && sent.res.value.posted;
}

function fail(type: ProtocolCommandError["type"], during: ErrorDuring): void {
    void post({ type: "error", reason: errorReason(type), during });
}

export const activate: DriverModule["activate"] = async ({
    manifest,
    issueCommand,
    styling,
    generateId,
}) => {
    driver = {
        manifest,
        issueCommand,
        generateId,
        styling,
        actionButtonId: `${manifest.driverId}:action-button`,
        webviewId: `${manifest.driverId}:webview`,
        watchingSelection: false,
    };
    const { driverId } = manifest;

    const created = await issueCommand({
        type: "command:dom:create-action-button",
        driverId,
        requestId: nextRequestId(),
        req: { domElementId: driver.actionButtonId, svg: ACTION_BUTTON_SVG },
    });
    if (created.res.error !== undefined) return;

    await Promise.all([
        issueCommand({
            type: "subscription:dom:element-clicked",
            driverId,
            requestId: nextRequestId(),
            req: { domElementId: driver.actionButtonId },
        }),
        issueCommand({
            type: "subscription:webview:message",
            driverId,
            requestId: nextRequestId(),
            req: { webviewDomId: driver.webviewId },
        }),
        issueCommand({
            type: "subscription:dom:theme-changed",
            driverId,
            requestId: nextRequestId(),
        }),
    ]);
};

export const onEvent: DriverModule["onEvent"] = async (event) => {
    if (!driver) return;
    switch (event.type) {
        case "subscription:dom:element-clicked": {
            if (event.body.domElementId !== driver.actionButtonId) return;
            await enqueue(openWebview);
            return;
        }
        case "subscription:webview:message": {
            if (event.body.webviewDomId !== driver.webviewId) return;
            const message = event.body.message;
            if (typeof message !== "object" || message === null) return;
            await handleWebviewMessage(message as WebviewToDriver);
            return;
        }
        case "subscription:dom:theme-changed": {
            driver.styling = event.body.styling;
            void post({
                type: "theme",
                cssVars: stylingCssVars(driver.styling),
            });
            return;
        }
        case "subscription:scene:drawdy-element-selection": {
            void post({
                type: "selection",
                count: event.body.drawdyElementIds.length,
            });
            return;
        }
        default: {
            return;
        }
    }
};

async function openWebview(): Promise<void> {
    if (!driver) return;
    await driver.issueCommand({
        type: "command:webview:create",
        driverId: driver.manifest.driverId,
        requestId: nextRequestId(),
        req: {
            webviewDomId: driver.webviewId,
            htmlContent: WEBVIEW_HTML.replace(
                "/*__DRAWDY_STYLING__*/",
                stylingCssVars(driver.styling)
            ),
            keepStateWhenClosed: false,
        },
    });
}

async function handleWebviewMessage(message: WebviewToDriver): Promise<void> {
    switch (message.type) {
        case "start": {
            await enqueue(startCamera);
            return;
        }
        case "stop": {
            await enqueue(endStream);
            return;
        }
        case "ready": {
            await enqueue(sendState);
            return;
        }
        case "save": {
            await enqueue(() => save(message.swatches, message.useForDrawing));
            return;
        }
        case "pen": {
            await enqueue(() => setPen(message.hex));
            return;
        }
        case "paint": {
            await enqueue(() => paint(message.hex));
            return;
        }
        case "add": {
            await enqueue(() => addPalette(message.swatches));
            return;
        }
        default: {
            return;
        }
    }
}

async function endStream(): Promise<void> {
    if (!driver) return;
    await driver.issueCommand({
        type: "command:webcam:end-stream",
        driverId: driver.manifest.driverId,
        requestId: nextRequestId(),
    });
}

async function startCamera(): Promise<void> {
    // A panel that closed before its stop arrived still holds the stream, and Drawdy answers in-use until it ends.
    await endStream();
    if (!driver) return;
    const started = await driver.issueCommand({
        type: "command:webcam:start-stream",
        driverId: driver.manifest.driverId,
        requestId: nextRequestId(),
        req: {
            constraints: {
                width: { ideal: STREAM_SIZE.width },
                height: { ideal: STREAM_SIZE.height },
                facingMode: "user",
            },
        },
    });
    if (!driver) return;
    if (started.res.error !== undefined) {
        fail(started.res.error.type, "start");
        return;
    }
    const { port, notAvailableReason } = started.res.value;
    if (!port) {
        void post({
            type: "error",
            reason: notAvailableReason,
            during: "start",
        });
        return;
    }
    const posted = await post({ type: "started", port }, [
        port as unknown as MessagePort,
    ]);
    if (!posted) await endStream();
}

async function readKey(key: string): Promise<Record<string, unknown>> {
    if (!driver) return {};
    const read = await driver.issueCommand({
        type: "command:kv-storage:get",
        driverId: driver.manifest.driverId,
        requestId: nextRequestId(),
        req: { key },
    });
    return (read.res.error === undefined && read.res.value.got) || {};
}

async function writeKey(key: string, value: unknown): Promise<void> {
    if (!driver) return;
    await driver.issueCommand({
        type: "command:kv-storage:set",
        driverId: driver.manifest.driverId,
        requestId: nextRequestId(),
        req: { key, payload: { [key]: value } },
    });
}

async function selectedIds(): Promise<
    { ids: string[] } | { error: ProtocolCommandError["type"] }
> {
    if (!driver) return { ids: [] };
    const selected = await driver.issueCommand({
        type: "command:scene:get-current-selected-drawdy-elements",
        driverId: driver.manifest.driverId,
        requestId: nextRequestId(),
    });
    return selected.res.error === undefined
        ? { ids: selected.res.value.drawdyElementIds }
        : { error: selected.res.error.type };
}

async function sendState(): Promise<void> {
    if (!driver) return;
    const [swatches, useForDrawing] = await Promise.all([
        readKey(SWATCHES_KEY),
        readKey(USE_FOR_DRAWING_KEY),
    ]);
    const use = useForDrawing[USE_FOR_DRAWING_KEY];
    await post({
        type: "state",
        swatches: parseSwatches(swatches[SWATCHES_KEY]),
        useForDrawing: typeof use === "boolean" ? use : true,
    });

    const selected = await selectedIds();
    await post({
        type: "selection",
        count: "ids" in selected ? selected.ids.length : 0,
    });
    if (!driver || driver.watchingSelection) return;
    const watched = await driver.issueCommand({
        type: "subscription:scene:drawdy-element-selection",
        driverId: driver.manifest.driverId,
        requestId: nextRequestId(),
    });
    if (driver && watched.res.error === undefined)
        driver.watchingSelection = true;
}

async function save(swatches: unknown, useForDrawing: unknown): Promise<void> {
    await Promise.all([
        writeKey(SWATCHES_KEY, parseSwatches(swatches)),
        ...(typeof useForDrawing === "boolean"
            ? [writeKey(USE_FOR_DRAWING_KEY, useForDrawing)]
            : []),
    ]);
}

async function setPen(hex: unknown): Promise<void> {
    if (!driver || !isHex(hex)) return;
    await driver.issueCommand({
        type: "command:tools:update-settings",
        driverId: driver.manifest.driverId,
        requestId: nextRequestId(),
        req: { settings: { strokeColor: hex.toUpperCase() } },
    });
}

async function paint(hex: unknown): Promise<void> {
    if (!driver) return;
    if (!isHex(hex)) {
        fail("bad-argument", "paint");
        return;
    }
    const selected = await selectedIds();
    if (!driver) return;
    if ("error" in selected) {
        fail(selected.error, "paint");
        return;
    }
    if (selected.ids.length === 0) {
        void post({ type: "painted", count: 0 });
        return;
    }
    const got = await driver.issueCommand({
        type: "command:scene:get-drawdy-elements",
        driverId: driver.manifest.driverId,
        requestId: nextRequestId(),
        req: { properties: PAINT_PROPERTIES, drawdyElementIds: selected.ids },
    });
    if (!driver) return;
    if (got.res.error !== undefined) {
        fail(got.res.error.type, "paint");
        return;
    }
    const updates = paintUpdates(
        got.res.value.drawdyElements,
        hex.toUpperCase()
    );
    if (updates.length === 0) {
        void post({ type: "painted", count: 0 });
        return;
    }
    const updated = await driver.issueCommand({
        type: "command:scene:update-drawdy-elements",
        driverId: driver.manifest.driverId,
        requestId: nextRequestId(),
        req: { updates },
    });
    if (!driver) return;
    if (updated.res.error !== undefined) {
        fail(updated.res.error.type, "paint");
        return;
    }
    void post({ type: "painted", count: updated.res.value.updated });
}

function boardContext() {
    const d = driver as NonNullable<typeof driver>;
    return {
        issueCommand: d.issueCommand,
        driverId: d.manifest.driverId,
        nextRequestId,
        webviewDomId: d.webviewId,
    };
}

async function inkColour(): Promise<string> {
    if (!driver) return FALLBACK_INK;
    const res = await driver.issueCommand({
        type: "command:scene:query-tool-style-state",
        driverId: driver.manifest.driverId,
        requestId: nextRequestId(),
        req: { toolId: "text" },
    });
    if (res.res.error !== undefined) return FALLBACK_INK;
    const state = res.res.value.state;
    return state && state.toolId === "text" && state.color
        ? state.color
        : FALLBACK_INK;
}

async function addPalette(swatches: unknown): Promise<void> {
    if (!driver) return;
    const hexes = parseSwatches(swatches);
    if (hexes.length === 0) {
        fail("bad-argument", "add");
        return;
    }
    const { width, height } = planPalette(hexes);
    const area = await visibleArea(boardContext());
    if (!driver) return;
    const centred = area
        ? centredIn(area, width, height)
        : { x: 0, y: 0, width, height };
    const rect = await findFreeRect(boardContext(), {
        ...centred,
        x: Math.round(centred.x),
        y: Math.round(centred.y),
    });
    const ink = await inkColour();
    if (!driver) return;
    const elements = paletteElements({
        hexes,
        origin: rect,
        ink,
        board: BOARD_COLOURS[driver.styling.theme],
        driverId: driver.manifest.driverId,
        generateId: driver.generateId,
        at: Date.now(),
    });
    const added = await driver.issueCommand({
        type: "command:scene:add-drawdy-elements",
        driverId: driver.manifest.driverId,
        requestId: nextRequestId(),
        req: { elements },
    });
    if (!driver) return;
    if (added.res.error !== undefined) {
        fail(added.res.error.type, "add");
        return;
    }
    await revealAndSelect(
        boardContext(),
        elements.map((e) => e.drawdyElementId),
        rect
    );
    void post({ type: "added" });
}
