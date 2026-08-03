import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { dropPoint } from "@tiptap/pm/transform";

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

export interface MovedTextSelection {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface TextareaSelectionRange {
  start: number;
  end: number;
}

export type SelectionDragDestination = "snip-bar" | "source" | "outside";

function sourceOffsetAtTextareaOffset(value: string, textareaOffset: number): number | null {
  if (textareaOffset < 0) return null;

  let sourceOffset = 0;
  let normalizedOffset = 0;
  while (sourceOffset < value.length && normalizedOffset < textareaOffset) {
    if (value[sourceOffset] === "\r" && value[sourceOffset + 1] === "\n") {
      sourceOffset += 2;
    } else {
      sourceOffset += 1;
    }
    normalizedOffset += 1;
  }
  return normalizedOffset === textareaOffset ? sourceOffset : null;
}

function textareaLength(value: string): number {
  return value.replace(/\r\n/g, "\n").length;
}

/**
 * Maps the LF-normalized offsets exposed by a textarea back to the source
 * string. Browsers expose every CRLF as one character, while persisted piece
 * bodies retain both source characters.
 */
export function textareaSelectionRange(
  value: string,
  start: number,
  end: number,
): TextareaSelectionRange | null {
  if (start < 0 || start >= end) return null;
  const sourceStart = sourceOffsetAtTextareaOffset(value, start);
  const sourceEnd = sourceOffsetAtTextareaOffset(value, end);
  if (sourceStart === null || sourceEnd === null) return null;
  return { start: sourceStart, end: sourceEnd };
}

/** Classifies a selection drag from the actual element hit at the pointer. */
export function selectionDragDestination(
  source: Element,
  snipBar: Element | null,
  hit: Element | null,
): SelectionDragDestination {
  if (snipBar && (hit === snipBar || snipBar.contains(hit))) return "snip-bar";
  if (hit === source || source.contains(hit)) return "source";
  return "outside";
}

/**
 * Moves [start, end) to the character boundary where it was dropped.
 *
 * `dropOffset` belongs to the original value, so a forward move has to map it
 * through the source deletion before inserting. Nothing is synthesized or
 * trimmed: markdown markers, spaces, and newlines move exactly as selected.
 */
export function moveTextSelection(
  value: string,
  start: number,
  end: number,
  dropOffset: number,
): MovedTextSelection | null {
  if (start < 0 || end > value.length || start >= end) return null;
  if (dropOffset < 0 || dropOffset > value.length) return null;
  if (dropOffset >= start && dropOffset <= end) return null;

  const selected = value.slice(start, end);
  const withoutSelection = value.slice(0, start) + value.slice(end);
  const insertAt = dropOffset > end ? dropOffset - selected.length : dropOffset;
  return {
    value:
      withoutSelection.slice(0, insertAt) +
      selected +
      withoutSelection.slice(insertAt),
    selectionStart: insertAt,
    selectionEnd: insertAt + selected.length,
  };
}

/**
 * Moves a textarea selection while preserving persisted line endings.
 * Returns null when the current value changed after mousedown so a stale drag
 * cannot overwrite newer content.
 */
export function moveTextareaSelection(
  currentValue: string,
  dragStartValue: string,
  start: number,
  end: number,
  dropOffset: number,
): MovedTextSelection | null {
  if (currentValue !== dragStartValue) return null;

  const source = textareaSelectionRange(currentValue, start, end);
  const sourceDrop = sourceOffsetAtTextareaOffset(currentValue, dropOffset);
  if (!source || sourceDrop === null) return null;

  const moved = moveTextSelection(currentValue, source.start, source.end, sourceDrop);
  if (!moved) return null;

  const selected = currentValue.slice(source.start, source.end);
  const normalizedSelectionLength = textareaLength(selected);
  const normalizedSelectionStart = textareaLength(moved.value.slice(0, moved.selectionStart));
  return {
    value: moved.value,
    selectionStart: normalizedSelectionStart,
    selectionEnd: normalizedSelectionStart + normalizedSelectionLength,
  };
}

/**
 * Builds one ProseMirror transaction that moves a selected slice in-place.
 * Using a Slice rather than textBetween preserves marks and block structure;
 * the transaction mapping accounts for the source deletion on forward drops.
 */
export function moveEditorSelection(
  state: EditorState,
  range: { from: number; to: number },
  dropPos: number,
  dragStartDoc: ProseMirrorNode = state.doc,
): Transaction | null {
  if (!state.doc.eq(dragStartDoc)) return null;
  const { from, to } = range;
  const docSize = state.doc.content.size;
  if (from < 0 || to > docSize || from >= to) return null;
  if (dropPos < 0 || dropPos > docSize) return null;
  if (dropPos >= from && dropPos <= to) return null;

  // Match ProseMirror's native drag path: retain the selected nodes' parent
  // context and find a schema-valid insertion point before deleting source.
  const slice = state.doc.slice(from, to, true);
  const insertPos = dropPoint(state.doc, dropPos, slice) ?? dropPos;
  const tr = state.tr.delete(from, to);
  const insertAt = tr.mapping.map(insertPos);
  const beforeInsert = tr.doc;
  tr.replaceRange(insertAt, insertAt, slice);
  if (tr.doc.eq(beforeInsert)) return null;

  // Keep the moved content selected, as native editor drag-and-drop does.
  let selectionEnd = tr.mapping.map(insertPos);
  tr.mapping.maps[tr.mapping.maps.length - 1]?.forEach(
    (_from, _to, _newFrom, newTo) => {
      selectionEnd = newTo;
    },
  );
  return tr
    .setSelection(TextSelection.between(tr.doc.resolve(insertAt), tr.doc.resolve(selectionEnd)))
    .setMeta("uiEvent", "drop");
}

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
