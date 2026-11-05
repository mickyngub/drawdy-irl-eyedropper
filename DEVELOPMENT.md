# Developing IRL Eyedropper

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm dev             # Tailwind watcher plus the dev server on :5222; in Drawdy run ⌘K → "Add extension dev server" on a local board
pnpm build           # regenerates src/panel-css.ts, src/webview-html.ts and dist/*.drawdyx
pnpm preflight       # before submitting: committed, built, pushed, under Drawdy's limits, above the live version
```

Drawdy runs the camera, not the panel: webviews are sandboxed frames without an origin, where browsers refuse the camera. On load the panel sends `ready` and `start`. On `start` the driver calls `command:webcam:end-stream`, since a panel that closed before its `stop` arrived still holds the camera, then `command:webcam:start-stream` for a 1280×720 front camera, and moves the frame `MessagePort` it gets into the panel with `command:webview:post-message`. Drawdy keeps the camera on until the driver ends the stream, so the panel sends `stop` on `pagehide`.

The panel rebuilds each frame on that port as a `VideoFrame`, draws it to the preview canvas (mirrored by default) and, unmirrored, to a 640×360 analysis canvas. Colours come from a 13×13 patch around the ring in `webview/lib/sample.ts`: converted to linear light, the darkest and brightest 20% dropped as shadows and glints, the rest averaged, then multiplied by the white gains from **Set white**. Swatches within CIE76 ΔE 3 of each other are folded together.

On `ready` the driver reads `swatches` and `useForDrawing` from `command:kv-storage:get`, sends them as `state`, sends the selection count and subscribes to `subscription:scene:drawdy-element-selection`. `save` writes both keys. `pen` calls `command:tools:update-settings` with `strokeColor`; Drawdy puts the previous tool settings back when the extension is removed. `paint` reads the selected elements and sends one `command:scene:update-drawdy-elements`, which Drawdy records as one undo step: closed shapes get `fillColor`, text gets `textColor`, lines and drawings get `strokeColor`, and images, frames and components are skipped. Drawdy names only rect, circle, diamond and sticky-note shapes, so `src/lib/paint.ts` tells other closed shapes from lines by their four corner points. `add` lays the swatches out in rows of six with `src/lib/layout.ts`, adapted from Palette Extractor, groups them, places them at a free spot in view and selects them.

This needs a `@drawdy/driver-protocol` release and a Drawdy build with the `webcam` commands; until then `package.json` points at the protocol in Drawdy's main checkout, so run `pnpm build` there and `pnpm install` here after it changes.

Drawdy builds published versions from this repository's `src/index.ts` and runs no build step, so commit the generated `src/panel-css.ts` and `src/webview-html.ts` after `pnpm build`. Bump `driverVersion` in `manifest.json` for every release and add it to `CHANGELOG.md`. `pnpm test` holds the manifest and listing files to Drawdy's submission rules, and tests the driver against a fake host plus the sampling, white balance and swatch rules the panel uses.
