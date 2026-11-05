export const FOCUS =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export const SCROLL_BODY =
    "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-3 pb-4 [scrollbar-width:thin] [scrollbar-color:var(--color-line-strong)_transparent]";

export const SECTION = "flex flex-col gap-2";

export const LABEL_ROW =
    "flex items-center justify-between text-label text-fg-muted";

export const PRIMARY = `inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-accent px-3 text-label-md text-on-accent transition-colors hover:bg-accent-hover active:bg-accent-pressed disabled:cursor-not-allowed disabled:bg-disabled disabled:text-fg-disabled ${FOCUS} focus-visible:ring-offset-2 focus-visible:ring-offset-panel`;

export const SECONDARY = `inline-flex h-7.5 cursor-pointer items-center justify-center gap-1 rounded-lg border border-line bg-subtle px-2.5 text-label text-fg-muted transition-colors hover:bg-hover hover:text-fg active:bg-pressed disabled:cursor-not-allowed disabled:text-fg-disabled disabled:hover:bg-subtle ${FOCUS}`;

export const ICON_BUTTON = `inline-grid size-7.5 cursor-pointer place-items-center rounded-lg text-fg-muted transition-colors hover:bg-hover hover:text-fg active:bg-pressed aria-pressed:bg-control aria-pressed:text-fg ${FOCUS}`;

export const TEXT_ACTION = `cursor-pointer rounded-sm text-label text-fg-subtle transition-colors hover:text-fg ${FOCUS}`;

export const SWATCH = `size-7 cursor-pointer rounded-full bg-(--swatch) ring-1 ring-line-strong aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-fg ${FOCUS}`;

export const CHECKBOX = `peer col-start-1 row-start-1 m-0 size-4 cursor-pointer appearance-none rounded-sm border border-line-strong transition-colors checked:border-transparent checked:bg-accent-pressed ${FOCUS}`;
