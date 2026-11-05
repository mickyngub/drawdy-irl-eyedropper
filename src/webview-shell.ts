import {
    CHECKBOX,
    ICON_BUTTON,
    LABEL_ROW,
    PRIMARY,
    SCROLL_BODY,
    SECONDARY,
    SECTION,
    TEXT_ACTION,
} from "../webview/lib/classes";
import { ICONS, icon } from "../webview/lib/icons";
import { PANEL_CSS } from "./panel-css";

const BODY = `
<main id="panel" class="group/panel flex h-full min-h-0 flex-col bg-panel font-sans text-body text-fg antialiased" data-state="starting" data-white="unset" data-selection-count="0">
    <div class="${SCROLL_BODY}">
        <section class="${SECTION}">
            <div class="${LABEL_ROW}">
                <span>Camera</span>
                <button type="button" id="mirror" class="${ICON_BUTTON} -my-1.5 -mr-2" aria-pressed="true" aria-label="Mirror" title="Mirror">${icon(ICONS.mirror)}</button>
            </div>
            <div class="relative grid aspect-video w-full place-items-center overflow-hidden rounded-xl bg-section">
                <canvas id="preview" class="block size-full cursor-crosshair" role="img" aria-label="Camera preview. Click a spot to pick its colour."></canvas>
                <div id="reticle" class="pointer-events-none absolute top-(--ry) left-(--rx) hidden size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.6)] group-data-[state=live]/panel:block" aria-hidden="true"></div>
                <div class="absolute inset-0 flex flex-col items-center justify-center gap-1 overflow-y-auto bg-section p-3 text-center group-data-[state=live]/panel:hidden">
                    ${icon(ICONS.cameraOff, "mb-1 size-5 shrink-0 text-fg-subtle group-data-[state=starting]/panel:hidden")}
                    <span id="overlay-title" class="text-label text-fg"></span>
                    <span id="overlay-body" class="max-w-64 text-body text-fg-subtle empty:hidden"></span>
                    <button type="button" id="retry" class="${SECONDARY} mt-1 shrink-0" hidden>Try again</button>
                </div>
            </div>
            <div class="flex items-center gap-3">
                <div id="loupe" class="size-10 shrink-0 rounded-lg bg-[var(--loupe,var(--color-section))] ring-1 ring-line-strong"></div>
                <div class="flex min-w-0 flex-col">
                    <span id="loupe-hex" class="font-mono text-label text-fg"></span>
                    <span id="loupe-name" class="truncate text-body text-fg-subtle"></span>
                </div>
            </div>
        </section>
        <section class="${SECTION}">
            <div class="${LABEL_ROW}">
                <span>White balance</span>
                <span class="hidden items-center gap-2 text-fg-subtle group-data-[white=set]/panel:inline-flex">White set<button type="button" id="reset-white" class="${TEXT_ACTION}">Reset</button></span>
            </div>
            <div class="flex items-center gap-3">
                <p class="min-w-0 flex-1 text-body text-fg-subtle">Hold white paper under the ring, then set white.</p>
                <button type="button" id="set-white" class="${SECONDARY} shrink-0" disabled>Set white</button>
            </div>
            <p id="too-dark" class="rounded-lg bg-warning/15 px-3 py-2 text-body text-fg" hidden>Too dark for white. Try more light.</p>
        </section>
        <section class="${SECTION}">
            <div class="${LABEL_ROW}">
                <span id="swatches-label">Swatches</span>
                <button type="button" id="clear" class="${TEXT_ACTION}" hidden>Clear</button>
            </div>
            <div id="swatches" role="group" aria-labelledby="swatches-label" class="flex flex-wrap gap-2 empty:hidden"></div>
            <p id="swatches-empty" class="text-body text-fg-subtle">Pick a colour and it lands here.</p>
        </section>
        <section class="${SECTION}">
            <div class="${LABEL_ROW}"><span>Use it</span></div>
            <label class="inline-flex cursor-pointer items-center gap-2 self-start text-label text-fg-muted select-none"><span class="grid place-items-center"><input type="checkbox" id="use-for-drawing" class="${CHECKBOX}" checked /><svg class="pointer-events-none invisible col-start-1 row-start-1 size-3 text-on-accent peer-checked:visible" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${ICONS.tick}"/></svg></span>Use for drawing</label>
            <div class="grid grid-cols-2 gap-2">
                <button type="button" id="paint" class="${SECONDARY}" disabled>${icon(ICONS.paint)}Paint selection</button>
                <button type="button" id="add" class="${SECONDARY}" disabled>${icon(ICONS.palette)}Add to board</button>
            </div>
        </section>
    </div>
    <footer class="flex shrink-0 flex-col border-t border-divider px-4 py-3">
        <p id="status" class="text-body text-fg-subtle not-empty:mb-2" aria-live="polite"></p>
        <button type="button" id="pick" class="${PRIMARY} w-full" disabled>${icon(ICONS.sip)}Pick colour</button>
    </footer>
</main>
`;

export function shellHtml(js: string): string {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource-variable/google-sans-flex@5.3.2/wght.css" />
<style id="drawdy-styling">:root{/*__DRAWDY_STYLING__*/}</style>
<style>${PANEL_CSS}</style>
</head>
<body class="flex h-screen flex-col overflow-hidden bg-panel font-sans text-body text-fg antialiased">
${BODY}
<script>${js}</script>
</body>
</html>`;
}
