import type {
    DriverCommandIssuer,
    DriverManifest,
    DriverModule,
    SubscribedDrawdyElement,
} from "@drawdy/driver-protocol";
import { overlaps, type Rect } from "../src/lib/free-spot";

const rectOf = (el: Stored): Rect => ({
    x: el.x as number,
    y: el.y as number,
    width: el.width as number,
    height: el.height as number,
});

export type Stored = Record<string, unknown> & {
    drawdyElementId: string;
    type: string;
};

type HostError = { type: string; message?: string };

type Options = {
    viewport?: Rect;
    denied?: string[];
    startError?: HostError;
    notAvailable?: "no-camera" | "in-use";
    panelGone?: boolean;
    addError?: HostError;
    stored?: Record<string, Record<string, unknown>>;
    scene?: SubscribedDrawdyElement[];
    selected?: string[];
    textInk?: string;
};

type Sent = { type: string; req?: any };

type Port = { stream: number };

export function fakeHost(options: Options = {}) {
    const viewport = options.viewport ?? {
        x: 0,
        y: 0,
        width: 1600,
        height: 1000,
    };
    const sent: Sent[] = [];
    const posted: any[] = [];
    const transferred: unknown[][] = [];
    const elements = new Map<string, Stored>();
    const ports: Port[] = [];
    const kv = new Map(Object.entries(options.stored ?? {}));
    const scene = new Map(
        (options.scene ?? []).map((el) => [el.id, { ...el }])
    );
    let ids = 0;
    let holding = false;

    const issueCommand = (async (cmd: any) => {
        sent.push({ type: cmd.type, req: cmd.req });
        const ok = (value?: unknown) => ({ ...cmd, res: { value } });
        const fail = ({ type, message }: HostError) => ({
            ...cmd,
            res: { error: { type, message } },
        });
        if (options.denied?.some((prefix) => cmd.type.startsWith(prefix))) {
            return fail({ type: "unauthorized" });
        }
        switch (cmd.type) {
            case "command:webview:post-message":
                posted.push(cmd.req.message);
                transferred.push(cmd.req.transfer ?? []);
                return ok({ posted: !options.panelGone });
            case "command:camera:get-viewport-rect":
                return ok({ rect: viewport });
            case "command:camera:get-info":
                return ok({ zoom: 1 });
            case "command:dom:element-rect":
                return fail({ type: "not-found" });
            case "command:scene:query-rect":
                return ok({
                    drawdyElements: [...elements.values()]
                        .filter((el) => overlaps(rectOf(el), cmd.req.rect))
                        .map((el) => ({
                            id: el.drawdyElementId,
                            type: el.type,
                        })),
                });
            case "command:scene:element-rects":
                return ok({
                    rects: (cmd.req.drawdyElementIds as string[]).flatMap(
                        (id) => {
                            const el = elements.get(id);
                            return el
                                ? [{ drawdyElementId: id, rect: rectOf(el) }]
                                : [];
                        }
                    ),
                });
            case "command:webcam:start-stream": {
                if (options.startError) return fail(options.startError);
                if (options.notAvailable)
                    return ok({ notAvailableReason: options.notAvailable });
                if (holding) return ok({ notAvailableReason: "in-use" });
                holding = true;
                const port = { stream: ports.length + 1 };
                ports.push(port);
                return ok({ port });
            }
            case "command:webcam:end-stream":
                holding = false;
                return ok();
            case "command:kv-storage:get":
                return ok(
                    kv.has(cmd.req.key) ? { got: kv.get(cmd.req.key) } : {}
                );
            case "command:kv-storage:set":
                kv.set(cmd.req.key, cmd.req.payload);
                return ok();
            case "command:scene:get-current-selected-drawdy-elements":
                return ok({ drawdyElementIds: options.selected ?? [] });
            case "command:scene:get-drawdy-elements":
                return ok({
                    drawdyElements: (cmd.req.drawdyElementIds as string[])
                        .filter((id) => scene.has(id))
                        .map((id) => scene.get(id)),
                });
            case "command:scene:update-drawdy-elements": {
                const updates = (
                    cmd.req.updates as {
                        drawdyElementId: string;
                        properties: Record<string, unknown>;
                    }[]
                ).filter((u) => scene.has(u.drawdyElementId));
                for (const { drawdyElementId, properties } of updates) {
                    Object.assign(scene.get(drawdyElementId)!, properties);
                }
                return ok({ updated: updates.length });
            }
            case "command:scene:query-tool-style-state":
                return ok({
                    state: options.textInk
                        ? {
                              toolId: "text",
                              fontSize: 24,
                              color: options.textInk,
                          }
                        : null,
                });
            case "subscription:scene:drawdy-element-selection":
                return ok({ subscriptionId: "selection" });
            case "command:scene:add-drawdy-elements":
                if (options.addError) return fail(options.addError);
                for (const el of cmd.req.elements as Stored[]) {
                    elements.set(el.drawdyElementId, { ...el });
                }
                return ok();
            default:
                return ok({});
        }
    }) as unknown as DriverCommandIssuer;

    return {
        issueCommand,
        sent,
        posted,
        transferred,
        elements,
        ports,
        kv,
        scene,
        nextId: () => `el-${++ids}`,
        get holding() {
            return holding;
        },
        types: () => sent.map((s) => s.type),
        clear() {
            sent.length = 0;
            posted.length = 0;
            transferred.length = 0;
        },
    };
}

export type FakeHost = ReturnType<typeof fakeHost>;

export async function boot(
    module: DriverModule,
    host: FakeHost,
    manifest: DriverManifest
) {
    await module.activate({
        manifest,
        issueCommand: host.issueCommand,
        styling: { theme: "light" } as any,
        generateId: host.nextId,
    });
    const click = () =>
        module.onEvent({
            type: "subscription:dom:element-clicked",
            body: { domElementId: `${manifest.driverId}:action-button` },
        } as any);
    const message = (body: Record<string, unknown>) =>
        module.onEvent({
            type: "subscription:webview:message",
            body: {
                webviewDomId: `${manifest.driverId}:webview`,
                message: body,
            },
        } as any);
    const theme = (styling: Record<string, unknown>) =>
        module.onEvent({
            type: "subscription:dom:theme-changed",
            body: { styling },
        } as any);
    const select = (drawdyElementIds: string[]) =>
        module.onEvent({
            type: "subscription:scene:drawdy-element-selection",
            subscriptionId: "selection",
            body: { drawdyElementIds },
        } as any);
    return { click, message, theme, select };
}
