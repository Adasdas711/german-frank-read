// Keep the regression suites for excerpt/scroll reading explicit now that pages are default.
export async function selectReadingFlow(page, flow = "blocks") {
  await page.evaluate(() => (location.hash = "/settings"));
  await page.locator("#reading-flow").selectOption(flow);
  await page.evaluate(() => (location.hash = "/home"));
  await page.locator(".hero").waitFor();
}
