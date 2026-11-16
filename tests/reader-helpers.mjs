// Use actual pointer presses to reveal the reader before interacting with it.
export async function revealReader(page, touch = false) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (await page.locator(".books-reader.controls-visible").count()) return;
    const box = await page.locator(".folio-viewport").boundingBox();
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    if (touch) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
  }
  await page.locator(".books-reader.controls-visible").waitFor();
}

// Wait until a panel's entrance animations finish. A panel holds still at its
// starting position for two frames before it moves in, so a click aimed while
// it is still animating can land on a different control on a slow machine.
export async function settled(locator) {
  await locator.evaluate((node) =>
    Promise.all(
      (node.closest(".folio-popover") || node)
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => {})),
    ),
  );
}

export async function choosePageTurn(
  themes,
  label,
  activate = (n) => n.click(),
) {
  await settled(themes);
  await activate(
    themes.getByRole("button", { name: "Page turning", exact: true }),
  );
  const item = themes.getByRole("menuitemradio", { name: label, exact: true });
  await item.waitFor();
  await settled(item);
  await activate(item);
}

// Reading controls are compact with a mouse and finger-sized with touch
// (src/input-density.ts and the density block at the end of books.css).
export const readerSizes = (page) =>
  page.evaluate(() =>
    matchMedia("(hover: hover) and (pointer: fine)").matches
      ? { scale: 0.9, tool: 44, panel: 380, fine: true }
      : { scale: 1.08, tool: 52, panel: 420, fine: false },
  );
