import assert from "node:assert/strict";
import { test } from "node:test";
import type { DriverManifest } from "@drawdy/driver-protocol";
import * as driver from "../src/index";
import { CELL, SQUARE_GAP, planPalette } from "../src/lib/layout";
import type { ErrorDuring, ErrorReason } from "../src/shared/messages";
import { boot, fakeHost, type FakeHost } from "./fake-host";

const manifest = {
    driverId: "mickyngub.irl-eyedropper",
    driverName: "IRL Eyedropper",
} as DriverManifest;
const DRIVER_ID = manifest.driverId;
const WEBVIEW_ID = `${DRIVER_ID}:webview`;
const VIEWPORT = { x: 100, y: -200, width: 1600, height: 1000 };
// The viewport less the drawer, which the fake host can't measure.
const AREA = { x: 100, y: -200, width: 1240, height: 1000 };

const sentOf = (host: FakeHost, type: string) =>
    host.sent.filter((s) => s.type === type);
const webcamTypes = (host: FakeHost) =>
    host.types().filter((t) => t.startsWith("command:webcam"));
const postedOf = (host: FakeHost, type: string) =>
    host.posted.filter((m) => m.type === type);

test("activation leaves the camera off, and the button opens a themed panel that is destroyed when closed", async () => {
    const host = fakeHost();
    const { click } = await boot(driver, host, manifest);
    assert.deepEqual(webcamTypes(host), []);

    await click();

    const [created] = sentOf(host, "command:webview:create");
    assert.equal(created.req.webviewDomId, WEBVIEW_ID);
    assert.equal(created.req.keepStateWhenClosed, false);
    assert.ok(!created.req.htmlContent.includes("/*__DRAWDY_STYLING__*/"));
    assert.ok(created.req.htmlContent.includes("color-scheme: light;"));
});

test("a theme change is passed to the panel as CSS variables", async () => {
    const host = fakeHost();
    const { click, theme } = await boot(driver, host, manifest);
    await click();

    await theme({ theme: "dark", tokens: { "--dd-surface-panel": "#111" } });

    assert.deepEqual(host.posted.at(-1), {
        type: "theme",
        cssVars: "color-scheme: dark;--dd-surface-panel: #111;",
    });
});

test("start asks for a 1280 by 720 front camera stream and moves its frame port into the panel", async () => {
    const host = fakeHost();
    const { message } = await boot(driver, host, manifest);

    await message({ type: "start" });

    const [started] = sentOf(host, "command:webcam:start-stream");
    assert.deepEqual(started.req, {
        constraints: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: "user",
        },
    });
    const [port] = host.ports;
    assert.deepEqual(host.posted.at(-1), { type: "started", port });
    assert.deepEqual(host.transferred.at(-1), [port]);
    assert.equal(host.holding, true);
});

test("start ends any stream the driver still holds first, so a panel that closed before its stop can start again", async () => {
    const host = fakeHost();
    const { message } = await boot(driver, host, manifest);
    await message({ type: "start" });
    host.clear();

    await message({ type: "start" });

    assert.deepEqual(webcamTypes(host), [
        "command:webcam:end-stream",
        "command:webcam:start-stream",
    ]);
    assert.deepEqual(host.posted.at(-1), {
        type: "started",
        port: host.ports[1],
    });
});

test("stop ends the stream", async () => {
    const host = fakeHost();
    const { message } = await boot(driver, host, manifest);
    await message({ type: "start" });

    await message({ type: "stop" });

    assert.equal(host.holding, false);
    assert.equal(webcamTypes(host).at(-1), "command:webcam:end-stream");
});

test("a stream whose panel is already gone is ended at once", async () => {
    const host = fakeHost({ panelGone: true });
    const { message } = await boot(driver, host, manifest);

    await message({ type: "start" });

    assert.equal(host.ports.length, 1);
    assert.equal(host.holding, false);
    assert.equal(webcamTypes(host).at(-1), "command:webcam:end-stream");
});

const CAMERA_FAILURES: {
    name: string;
    host: Parameters<typeof fakeHost>[0];
    reason: ErrorReason;
}[] = [
    {
        name: "a blocked camera",
        host: { startError: { type: "unauthorized" } },
        reason: "blocked",
    },
    {
        name: "no camera",
        host: { notAvailable: "no-camera" },
        reason: "no-camera",
    },
    {
        name: "a camera another extension holds",
        host: { notAvailable: "in-use" },
        reason: "in-use",
    },
    {
        name: "a camera that broke",
        host: { startError: { type: "runtime" } },
        reason: "failed",
    },
];

for (const failure of CAMERA_FAILURES) {
    test(`${failure.name} tells the panel ${failure.reason}`, async () => {
        const host = fakeHost(failure.host);
        const { message } = await boot(driver, host, manifest);

        await message({ type: "start" });

        assert.deepEqual(host.posted.at(-1), {
            type: "error",
            reason: failure.reason,
            during: "start",
        });
    });
}

test("ready sends the saved swatches and the Use for drawing choice", async () => {
    const host = fakeHost({
        stored: {
            swatches: { swatches: ["#FF6347", "#3a7d44"] },
            useForDrawing: { useForDrawing: false },
        },
    });
    const { message } = await boot(driver, host, manifest);

    await message({ type: "ready" });

    assert.deepEqual(postedOf(host, "state"), [
        {
            type: "state",
            swatches: ["#FF6347", "#3A7D44"],
            useForDrawing: false,
        },
    ]);
});

test("ready falls back to no swatches and drawing on when nothing is saved", async () => {
    const host = fakeHost();
    const { message } = await boot(driver, host, manifest);

    await message({ type: "ready" });

    assert.deepEqual(postedOf(host, "state"), [
        { type: "state", swatches: [], useForDrawing: true },
    ]);
});

test("ready keeps only valid hexes, at most sixteen, and ignores a choice that isn't a boolean", async () => {
    const saved = [
        "#FF0000",
        "red",
        42,
        "#12345",
        ...Array.from(
            { length: 20 },
            (_, i) => `#0000${i.toString(16).padStart(2, "0")}`
        ),
    ];
    const host = fakeHost({
        stored: {
            swatches: { swatches: saved },
            useForDrawing: { useForDrawing: "no" },
        },
    });
    const { message } = await boot(driver, host, manifest);

    await message({ type: "ready" });

    const [state] = postedOf(host, "state");
    assert.equal(state.swatches.length, 16);
    assert.equal(state.swatches[0], "#FF0000");
    assert.ok(
        state.swatches.every((hex: string) => /^#[0-9A-F]{6}$/.test(hex))
    );
    assert.equal(state.useForDrawing, true);
});

test("a board that blocks storage still gets the default state", async () => {
    const host = fakeHost({ denied: ["command:kv-storage"] });
    const { message } = await boot(driver, host, manifest);

    await message({ type: "ready" });

    assert.deepEqual(postedOf(host, "state"), [
        { type: "state", swatches: [], useForDrawing: true },
    ]);
});

test("ready sends the selection count and starts following the selection once", async () => {
    const host = fakeHost({ selected: ["a", "b", "c"] });
    const { message } = await boot(driver, host, manifest);

    await message({ type: "ready" });
    await message({ type: "ready" });

    assert.deepEqual(postedOf(host, "selection"), [
        { type: "selection", count: 3 },
        { type: "selection", count: 3 },
    ]);
    assert.equal(
        sentOf(host, "subscription:scene:drawdy-element-selection").length,
        1
    );
});

test("a selection change is passed to the panel as a count", async () => {
    const host = fakeHost();
    const { select } = await boot(driver, host, manifest);

    await select(["a", "b"]);
    await select([]);

    assert.deepEqual(postedOf(host, "selection"), [
        { type: "selection", count: 2 },
        { type: "selection", count: 0 },
    ]);
});

test("save writes the swatches and the Use for drawing choice under their keys", async () => {
    const host = fakeHost();
    const { message } = await boot(driver, host, manifest);

    await message({
        type: "save",
        swatches: ["#ff6347", "nope", "#1E90FF"],
        useForDrawing: false,
    });

    assert.deepEqual(host.kv.get("swatches"), {
        swatches: ["#FF6347", "#1E90FF"],
    });
    assert.deepEqual(host.kv.get("useForDrawing"), { useForDrawing: false });
});

test("pen sets the drawing tools' stroke colour", async () => {
    const host = fakeHost();
    const { message } = await boot(driver, host, manifest);

    await message({ type: "pen", hex: "#3a7d44" });
    await message({ type: "pen", hex: "green" });

    assert.deepEqual(
        sentOf(host, "command:tools:update-settings").map((s) => s.req),
        [{ settings: { strokeColor: "#3A7D44" } }]
    );
});

test("paint fills shapes, colours text and strokes lines in one update, and skips images and frames", async () => {
    const scene = [
        { id: "rect", type: "path", componentType: "rect", fillColor: "#fff" },
        {
            id: "triangle",
            type: "path",
            points: [
                [0, 0],
                [80, 0],
                [80, 60],
                [0, 60],
            ],
        },
        {
            id: "slice",
            type: "path",
            fillColor: "#123456",
            points: [
                [0, 0],
                [40, 0],
                [50, 20],
                [30, 40],
                [0, 30],
            ],
        },
        { id: "note", type: "text" },
        {
            id: "line",
            type: "path",
            points: [
                [0, 0],
                [100, 50],
            ],
        },
        {
            id: "elbow",
            type: "path",
            points: [
                [0, 0],
                [100, 0],
                [100, 100],
                [0, 100],
            ],
            endBinding: { drawdyElementId: "rect", anchorX: 0, anchorY: 0.5 },
        },
        { id: "ink", type: "freedraw" },
        { id: "photo", type: "image" },
        { id: "frame", type: "frame" },
        { id: "widget", type: "component" },
    ] as any[];
    const host = fakeHost({ scene, selected: scene.map((e) => e.id) });
    const { message } = await boot(driver, host, manifest);

    await message({ type: "paint", hex: "#a1b2c3" });

    const updates = sentOf(host, "command:scene:update-drawdy-elements");
    assert.equal(updates.length, 1);
    const colour = "#A1B2C3";
    assert.deepEqual(updates[0].req.updates, [
        { drawdyElementId: "rect", properties: { fillColor: colour } },
        { drawdyElementId: "triangle", properties: { fillColor: colour } },
        { drawdyElementId: "slice", properties: { fillColor: colour } },
        { drawdyElementId: "note", properties: { textColor: colour } },
        { drawdyElementId: "line", properties: { strokeColor: colour } },
        { drawdyElementId: "elbow", properties: { strokeColor: colour } },
        { drawdyElementId: "ink", properties: { strokeColor: colour } },
    ]);
    assert.equal(host.scene.get("photo")?.fillColor, undefined);
    assert.deepEqual(host.posted.at(-1), { type: "painted", count: 7 });
});

test("paint with nothing selected changes nothing and reports zero", async () => {
    const host = fakeHost();
    const { message } = await boot(driver, host, manifest);

    await message({ type: "paint", hex: "#A1B2C3" });

    assert.equal(
        sentOf(host, "command:scene:update-drawdy-elements").length,
        0
    );
    assert.deepEqual(host.posted.at(-1), { type: "painted", count: 0 });
});

test("paint with only images selected changes nothing and reports zero", async () => {
    const host = fakeHost({
        scene: [{ id: "photo", type: "image" }],
        selected: ["photo"],
    });
    const { message } = await boot(driver, host, manifest);

    await message({ type: "paint", hex: "#A1B2C3" });

    assert.equal(
        sentOf(host, "command:scene:update-drawdy-elements").length,
        0
    );
    assert.deepEqual(host.posted.at(-1), { type: "painted", count: 0 });
});

const BOARD_FAILURES: {
    name: string;
    host: Parameters<typeof fakeHost>[0];
    send: Record<string, unknown>;
    during: ErrorDuring;
    reason: ErrorReason;
}[] = [
    {
        name: "a board that blocks edits",
        host: { denied: ["command:scene"] },
        send: { type: "paint", hex: "#A1B2C3" },
        during: "paint",
        reason: "blocked",
    },
    {
        name: "a board that blocks additions",
        host: { denied: ["command:scene:add"] },
        send: { type: "add", swatches: ["#A1B2C3"] },
        during: "add",
        reason: "blocked",
    },
    {
        name: "a board that rejects the palette",
        host: { addError: { type: "bad-argument" } },
        send: { type: "add", swatches: ["#A1B2C3"] },
        during: "add",
        reason: "failed",
    },
    {
        name: "an add without valid swatches",
        host: {},
        send: { type: "add", swatches: ["nope"] },
        during: "add",
        reason: "failed",
    },
];

for (const failure of BOARD_FAILURES) {
    test(`${failure.name} tells the panel ${failure.reason} during ${failure.during}`, async () => {
        const host = fakeHost(failure.host);
        const { message } = await boot(driver, host, manifest);

        await message(failure.send);

        assert.deepEqual(host.posted.at(-1), {
            type: "error",
            reason: failure.reason,
            during: failure.during,
        });
    });
}

test("add places one labelled, grouped cell per swatch in the middle of the view, selects them and tells the panel", async () => {
    const host = fakeHost({ viewport: VIEWPORT, textInk: "#222222" });
    const { message } = await boot(driver, host, manifest);
    const swatches = ["#FF6347", "#3A7D44", "#1E90FF"];

    await message({ type: "add", swatches });

    const adds = sentOf(host, "command:scene:add-drawdy-elements");
    assert.equal(adds.length, 1);
    const elements = adds[0].req.elements;
    const cells = elements.filter((e: any) => e.type === "shape");
    const names = elements.filter((e: any) => e.type === "text");
    assert.deepEqual(
        cells.map((c: any) => [c.fillColor, c.text]),
        swatches.map((hex) => [hex, hex])
    );
    assert.equal(names.length, 3);
    assert.equal(names[0].text, "tomato");
    assert.ok(names.every((n: any) => n.color === "#222222"));

    const plan = planPalette(swatches);
    const x = Math.round(AREA.x + (AREA.width - plan.width) / 2);
    const y = Math.round(AREA.y + (AREA.height - plan.height) / 2);
    assert.deepEqual(
        cells.map((c: any) => [c.x, c.y, c.width, c.height]),
        [0, 1, 2].map((i) => [x + i * (CELL + SQUARE_GAP), y, CELL, CELL])
    );

    assert.equal(new Set(elements.map((e: any) => e.groupId)).size, 1);
    assert.ok(elements[0].groupId);
    for (const e of elements) {
        assert.equal(typeof e.meta[DRIVER_ID].at, "number");
    }
    const [selection] = sentOf(host, "command:scene:set-selection");
    assert.deepEqual(
        selection.req.drawdyElementIds,
        elements.map((e: any) => e.drawdyElementId)
    );
    assert.equal(sentOf(host, "command:camera:fly-to-rect").length, 0);
    assert.deepEqual(host.posted.at(-1), { type: "added" });
});

test("a palette of more than six swatches wraps onto a second row", async () => {
    const host = fakeHost({ viewport: VIEWPORT });
    const { message } = await boot(driver, host, manifest);
    const swatches = [
        "#FF0000",
        "#00FF00",
        "#0000FF",
        "#FFFF00",
        "#00FFFF",
        "#FF00FF",
        "#808080",
        "#000000",
    ];

    await message({ type: "add", swatches });

    const [add] = sentOf(host, "command:scene:add-drawdy-elements");
    const cells = add.req.elements.filter((e: any) => e.type === "shape");
    assert.equal(cells.length, 8);
    assert.equal(cells[6].x, cells[0].x);
    assert.equal(cells[7].x, cells[1].x);
    assert.ok(cells[6].y > cells[0].y + CELL);
    assert.equal(cells[5].x + CELL - cells[0].x, planPalette(swatches).width);
});

test("a second palette lands beside the first instead of on top of it", async () => {
    const host = fakeHost({ viewport: VIEWPORT });
    const { message } = await boot(driver, host, manifest);

    await message({ type: "add", swatches: ["#FF6347"] });
    await message({ type: "add", swatches: ["#FF6347"] });

    const [first, second] = sentOf(
        host,
        "command:scene:add-drawdy-elements"
    ).map((add) => add.req.elements[0]);
    assert.equal(second.y, first.y);
    assert.ok(second.x > first.x + CELL);
});

test("a swatch that matches the board gets a neutral outline so it stays visible", async () => {
    const host = fakeHost({ viewport: VIEWPORT });
    const { message } = await boot(driver, host, manifest);

    await message({ type: "add", swatches: ["#F4F4F5", "#1E90FF"] });

    const [add] = sentOf(host, "command:scene:add-drawdy-elements");
    const [board, blue] = add.req.elements;
    assert.equal(board.strokeColor, "#A1A1AA");
    assert.equal(blue.strokeColor, "#1E90FF");
});
