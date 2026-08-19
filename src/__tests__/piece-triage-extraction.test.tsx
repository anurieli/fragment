import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PieceTriageBar } from "@/components/shortform/piece-triage";
import { useContentStore } from "@/stores/content-store";
import type { ContentPiece } from "@/lib/content-engine";

function extractedPiece(): ContentPiece {
  return {
    id: "p-extracted",
    ideaId: "i-1",
    format: "linkedin",
    status: "in-progress",
    origin: "user",
    reviewQueue: "extraction",
    body: "A possible thought",
    priority: 0,
    order: 1,
    seen: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("PieceTriageBar extraction review", () => {
  beforeEach(() => {
    const piece = extractedPiece();
    useContentStore.setState({ hydrated: true, pieces: { [piece.id]: piece } });
  });

  it("accepts an extracted result into active work", () => {
    render(<PieceTriageBar piece={extractedPiece()} onDismiss={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    const accepted = useContentStore.getState().pieces["p-extracted"];
    expect(accepted.reviewQueue).toBeUndefined();
    expect(accepted.status).toBe("in-progress");
  });

  it("offers the existing undoable toss path", () => {
    const onDismiss = vi.fn();
    render(<PieceTriageBar piece={extractedPiece()} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "Toss" }));

    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
