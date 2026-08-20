import { test, expect, type Page } from "@playwright/test";

/**
 * Fresh library, no welcome screen. Same preamble as ideas.spec.ts, and for
 * the same reason: a first-run install covers the app with a `fixed inset-0`
 * layer and every click below would land on it.
 */
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("fragment:onboardingComplete", "true");
    const dbs = indexedDB.databases ? indexedDB.databases() : Promise.resolve([]);
    return dbs.then((databases: IDBDatabaseInfo[]) =>
      Promise.all(databases.map((db: IDBDatabaseInfo) => {
        if (db.name) indexedDB.deleteDatabase(db.name);
      })),
    );
  });
  await page.reload();
  await page.waitForFunction(
    () => !document.body.textContent?.includes("Loading..."),
    { timeout: 10000 },
  );
});

async function ensureSidebarOpen(page: Page) {
  if (await page.getByRole("button", { name: "Collapse sidebar" }).isVisible()) return;
  await page.keyboard.press("Control+\\");
  await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();
}

/** Ideas named, so what a selection acted on can be read back by title. */
async function makeIdea(page: Page, title: string) {
  await ensureSidebarOpen(page);
  await page.getByRole("button", { name: "New idea" }).click();
  // Selecting the new idea drops the sidebar to its rail and takes the rename
  // box with it, so pin the panel back and name the idea there.
  await ensureSidebarOpen(page);
  const rename = page.getByPlaceholder("Name this idea…");
  await rename.fill(title);
  await rename.press("Enter");
  await page.waitForTimeout(250);
}

function ideaRows(page: Page) {
  return page.locator("[data-sidebar] .overflow-y-auto div[role='button']");
}

test.describe("Sidebar bulk actions", () => {
  test("⌘-click ticks rows, and Delete all removes exactly those", async ({ page }) => {
    await makeIdea(page, "Alpha");
    await makeIdea(page, "Beta");
    await makeIdea(page, "Gamma");
    await ensureSidebarOpen(page);

    const rows = ideaRows(page);
    await expect(rows).toHaveCount(3);

    await rows.nth(0).click({ modifiers: ["ControlOrMeta"] });
    await rows.nth(1).click({ modifiers: ["ControlOrMeta"] });
    await expect(page.getByText("2 selected")).toBeVisible();

    await page.getByRole("button", { name: "Actions" }).click();
    await page.getByText("Delete all", { exact: true }).click();
    await page.waitForTimeout(300);

    await expect(rows).toHaveCount(1);
    // The bar goes with the selection it described.
    await expect(page.getByText("2 selected")).toHaveCount(0);
  });

  test("shift-click takes the range between two rows", async ({ page }) => {
    await makeIdea(page, "One");
    await makeIdea(page, "Two");
    await makeIdea(page, "Three");
    await ensureSidebarOpen(page);

    const rows = ideaRows(page);
    await rows.nth(0).click({ modifiers: ["ControlOrMeta"] });
    await rows.nth(2).click({ modifiers: ["Shift"] });

    await expect(page.getByText("3 selected")).toBeVisible();
  });

  test("Escape clears a selection without touching the ideas", async ({ page }) => {
    await makeIdea(page, "Kept");
    await makeIdea(page, "Also kept");
    await ensureSidebarOpen(page);

    const rows = ideaRows(page);
    await rows.nth(0).click({ modifiers: ["ControlOrMeta"] });
    await expect(page.getByText("1 selected")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByText("1 selected")).toHaveCount(0);
    await expect(rows).toHaveCount(2);
  });

  test("Group under a new idea nests the selection one level down", async ({ page }) => {
    await makeIdea(page, "First");
    await makeIdea(page, "Second");
    await ensureSidebarOpen(page);

    const rows = ideaRows(page);
    await rows.nth(0).click({ modifiers: ["ControlOrMeta"] });
    await rows.nth(1).click({ modifiers: ["ControlOrMeta"] });
    await expect(page.getByText("2 selected")).toBeVisible();

    await page.getByRole("button", { name: "Actions" }).click();
    await page.getByText("Group under a new idea", { exact: true }).click();
    // Grouping opens the new parent for naming, the way a new idea does.
    await ensureSidebarOpen(page);
    const rename = page.getByPlaceholder("Name this idea…");
    await rename.fill("The group");
    await rename.press("Enter");
    await page.waitForTimeout(400);

    // One root row plus its two children, all still on screen.
    await expect(rows).toHaveCount(3);
    // Scoped to the sidebar: the idea panel and the empty editor both echo the
    // name, so a bare text match would pass on any of the three.
    await expect(rows.filter({ hasText: "The group" })).toHaveCount(1);

    const parents = await page.evaluate(() => {
      return new Promise<Array<string | null>>((resolve) => {
        const req = indexedDB.open("fragment");
        req.onsuccess = () => {
          const tx = req.result.transaction("ideas", "readonly");
          const all = tx.objectStore("ideas").getAll();
          all.onsuccess = () =>
            resolve(all.result.map((idea: { parentId: string | null }) => idea.parentId));
          all.onerror = () => resolve([]);
        };
        req.onerror = () => resolve([]);
      });
    });
    // The group idea at the top, the two ideas under it.
    expect(parents.filter((p) => p === null)).toHaveLength(1);
    expect(parents.filter((p) => p !== null)).toHaveLength(2);
  });
});

test.describe("Menus escape the sidebar", () => {
  /**
   * The regression this exists for: the idea row menu used to be positioned
   * inside the sidebar's own scroll container, so on any idea far enough down
   * the list it was sliced off at the sidebar's footer and Delete could not be
   * reached at all.
   */
  test("a row menu near the bottom is not clipped by the sidebar", async ({ page }) => {
    // Enough ideas that the last row sits low in the column.
    for (const name of ["A", "B", "C", "D", "E", "F", "G", "H"]) {
      await makeIdea(page, name);
    }
    await ensureSidebarOpen(page);

    const rows = ideaRows(page);
    // Settle the list first: these menus close on scroll (they point at a row,
    // and a row that has moved is the wrong row), so right-clicking while
    // Playwright's scroll-into-view is still running closes the menu at once.
    await rows.last().scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await rows.last().click({ button: "right" });

    const menu = page.locator("[role='menu']");
    await expect(menu).toBeVisible();
    await expect(menu.getByText("Delete idea", { exact: true })).toBeVisible();

    const escaped = await menu.evaluate((el) => ({
      // Portaled out of the sidebar entirely: no ancestor overflow can clip it.
      insideSidebar: el.closest("[data-sidebar]") !== null,
      rect: el.getBoundingClientRect().toJSON(),
      viewportHeight: window.innerHeight,
    }));
    expect(escaped.insideSidebar).toBe(false);
    expect(escaped.rect.bottom).toBeLessThanOrEqual(escaped.viewportHeight);
    expect(escaped.rect.top).toBeGreaterThanOrEqual(0);

    // And it is genuinely clickable where it landed, which is the whole point.
    await menu.getByText("Delete idea", { exact: true }).click();
    await page.waitForTimeout(300);
    await expect(rows).toHaveCount(7);
  });

  test("right-clicking a selected row acts on the whole selection", async ({ page }) => {
    await makeIdea(page, "Red");
    await makeIdea(page, "Green");
    await makeIdea(page, "Blue");
    await ensureSidebarOpen(page);

    const rows = ideaRows(page);
    await rows.nth(0).click({ modifiers: ["ControlOrMeta"] });
    await rows.nth(1).click({ modifiers: ["ControlOrMeta"] });
    await rows.nth(1).click({ button: "right" });

    const menu = page.locator("[role='menu']");
    await expect(menu.getByText("2 ideas")).toBeVisible();
    await expect(menu.getByText("Archive all", { exact: true })).toBeVisible();

    await menu.getByText("Archive all", { exact: true }).click();
    await page.waitForTimeout(300);
    await expect(rows).toHaveCount(1);
    // The two rows are in the archive, not gone: the section only appears when
    // it holds something, and it counts what it holds.
    await expect(page.getByRole("button", { name: "Archived 2" })).toBeVisible();
  });
});
