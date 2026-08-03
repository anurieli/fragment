import { describe, expect, it } from "vitest";
import { calculateInlineMenuPosition } from "@/lib/inline-menu-placement";

describe("calculateInlineMenuPosition", () => {
  it("translates viewport coordinates into scrolled editor coordinates", () => {
    expect(calculateInlineMenuPosition({
      selection: { top: 300, right: 500, bottom: 324, left: 400 },
      container: { top: 100, right: 900, bottom: 700, left: 100 },
      scrollTop: 600,
      scrollLeft: 0,
      menu: { width: 280, height: 40 },
      viewport: { width: 1000, height: 800 },
    })).toEqual({
      top: 752,
      left: 210,
      side: "top",
    });
  });

  it("flips below a selection that is too close to the visible top edge", () => {
    expect(calculateInlineMenuPosition({
      selection: { top: 110, right: 500, bottom: 130, left: 400 },
      container: { top: 100, right: 900, bottom: 700, left: 100 },
      scrollTop: 0,
      scrollLeft: 0,
      menu: { width: 280, height: 40 },
      viewport: { width: 1000, height: 800 },
    })).toEqual({
      top: 38,
      left: 210,
      side: "bottom",
    });
  });

  it("clamps the toolbar inside the visible horizontal editor bounds", () => {
    expect(calculateInlineMenuPosition({
      selection: { top: 300, right: 115, bottom: 324, left: 105 },
      container: { top: 100, right: 900, bottom: 700, left: 100 },
      scrollTop: 0,
      scrollLeft: 0,
      menu: { width: 280, height: 40 },
      viewport: { width: 1000, height: 800 },
    })).toEqual({
      top: 152,
      left: 0,
      side: "top",
    });
  });

  it("hides when the selected text has scrolled outside the visible editor", () => {
    expect(calculateInlineMenuPosition({
      selection: { top: 20, right: 500, bottom: 40, left: 400 },
      container: { top: 100, right: 900, bottom: 700, left: 100 },
      scrollTop: 600,
      scrollLeft: 0,
      menu: { width: 280, height: 40 },
      viewport: { width: 1000, height: 800 },
    })).toBeNull();
  });

  it("clamps vertically when neither side has enough room", () => {
    expect(calculateInlineMenuPosition({
      selection: { top: 130, right: 500, bottom: 150, left: 400 },
      container: { top: 100, right: 900, bottom: 180, left: 100 },
      scrollTop: 0,
      scrollLeft: 0,
      menu: { width: 280, height: 40 },
      viewport: { width: 1000, height: 800 },
    })).toEqual({
      top: 0,
      left: 210,
      side: "top",
    });
  });
});
