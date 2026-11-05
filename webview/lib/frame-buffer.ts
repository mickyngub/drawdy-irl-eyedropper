// Keeps only the newest frame: the preview draws it once, the shutter develops it.
export class FrameBuffer<F> {
    private newest: F | null = null;
    private fresh = false;

    get latest(): F | null {
        return this.newest;
    }

    offer(frame: F): void {
        this.newest = frame;
        this.fresh = true;
    }

    take(): F | null {
        if (!this.fresh) return null;
        this.fresh = false;
        return this.newest;
    }

    clear(): void {
        this.newest = null;
        this.fresh = false;
    }
}
