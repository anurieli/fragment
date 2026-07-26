/**
 * Where a textarea's selection actually sits on screen.
 *
 * A textarea gives you character offsets and nothing else: no Range, no
 * client rects, no way to ask "is this pixel inside the highlighted text?".
 * Dragging a selection out of one therefore needs a stand-in that *does* have
 * DOM geometry — and the short-form piece editor already has an exact one.
 * LiveMarkdownTextarea paints a mirror div behind the textarea whose text is
 * character-for-character the same string, laid out with the same metrics in
 * the same grid cell, precisely so the caret lands on the glyphs. That makes
 * the mirror a faithful ruler for the textarea's own selection.
 */

/** Builds a DOM Range over [start, end) of `root`'s text content. */
export function rangeForOffsets(root: Node, start: number, end: number): Range | null {
  if (typeof document === "undefined" || end <= start) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  let offset = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  let node = walker.nextNode() as Text | null;
  while (node) {
    const len = node.data.length;
    if (!startNode && offset + len > start) {
      startNode = node;
      startOffset = start - offset;
    }
    if (offset + len >= end) {
      endNode = node;
      endOffset = end - offset;
      break;
    }
    offset += len;
    node = walker.nextNode() as Text | null;
  }

  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, Math.max(0, Math.min(startOffset, startNode.data.length)));
  range.setEnd(endNode, Math.max(0, Math.min(endOffset, endNode.data.length)));
  return range;
}

/** Is (x, y) — client coordinates — on top of any line of this range? */
export function pointInRange(range: Range, x: number, y: number): boolean {
  const rects = range.getClientRects();
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (r.width === 0 && r.height === 0) continue;
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  return false;
}

/**
 * The character offset under (x, y), read off the mirror — the inverse of
 * rangeForOffsets.
 *
 * Needed because taking over mousedown to start a drag also takes over the
 * click that lands inside a selection, and that click's whole job is to put
 * the caret where you pointed. Returns null when the point isn't over text.
 */
export function offsetAtPoint(
  mirror: HTMLElement | null,
  x: number,
  y: number,
  textarea?: HTMLTextAreaElement | null,
): number | null {
  if (!mirror || typeof document === "undefined") return null;

  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  // Both caret APIs go through hit testing, and hit testing lands on the
  // textarea — which answers with its own element, not a character offset.
  // Swapping which of the two layers is hittable for the duration of the call
  // asks the question of the mirror instead. Synchronous: nothing paints in
  // between, so there is nothing to see.
  const mirrorPointerEvents = mirror.style.pointerEvents;
  const textareaPointerEvents = textarea?.style.pointerEvents;
  mirror.style.pointerEvents = "auto";
  if (textarea) textarea.style.pointerEvents = "none";

  let node: Node | null = null;
  let nodeOffset = 0;
  try {
    if (typeof doc.caretPositionFromPoint === "function") {
      const pos = doc.caretPositionFromPoint(x, y);
      if (pos) {
        node = pos.offsetNode;
        nodeOffset = pos.offset;
      }
    }
    if (!node && typeof doc.caretRangeFromPoint === "function") {
      const range = doc.caretRangeFromPoint(x, y);
      if (range) {
        node = range.startContainer;
        nodeOffset = range.startOffset;
      }
    }
  } finally {
    mirror.style.pointerEvents = mirrorPointerEvents;
    if (textarea) textarea.style.pointerEvents = textareaPointerEvents ?? "";
  }

  if (!node || !mirror.contains(node)) return null;

  const walker = document.createTreeWalker(mirror, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let current = walker.nextNode() as Text | null;
  while (current) {
    if (current === node) return offset + Math.min(nodeOffset, current.data.length);
    offset += current.data.length;
    current = walker.nextNode() as Text | null;
  }
  return null;
}

/**
 * Is the pointer inside the textarea's current selection, measured against
 * `mirror` (an element whose text and metrics match the textarea's)?
 */
export function pointInTextareaSelection(
  textarea: HTMLTextAreaElement,
  mirror: HTMLElement | null,
  x: number,
  y: number,
): boolean {
  const { selectionStart, selectionEnd } = textarea;
  if (selectionStart === selectionEnd) return false;
  if (!mirror) return false;
  const range = rangeForOffsets(mirror, selectionStart, selectionEnd);
  if (!range) return false;
  return pointInRange(range, x, y);
}
