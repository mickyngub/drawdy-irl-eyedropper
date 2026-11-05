import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHex } from "../src/shared/colour";
import {
    addSwatch,
    deltaE76,
    sampleColour,
    toSourcePoint,
    tooDarkForWhite,
    whiteGains,
} from "../webview/lib/sample";

type Rgb = [number, number, number];

function frame(
    width: number,
    height: number,
    pixel: (x: number, y: number) => Rgb
) {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            rgba.set([...pixel(x, y), 255], i);
        }
    }
    return rgba;
}

const rgbOf = (hex: string): Rgb => {
    const { r, g, b } = parseHex(hex)!;
    return [r, g, b];
};

test("a uniform patch returns its own colour", () => {
    const rgba = frame(32, 32, () => [58, 125, 68]);

    const { hex } = sampleColour(rgba, 32, 32, { x: 16, y: 16 });

    assert.equal(hex, "#3A7D44");
});

test("glints and shadows in the patch leave the base colour", () => {
    const base: Rgb = [58, 125, 68];
    let n = 0;
    const rgba = frame(13, 13, () => {
        const i = n++;
        if (i % 7 === 0) return [255, 255, 255];
        if (i % 7 === 3) return [0, 0, 0];
        return base;
    });

    const { hex } = sampleColour(rgba, 13, 13, { x: 6, y: 6 });

    assert.equal(hex, "#3A7D44");
});

test("gains from a bluish white make that white neutral", () => {
    const rgba = frame(16, 16, () => [205, 220, 250]);
    const { linear } = sampleColour(rgba, 16, 16, { x: 8, y: 8 });

    const gains = whiteGains(linear);
    const corrected = rgbOf(
        sampleColour(rgba, 16, 16, { x: 8, y: 8 }, gains).hex
    );

    assert.equal(tooDarkForWhite(linear), false);
    assert.ok(
        Math.max(...corrected) - Math.min(...corrected) <= 1,
        `${corrected} is not neutral`
    );
});

test("white gains stay between half and double", () => {
    assert.deepEqual(
        whiteGains([0.1, 0.5, 0.9]).map((g) => +g.toFixed(3)),
        [2, 1, 0.556]
    );
    assert.deepEqual(
        whiteGains([0.9, 0.1, 0.1]).map((g) => +g.toFixed(3)),
        [0.5, 2, 2]
    );
    assert.deepEqual(
        whiteGains([0, 0.4, 0.4]).map((g) => +g.toFixed(3)),
        [2, 0.667, 0.667]
    );
});

test("a dim grey is too dark to set as white", () => {
    const rgba = frame(16, 16, () => [90, 90, 90]);

    const { linear } = sampleColour(rgba, 16, 16, { x: 8, y: 8 });

    assert.equal(tooDarkForWhite(linear), true);
});

test("the hex is upper case and padded to six digits", () => {
    const rgba = frame(16, 16, () => [1, 10, 171]);

    const { hex } = sampleColour(rgba, 16, 16, { x: 8, y: 8 });

    assert.equal(hex, "#010AAB");
});

test("the patch stops at the frame edges", () => {
    const rgba = frame(32, 32, (x, y) =>
        x < 7 && y < 7 ? [200, 40, 40] : [40, 40, 200]
    );

    assert.equal(sampleColour(rgba, 32, 32, { x: 0, y: 0 }).hex, "#C82828");
    assert.equal(sampleColour(rgba, 32, 32, { x: 31, y: 31 }).hex, "#2828C8");
});

test("a point on the mirrored preview maps to the other side of the frame", () => {
    assert.deepEqual(toSourcePoint({ x: 0.25, y: 0.5 }, true, 640, 360), {
        x: 480,
        y: 180,
    });
    assert.deepEqual(toSourcePoint({ x: 0.25, y: 0.5 }, false, 640, 360), {
        x: 160,
        y: 180,
    });
    assert.deepEqual(toSourcePoint({ x: 0, y: 1 }, true, 640, 360), {
        x: 639,
        y: 359,
    });
});

test("a colour within delta E 3 of a swatch moves that swatch to the front", () => {
    const list = ["#112233", "#FF0000", "#00AA00"];
    assert.ok(deltaE76("#FF0000", "#FE0101") < 3);

    assert.deepEqual(addSwatch(list, "#FE0101"), [
        "#FF0000",
        "#112233",
        "#00AA00",
    ]);
});

test("a distinct colour is added at the front", () => {
    assert.deepEqual(addSwatch(["#FF0000"], "#0000FF"), ["#0000FF", "#FF0000"]);
});

test("the swatches keep the newest sixteen", () => {
    let list: string[] = [];
    const greys = Array.from({ length: 20 }, (_, i) => {
        const part = (i * 13).toString(16).padStart(2, "0").toUpperCase();
        return `#${part}${part}${part}`;
    });

    for (const hex of greys) list = addSwatch(list, hex);

    assert.equal(list.length, 16);
    assert.deepEqual(list.slice(0, 2), [greys[19], greys[18]]);
    assert.ok(!list.includes(greys[0]));
});
