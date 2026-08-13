/**
 * The stacking order, in one place.
 *
 * Everything that floats over the app used to pick its own z-index and its own
 * positioning, which meant a menu was only ever above the things its author
 * happened to think of. A right-click menu on an idea near the bottom of the
 * sidebar was clipped by the sidebar's own scroller; a tooltip in the pieces
 * panel was cut off by the editor beside it.
 *
 * The rule now: anything transient that points at something else (menu,
 * tooltip, popover) renders through `Portal` at `Z_FLOATING`, above every
 * panel, overlay and modal in the app. It is transient, it is closed by the
 * next click or scroll, and it is worthless if it cannot be read.
 *
 * These are class-name strings rather than numbers because Tailwind scans this
 * file for them. Keep them literal.
 */

/** Panels anchored inside the layout: the helper bar, the peeked sidebar. */
export const Z_PANEL = "z-30";

/** Modals, dialogs and full-screen overlays. */
export const Z_OVERLAY = "z-50";

/** Catches the click that dismisses a floating element. Just under it. */
export const Z_FLOATING_BACKDROP = "z-[69]";

/** Menus, tooltips and popovers. The top of the app. */
export const Z_FLOATING = "z-[70]";
