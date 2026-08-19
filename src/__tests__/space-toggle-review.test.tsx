import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SpaceToggle } from "@/components/shortform/space-toggle";
import { useContentStore } from "@/stores/content-store";

describe("SpaceToggle extraction review isolation", () => {
  beforeEach(() => {
    useContentStore.setState({ hydrated: true, ideas: {}, pieces: {} });
  });

  it("does not present unreviewed extraction as unseen active work", () => {
    const store = useContentStore.getState();
    const ideaId = store.createIdea({ title: "Idea" });
    store.createPiece({
      ideaId,
      format: "linkedin",
      origin: "user",
      status: "in-progress",
      reviewQueue: "extraction",
      body: "review me",
    });

    render(<SpaceToggle ideaId={ideaId} />);

    expect(screen.getByRole("button", { name: "Pieces" }).querySelector(".bg-gold")).toBeNull();
  });

  it("still presents unseen external Inbox work", () => {
    const store = useContentStore.getState();
    const ideaId = store.createIdea({ title: "Idea" });
    store.createPiece({
      ideaId,
      format: "linkedin",
      origin: "agent",
      status: "inbox",
      body: "external work",
    });

    render(<SpaceToggle ideaId={ideaId} />);

    expect(screen.getByRole("button", { name: "Pieces" }).querySelector(".bg-gold")).not.toBeNull();
  });
});
