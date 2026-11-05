import type { WebcamFramePort } from "@drawdy/driver-protocol";

export type ErrorReason =
    "blocked" | "no-camera" | "in-use" | "ended" | "failed";

export type ErrorDuring = "start" | "paint" | "add";

export type WebviewToDriver =
    | { type: "start" }
    | { type: "stop" }
    | { type: "ready" }
    | { type: "save"; swatches: string[]; useForDrawing: boolean }
    | { type: "pen"; hex: string }
    | { type: "paint"; hex: string }
    | { type: "add"; swatches: string[] };

export type DriverToWebview =
    | { type: "theme"; cssVars: string }
    | { type: "started"; port: WebcamFramePort }
    | { type: "error"; reason: ErrorReason; during: ErrorDuring }
    | { type: "state"; swatches: string[]; useForDrawing: boolean }
    | { type: "selection"; count: number }
    | { type: "painted"; count: number }
    | { type: "added" };
