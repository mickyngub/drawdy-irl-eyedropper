import type {
    SubscribeableKey,
    SubscribedDrawdyElement,
    UpdateableProperties,
} from "@drawdy/driver-protocol";

export const PAINT_PROPERTIES: SubscribeableKey[] = [
    "type",
    "componentType",
    "fillColor",
    "startBinding",
    "endBinding",
    "points",
];

const EPSILON = 0.5;

function isCornerBox(points: [number, number][] | undefined): boolean {
    if (points?.length !== 4) return false;
    const [a, b, c, d] = points;
    const closes =
        Math.abs(a[0] + c[0] - b[0] - d[0]) < EPSILON &&
        Math.abs(a[1] + c[1] - b[1] - d[1]) < EPSILON;
    const area = Math.abs(
        (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0])
    );
    return closes && area > EPSILON;
}

const hasFill = (colour: string | undefined): boolean =>
    !!colour && colour !== "transparent" && colour !== "none";

// The host names only rect, circle, diamond and sticky-note shapes. Other closed
// shapes, such as triangles, store their four bounding corners (a parallelogram
// once rotated), which tells them apart from lines.
export function isClosedShape(element: SubscribedDrawdyElement): boolean {
    if (element.type !== "path") return false;
    if (element.componentType) return true;
    if (element.startBinding || element.endBinding) return false;
    return isCornerBox(element.points) || hasFill(element.fillColor);
}

export function paintProperties(
    element: SubscribedDrawdyElement,
    hex: string
): UpdateableProperties | null {
    switch (element.type) {
        case "text":
            return { textColor: hex };
        case "freedraw":
            return { strokeColor: hex };
        case "path":
            return isClosedShape(element)
                ? { fillColor: hex }
                : { strokeColor: hex };
        default:
            return null;
    }
}

export function paintUpdates(
    elements: SubscribedDrawdyElement[],
    hex: string
): { drawdyElementId: string; properties: UpdateableProperties }[] {
    return elements.flatMap((element) => {
        const properties = paintProperties(element, hex);
        return properties ? [{ drawdyElementId: element.id, properties }] : [];
    });
}
