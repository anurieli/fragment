import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { SlashNodeView } from "@/components/editor/slash-node-view";

/**
 * Tiptap atom-block extension that renders the slash-command UI as a real
 * document node.  Because it lives in the ProseMirror document flow it
 * naturally pushes surrounding content up and down instead of overlapping it.
 *
 * The `replacedEmpty` attribute tells the NodeView whether it was inserted by
 * replacing an empty paragraph (true) or before a non-empty one (false), so
 * the dismiss action can restore the right state.
 */
export const SlashBlockExtension = Node.create({
  name: "slashBlock",
  group: "block",
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      replacedEmpty: {
        default: true,
      },
    };
  },

  parseHTML() {
    return [];
  },

  renderHTML() {
    return ["div", { "data-slash-block": "" }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SlashNodeView);
  },
});
