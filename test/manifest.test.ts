import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// Drawdy's marketplace refuses a submission whose manifest breaks its schema,
// and its build lane fails one over these limits or with imports it cannot
// resolve, so the repository is held to the same rules before it is submitted.
const ROOT = new URL("..", import.meta.url).pathname;
const read = (path: string) => readFileSync(join(ROOT, path));
const manifest = JSON.parse(read("manifest.json").toString("utf8"));
const LIMITS = {
    id: 100,
    name: 100,
    description: 500,
    icon: 256 * 1024,
    readme: 200 * 1024,
    changelog: 200 * 1024,
};
const IMPORTABLE = ["@drawdy/driver-protocol"];
// The keyword must be followed by whitespace or "(" so that string data such
// as Lucide's icon name "import" is not read as an import.
const IMPORT_SPECIFIER = /(?:\bfrom|\bimport)(?:\s+|\s*\(\s*)["']([^"']+)["']/g;
const importedSpecifiers = (code: string): string[] =>
    [...code.matchAll(IMPORT_SPECIFIER)].map(([, specifier]) => specifier);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

test("the manifest passes Drawdy's submission schema", () => {
    assert.match(
        manifest.driverId,
        /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/
    );
    assert.ok(manifest.driverId.length <= LIMITS.id);
    assert.ok(
        manifest.driverName.length >= 1 &&
            manifest.driverName.length <= LIMITS.name
    );
    assert.match(
        manifest.driverVersion,
        /^\d+\.\d+\.\d+$/,
        "driverVersion is not plain semver"
    );
    assert.ok(
        manifest.description.length <= LIMITS.description,
        `the description is ${manifest.description.length} characters; Drawdy takes ${LIMITS.description}`
    );
    assert.match(
        manifest.icon,
        /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[A-Za-z0-9._/-]+\.(png|webp|svg)$/i
    );
    assert.match(manifest.main, /^[A-Za-z0-9._-]+\.js$/);
});

test("the listing files fit Drawdy's limits and the changelog has this version", () => {
    const icon = read(manifest.icon);
    assert.ok(
        icon.length <= LIMITS.icon,
        `the icon is ${icon.length} bytes; Drawdy takes ${LIMITS.icon}`
    );
    if (manifest.icon.endsWith(".png"))
        assert.deepEqual(
            [...icon.subarray(0, 8)],
            PNG_SIGNATURE,
            "the icon is not a PNG"
        );
    if (manifest.icon.endsWith(".svg"))
        assert.match(
            icon.toString("utf8"),
            /^<svg[\s>]/,
            "the icon is not an SVG"
        );
    assert.ok(
        read("README.md").length <= LIMITS.readme,
        "README.md is over Drawdy's listing limit"
    );
    const changelog = read("CHANGELOG.md");
    assert.ok(
        changelog.length <= LIMITS.changelog,
        "CHANGELOG.md is over Drawdy's listing limit"
    );
    assert.match(
        changelog.toString("utf8"),
        new RegExp(
            `^## ${manifest.driverVersion.replaceAll(".", "\\.")}$`,
            "m"
        ),
        `CHANGELOG.md has no section for ${manifest.driverVersion}`
    );
});

test("the manifest asks for the panel, the board, the camera and storage", () => {
    assert.deepEqual([...manifest.permissions].sort(), [
        "dom",
        "scene",
        "storage",
        "webcam",
    ]);
});

test("the entry exists and imports nothing Drawdy's build cannot resolve", () => {
    assert.ok(
        existsSync(join(ROOT, "src", "index.ts")),
        "src/index.ts is missing"
    );
    const sources = (dir: string): string[] =>
        readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
            e.isDirectory()
                ? sources(join(dir, e.name))
                : /\.(ts|js)$/.test(e.name)
                  ? [join(dir, e.name)]
                  : []
        );
    for (const file of sources("src")) {
        for (const specifier of importedSpecifiers(
            read(file).toString("utf8")
        )) {
            if (specifier.startsWith(".")) continue;
            assert.ok(
                IMPORTABLE.includes(specifier),
                `${file} imports ${specifier}, which Drawdy's build cannot resolve`
            );
        }
    }
});

test("the import scan reads every import form and skips the word inside a string", () => {
    for (const code of [
        `import x from "lodash";`,
        `import "lodash";`,
        `export { a } from "lodash";`,
        `await import("lodash")`,
    ]) {
        assert.deepEqual(importedSpecifiers(code), ["lodash"], code);
    }
    assert.deepEqual(importedSpecifiers(`icons: ["import", "inbox"]`), []);
});
