import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PriorityFlagPicker } from "@/components/shortform/piece-priority-picker";

describe("PriorityFlagPicker", () => {
  afterEach(cleanup);

  it("shows every colored flag without a nested priority dropdown", () => {
    render(<PriorityFlagPicker priority={3} onSelect={vi.fn()} />);

    expect(screen.getByText("Priority")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Priority" })).toBeInTheDocument();

    const noPriority = screen.getByRole("button", { name: "No priority" });
    const low = screen.getByRole("button", { name: "Low" });
    const medium = screen.getByRole("button", { name: "Medium" });
    const high = screen.getByRole("button", { name: "High" });
    const urgent = screen.getByRole("button", { name: "Urgent" });

    expect(noPriority).toHaveClass("text-text-faint");
    expect(low).toHaveClass("text-yellow-400");
    expect(medium).toHaveClass("text-orange-400");
    expect(high).toHaveClass("text-red/75");
    expect(urgent).toHaveClass("text-red");
    expect(medium).toHaveAttribute("aria-pressed", "true");
  });

  it("selects a priority in one click", () => {
    const onSelect = vi.fn();
    render(<PriorityFlagPicker priority={0} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "Urgent" }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("does not present a false current value for mixed bulk priorities", () => {
    render(<PriorityFlagPicker priority={null} onSelect={vi.fn()} hint="All selected ideas" />);

    expect(screen.getByText("All selected ideas")).toBeInTheDocument();
    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveAttribute("aria-pressed", "false");
    }
  });
});
