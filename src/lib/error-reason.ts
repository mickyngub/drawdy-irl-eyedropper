import type { ProtocolCommandError } from "@drawdy/driver-protocol";
import type { ErrorReason } from "../shared/messages";

export function errorReason(type: ProtocolCommandError["type"]): ErrorReason {
    return type === "unauthorized" ? "blocked" : "failed";
}
