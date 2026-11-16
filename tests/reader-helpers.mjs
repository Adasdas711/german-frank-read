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

export async function choosePageTurn(
  themes,
  label,
  activate = (n) => n.click(),
) {
  await activate(
    themes.getByRole("button", { name: "Page turning", exact: true }),
  );
  await activate(
    themes.getByRole("menuitemradio", { name: label, exact: true }),
  );
}

// Reading controls are compact with a mouse and finger-sized with touch
// (src/input-density.ts and the density block at the end of books.css).
export const readerSizes = (page) =>
  page.evaluate(() =>
    matchMedia("(hover: hover) and (pointer: fine)").matches
      ? { scale: 0.9, tool: 44, panel: 380, fine: true }
      : { scale: 1.08, tool: 52, panel: 420, fine: false },
  );
