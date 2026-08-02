import { closeHistory } from "@tiptap/pm/history";
import type { Node, Schema } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import {
  Step,
  StepMap,
  StepResult,
  type Mappable,
} from "@tiptap/pm/transform";
import type { Snippet } from "@/lib/types";

export type SnippetMovementDirection = "to-editor" | "to-snip-bar";

export interface SnippetMovement {
  direction: SnippetMovementDirection;
  snippet: Snippet;
}

export interface SnippetMovementEffect {
  action: "remove" | "restore";
  snippet: Snippet;
}

/**
 * A no-op document step carrying the persisted half of a snippet movement.
 *
 * ProseMirror stores and inverts steps inside the same event as the text edit,
 * so this marker survives grouping, the history depth cap, undo, and redo. The
 * snippet store remains outside the document; editor.tsx applies the effect
 * exposed by the inverted or replayed marker when a history transaction runs.
 */
export class SnippetMovementStep extends Step {
  constructor(
    readonly movement: SnippetMovement,
    readonly reversed = false,
  ) {
    super();
  }

  apply(doc: Node): StepResult {
    return StepResult.ok(doc);
  }

  getMap(): StepMap {
    return StepMap.empty;
  }

  invert(_doc: Node): Step {
    return new SnippetMovementStep(this.movement, !this.reversed);
  }

  map(_mapping: Mappable): Step | null {
    return this;
  }

  toJSON() {
    return {
      stepType: "fragmentSnippetMovement",
      movement: this.movement,
      reversed: this.reversed,
    };
  }

  static fromJSON(_schema: Schema, json: { movement: SnippetMovement; reversed?: boolean }): Step {
    return new SnippetMovementStep(json.movement, json.reversed ?? false);
  }
}

export function addSnippetMovementToHistory(
  transaction: Transaction,
  movement: SnippetMovement,
): Transaction {
  closeHistory(transaction);
  transaction.step(new SnippetMovementStep({
    ...movement,
    snippet: { ...movement.snippet },
  }));
  return transaction;
}

export function snippetMovementEffects(
  steps: readonly Step[],
): SnippetMovementEffect[] {
  return steps.flatMap((step) => {
    if (!(step instanceof SnippetMovementStep)) return [];

    const { movement, reversed } = step;
    const action = movement.direction === "to-snip-bar"
      ? reversed ? "remove" : "restore"
      : reversed ? "restore" : "remove";
    return [{ action, snippet: movement.snippet }];
  });
}