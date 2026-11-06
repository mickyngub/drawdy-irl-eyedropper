import type {
    DrawdyWebviewApi,
    WebcamFrameMessage,
    WebcamFramePort,
} from "@drawdy/driver-protocol";
import { nearestCssName } from "../src/shared/css-names";
import type {
    DriverToWebview,
    ErrorDuring,
    ErrorReason,
    WebviewToDriver,
} from "../src/shared/messages";
import { parseSwatches } from "../src/shared/swatches";
import { SWATCH } from "./lib/classes";
import { FrameBuffer } from "./lib/frame-buffer";
import {
    PATCH_RADIUS,
    addSwatch,
    sampleColour,
    toSourcePoint,
    tooDarkForWhite,
    whiteGains,
    type Linear,
    type Point,
} from "./lib/sample";

declare function acquireDrawdyApi(): DrawdyWebviewApi;

type PanelState = "starting" | "live" | ErrorReason;

const ANALYSIS = { width: 640, height: 360 };
const ASPECT = ANALYSIS.width / ANALYSIS.height;
const LOUPE_MS = 100;
const STATUS_MS = 4000;
const REPLY_TIMEOUT_MS = 30_000;

const COPY: Record<
    Exclude<PanelState, "live">,
    { title: string; body: string; retry: boolean }
> = {
    starting: { title: "Starting camera…", body: "", retry: false },
    blocked: {
        title: "Camera blocked",
        body: "Allow the camera in your browser's site settings and in Manage permissions.",
        retry: true,
    },
    "no-camera": {
        title: "No camera found",
        body: "Connect a camera and try again.",
        retry: true,
    },
    "in-use": {
        title: "Camera in use",
        body: "Another extension or app is using it. Close that and try again.",
        retry: true,
    },
    ended: {
        title: "The camera stopped",
        body: "It was unplugged, turned off or its permission was taken back.",
        retry: true,
    },
    failed: {
        title: "Something went wrong",
        body: "The camera couldn't start.",
        retry: true,
    },
};
const NO_CANVAS = "This browser couldn't set up the preview.";
const NOTHING_TO_PAINT = "Nothing in the selection takes a colour";
const ADDED = "Palette added";
const NEEDS_BOARD_PERMISSION =
    "IRL Eyedropper needs permission to change the board. Reload the page and click Allow.";
const NOT_PAINTED = "Couldn't paint the selection. Try again.";
const NOT_ADDED = "The board couldn't take the palette. Try again.";
const NO_REPLY = "The board didn't answer. Try again.";
const TOO_DARK = "Too dark for white. Try more light.";

const painted = (count: number): string =>
    count === 1 ? "Painted 1 item" : `Painted ${count} items`;

const api = acquireDrawdyApi();
const byId = <T extends HTMLElement>(id: string) =>
    document.getElementById(id) as T;

const panel = byId<HTMLElement>("panel");
const stylingEl = byId<HTMLStyleElement>("drawdy-styling");
const previewCanvas = byId<HTMLCanvasElement>("preview");
const reticleEl = byId<HTMLDivElement>("reticle");
const overlayTitle = byId<HTMLSpanElement>("overlay-title");
const overlayBody = byId<HTMLSpanElement>("overlay-body");
const retryButton = byId<HTMLButtonElement>("retry");
const mirrorButton = byId<HTMLButtonElement>("mirror");
const loupeEl = byId<HTMLDivElement>("loupe");
const loupeHex = byId<HTMLSpanElement>("loupe-hex");
const loupeName = byId<HTMLSpanElement>("loupe-name");
const setWhiteButton = byId<HTMLButtonElement>("set-white");
const resetWhiteButton = byId<HTMLButtonElement>("reset-white");
const swatchesEl = byId<HTMLDivElement>("swatches");
const swatchesEmpty = byId<HTMLParagraphElement>("swatches-empty");
const clearButton = byId<HTMLButtonElement>("clear");
const useForDrawingBox = byId<HTMLInputElement>("use-for-drawing");
const paintButton = byId<HTMLButtonElement>("paint");
const addButton = byId<HTMLButtonElement>("add");
const statusEl = byId<HTMLParagraphElement>("status");
const pickButton = byId<HTMLButtonElement>("pick");

const previewCtx = previewCanvas.getContext("2d");
const analysis = document.createElement("canvas");
analysis.width = ANALYSIS.width;
analysis.height = ANALYSIS.height;
const analysisCtx = analysis.getContext("2d", { willReadFrequently: true });

const frames = new FrameBuffer<WebcamFrameMessage>();

let state: PanelState = "starting";
let port: WebcamFramePort | null = null;
let canRetry = true;
let mirror = true;
let reticle: Point = { x: 0.5, y: 0.5 };
let gains: Linear | undefined;
let swatches: string[] = [];
let current: string | null = null;
let useForDrawing = true;
let selectionCount = 0;
let busy = false;
let fresh = false;
let lastLoupe = 0;
let statusTimer: ReturnType<typeof setTimeout> | undefined;
let replyTimer: ReturnType<typeof setTimeout> | undefined;

const post = (message: WebviewToDriver): void => api.postMessage(message);

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function clearStatus(): void {
    clearTimeout(statusTimer);
    statusEl.textContent = "";
}

function showStatus(text: string): void {
    clearTimeout(statusTimer);
    statusEl.textContent = text;
    statusTimer = setTimeout(clearStatus, STATUS_MS);
}

function updateButtons(): void {
    const live = state === "live";
    pickButton.disabled = !live;
    setWhiteButton.disabled = !live;
    paintButton.disabled = busy || selectionCount === 0 || current === null;
    addButton.disabled = busy || swatches.length === 0;
}

function setBusy(next: boolean): void {
    busy = next;
    clearTimeout(replyTimer);
    if (next)
        replyTimer = setTimeout(() => {
            setBusy(false);
            showStatus(NO_REPLY);
        }, REPLY_TIMEOUT_MS);
    updateButtons();
}

function setState(next: PanelState, body?: string): void {
    state = next;
    panel.dataset.state = next;
    if (next !== "live") {
        if (next !== "starting") frames.clear();
        const copy = COPY[next];
        overlayTitle.textContent = copy.title;
        overlayBody.textContent = body ?? copy.body;
        retryButton.hidden = !copy.retry || !canRetry;
    }
    updateButtons();
}

function placeReticle(): void {
    reticleEl.style.setProperty("--rx", `${reticle.x * 100}%`);
    reticleEl.style.setProperty("--ry", `${reticle.y * 100}%`);
    reticleEl.dataset.x = reticle.x.toFixed(3);
    reticleEl.dataset.y = reticle.y.toFixed(3);
}

function sampleAt(point: Point, withGains: boolean) {
    const p = toSourcePoint(point, mirror, ANALYSIS.width, ANALYSIS.height);
    const x = Math.max(0, p.x - PATCH_RADIUS);
    const y = Math.max(0, p.y - PATCH_RADIUS);
    const width = Math.min(ANALYSIS.width, p.x + PATCH_RADIUS + 1) - x;
    const height = Math.min(ANALYSIS.height, p.y + PATCH_RADIUS + 1) - y;
    const { data } = analysisCtx!.getImageData(x, y, width, height);
    return sampleColour(
        data,
        width,
        height,
        { x: p.x - x, y: p.y - y },
        withGains ? gains : undefined
    );
}

function updateLoupe(): void {
    if (state !== "live") return;
    const { hex } = sampleAt(reticle, true);
    loupeEl.dataset.hex = hex;
    loupeEl.style.setProperty("--loupe", hex);
    loupeHex.textContent = hex;
    loupeName.textContent = nearestCssName(hex).name;
}

const describe = (hex: string): string => `${hex}, ${nearestCssName(hex).name}`;

function markCurrent(): void {
    for (const button of swatchesEl.querySelectorAll<HTMLButtonElement>(
        "[data-hex]"
    )) {
        button.setAttribute(
            "aria-pressed",
            String(button.dataset.hex === current)
        );
    }
    updateButtons();
}

function renderSwatches(): void {
    swatchesEl.replaceChildren(
        ...swatches.map((hex) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = SWATCH;
            button.dataset.hex = hex;
            button.style.setProperty("--swatch", hex);
            button.setAttribute("aria-label", describe(hex));
            button.title = describe(hex);
            button.addEventListener("click", () => useColour(hex));
            return button;
        })
    );
    swatchesEmpty.hidden = swatches.length > 0;
    clearButton.hidden = swatches.length === 0;
    markCurrent();
}

function save(): void {
    post({ type: "save", swatches, useForDrawing });
}

function useColour(hex: string): void {
    current = hex;
    markCurrent();
    if (useForDrawing) post({ type: "pen", hex });
}

function pick(): void {
    if (state !== "live") return;
    const { hex } = sampleAt(reticle, true);
    swatches = addSwatch(swatches, hex);
    renderSwatches();
    save();
    // A near match keeps the swatch already saved, so pen and swatch agree.
    useColour(swatches[0]);
}

function setWhite(): void {
    if (state !== "live") return;
    const { linear } = sampleAt(reticle, false);
    if (tooDarkForWhite(linear)) {
        showStatus(TOO_DARK);
        return;
    }
    if (statusEl.textContent === TOO_DARK) clearStatus();
    gains = whiteGains(linear);
    panel.dataset.white = "set";
    updateLoupe();
    resetWhiteButton.focus();
}

function resetWhite(): void {
    gains = undefined;
    panel.dataset.white = "unset";
    if (statusEl.textContent === TOO_DARK) clearStatus();
    updateLoupe();
    setWhiteButton.focus();
}

function crop(width: number, height: number) {
    if (width / height > ASPECT) {
        const sw = height * ASPECT;
        return { sx: (width - sw) / 2, sy: 0, sw, sh: height };
    }
    const sh = width / ASPECT;
    return { sx: 0, sy: (height - sh) / 2, sw: width, sh };
}

function draw(frame: VideoFrame): void {
    const { sx, sy, sw, sh } = crop(frame.displayWidth, frame.displayHeight);
    const { width, height } = previewCanvas;
    previewCtx!.setTransform(mirror ? -1 : 1, 0, 0, 1, mirror ? width : 0, 0);
    previewCtx!.drawImage(frame, sx, sy, sw, sh, 0, 0, width, height);
    analysisCtx!.drawImage(
        frame,
        sx,
        sy,
        sw,
        sh,
        0,
        0,
        ANALYSIS.width,
        ANALYSIS.height
    );
}

function loop(now: number): void {
    requestAnimationFrame(loop);
    const latest = frames.take();
    if (latest) {
        const frame = new VideoFrame(latest.frameData, latest.init);
        try {
            draw(frame);
        } finally {
            frame.close();
        }
        fresh = true;
        if (state === "starting") setState("live");
    }
    if (!fresh || now - lastLoupe < LOUPE_MS) return;
    fresh = false;
    lastLoupe = now;
    updateLoupe();
}

function measurePreview(): void {
    const dpr = window.devicePixelRatio || 1;
    previewCanvas.width = Math.round(previewCanvas.clientWidth * dpr);
    previewCanvas.height = Math.round(previewCanvas.clientHeight * dpr);
}

function closePort(): void {
    if (!port) return;
    port.onmessage = null;
    port.close();
    port = null;
    frames.clear();
}

function startCamera(): void {
    closePort();
    setState("starting");
    post({ type: "start" });
}

function onStarted(next: WebcamFramePort): void {
    closePort();
    port = next;
    next.onmessage = ({ data }) => {
        if (data.type === "frame") {
            frames.offer(data);
            return;
        }
        closePort();
        setState("ended");
    };
}

function onError(reason: ErrorReason, during: ErrorDuring): void {
    if (during === "start") {
        setState(reason);
        return;
    }
    setBusy(false);
    showStatus(
        reason === "blocked"
            ? NEEDS_BOARD_PERMISSION
            : during === "paint"
              ? NOT_PAINTED
              : NOT_ADDED
    );
}

function handle(message: DriverToWebview): void {
    switch (message.type) {
        case "theme": {
            stylingEl.textContent = `:root{${message.cssVars}}`;
            return;
        }
        case "started": {
            onStarted(message.port);
            return;
        }
        case "error": {
            onError(message.reason, message.during);
            return;
        }
        case "state": {
            swatches = parseSwatches(message.swatches);
            useForDrawing = message.useForDrawing !== false;
            useForDrawingBox.checked = useForDrawing;
            renderSwatches();
            return;
        }
        case "selection": {
            selectionCount = Math.max(0, message.count);
            panel.dataset.selectionCount = String(selectionCount);
            updateButtons();
            return;
        }
        case "painted": {
            setBusy(false);
            showStatus(
                message.count > 0 ? painted(message.count) : NOTHING_TO_PAINT
            );
            return;
        }
        case "added": {
            setBusy(false);
            showStatus(ADDED);
            return;
        }
    }
}

previewCanvas.addEventListener("click", (event) => {
    if (state !== "live") return;
    const box = previewCanvas.getBoundingClientRect();
    reticle = {
        x: clamp01((event.clientX - box.left) / box.width),
        y: clamp01((event.clientY - box.top) / box.height),
    };
    placeReticle();
    pick();
    updateLoupe();
});

mirrorButton.addEventListener("click", () => {
    mirror = !mirror;
    mirrorButton.setAttribute("aria-pressed", String(mirror));
    reticle = { ...reticle, x: 1 - reticle.x };
    placeReticle();
});

setWhiteButton.addEventListener("click", setWhite);
resetWhiteButton.addEventListener("click", resetWhite);

clearButton.addEventListener("click", () => {
    swatches = [];
    renderSwatches();
    save();
    pickButton.focus();
});

useForDrawingBox.addEventListener("change", () => {
    useForDrawing = useForDrawingBox.checked;
    save();
});

paintButton.addEventListener("click", () => {
    if (current === null) return;
    setBusy(true);
    post({ type: "paint", hex: current });
});

addButton.addEventListener("click", () => {
    if (swatches.length === 0) return;
    setBusy(true);
    post({ type: "add", swatches });
});

pickButton.addEventListener("click", pick);
retryButton.addEventListener("click", startCamera);

document.addEventListener("keydown", (event) => {
    if (event.key !== " " && event.key !== "Enter") return;
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as Element | null;
    if (target?.closest("button, input, select, textarea, a[href]")) return;
    event.preventDefault();
    pick();
});

// Drawdy keeps the camera on after the panel closes until the driver ends the stream, including one still starting.
window.addEventListener("pagehide", () => post({ type: "stop" }));

api.onMessage((raw) => {
    if (!raw || typeof raw !== "object") return;
    handle(raw as DriverToWebview);
});

placeReticle();
renderSwatches();
post({ type: "ready" });

if (previewCtx && analysisCtx) {
    new ResizeObserver(measurePreview).observe(previewCanvas);
    requestAnimationFrame(loop);
    startCamera();
} else {
    canRetry = false;
    setState("failed", NO_CANVAS);
}
