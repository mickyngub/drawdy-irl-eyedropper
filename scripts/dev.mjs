import { execFileSync, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD_CSS = join(ROOT, "scripts", "build-css.mjs");

execFileSync(process.execPath, [BUILD_CSS], { cwd: ROOT, stdio: "inherit" });

const css = spawn(process.execPath, [BUILD_CSS, "--watch"], {
    cwd: ROOT,
    stdio: ["ignore", "inherit", "inherit"],
});
const vite = spawn(join(ROOT, "node_modules", ".bin", "vite"), [], {
    cwd: ROOT,
    stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
        css.kill(signal);
        vite.kill(signal);
    });
}

vite.on("exit", (code) => {
    css.kill("SIGTERM");
    process.exit(code ?? 1);
});
