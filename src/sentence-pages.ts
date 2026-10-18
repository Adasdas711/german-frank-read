// Keep paragraphs inline. Only a sentence which crosses a page boundary gets a
// column break before it. Oversized sentences are allowed to continue on the
// next page: no words are discarded to satisfy a page-height constraint.
function planParagraph(
  canvas: HTMLElement,
  stride: number,
  height: number,
  fits: (row: HTMLElement) => boolean,
) {
  const rows = [...canvas.querySelectorAll<HTMLElement>(".sentence-row")];
  const range = document.createRange(),
    origin = canvas.getBoundingClientRect(),
    leading = parseFloat(getComputedStyle(canvas).lineHeight) / 2,
    breaks: number[] = [];
  const bounds = (i: number) => {
    range.selectNodeContents(rows[i]);
    const rects = [...range.getClientRects()].filter(
      (r) => r.width > 0 && r.height > 0,
    );
    const first = rects[0];
    return {
      first: first
        ? Math.max(0, Math.floor((first.left - origin.left + 1) / stride))
        : 0,
      last: rects.reduce(
        (leaf, r) =>
          Math.max(leaf, Math.floor((r.left - origin.left + 1) / stride)),
        0,
      ),
      top: first?.top || origin.top,
    };
  };
  let cursor = 0,
    leaf = 0;
  while (cursor < rows.length) {
    let low = cursor,
      high = rows.length;
    // Find the last sentence that starts on this physical page.
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (bounds(mid).first <= leaf) low = mid + 1;
      else high = mid;
    }
    const i = low - 1;
    if (i >= cursor) {
      const b = bounds(i);
      if (
        b.first === leaf &&
        b.last > leaf &&
        b.top - origin.top > leading &&
        fits(rows[i])
      ) {
        rows[i].dataset.pageStart = "true";
        breaks.push(i);
        const moved = bounds(i);
        // Continue at the last page occupied by the moved sentence.
        leaf = Math.max(leaf + 1, moved.last);
        cursor = i + 1;
        continue;
      }
      cursor = low;
      leaf = Math.max(leaf + 1, b.last);
    } else {
      const first = bounds(cursor).first;
      if (first <= leaf) cursor++;
      else leaf = first;
    }
    // Defensive guard for hidden/empty rows (e.g. a translation-only archive).
    if (height <= 0) break;
  }
  return breaks;
}

// Measure each paragraph in an isolated scratch column. Reflowing the full
// novel once per page makes opening long books unresponsive on mobile devices.
// This produces the break plan using small DOM trees, then applies it in one
// batch to the live book. Native columns still perform the final typesetting.
export function sentencePages(
  canvas: HTMLElement,
  stride: number,
  height: number,
  restored?: number[],
) {
  const rows = [...canvas.querySelectorAll<HTMLElement>(".sentence-row")];
  for (const row of rows) delete row.dataset.pageStart;
  if (restored) {
    for (const i of restored) if (rows[i]) rows[i].dataset.pageStart = "true";
    return restored;
  }
  if (height <= 0) return [];
  const style = getComputedStyle(canvas),
    gap = parseFloat(style.columnGap);
  const scratch = document.createElement("main");
  scratch.className = "folio-columns sentence-measure";
  scratch.inert = true;
  scratch.setAttribute("aria-hidden", "true");
  Object.assign(scratch.style, {
    position: "fixed",
    left: "-300vw",
    top: "0",
    visibility: "hidden",
    width: stride - gap + "px",
    height: height + "px",
    columnCount: "1",
    columnWidth: stride - gap + "px",
    columnGap: gap + "px",
    transform: "none",
    contain: "layout style",
    pointerEvents: "none",
  });
  const probe = scratch.cloneNode(false) as HTMLElement;
  Object.assign(probe.style, {
    height: "auto",
    columnCount: "auto",
    columnWidth: "auto",
  });
  const panel = document.createElement("section"),
    paragraph = document.createElement("p");
  panel.className = "reading-panel";
  paragraph.style.textIndent = "0";
  paragraph.style.margin = "0";
  paragraph.lang = "de";
  panel.append(paragraph);
  probe.append(panel);
  canvas.parentElement!.append(scratch, probe);
  const fits = (row: HTMLElement) => {
    const copy = row.cloneNode(true) as HTMLElement;
    delete copy.dataset.pageStart;
    paragraph.replaceChildren(copy);
    return paragraph.getBoundingClientRect().height <= height + 0.5;
  };
  const breaks: number[] = [];
  let y = 0,
    base = 0;
  try {
    for (const chapter of canvas.querySelectorAll<HTMLElement>(
      ".folio-chapter",
    )) {
      y = 0;
      let first = true;
      for (const fragment of chapter.querySelectorAll<HTMLElement>(
        ".folio-fragment",
      )) {
        const spacer = document.createElement("div");
        spacer.style.height = y + "px";
        const copy = fragment.cloneNode(true) as HTMLElement;
        const originalParagraph = fragment.querySelector(".reading-panel p");
        const copiedParagraph =
          copy.querySelector<HTMLElement>(".reading-panel p");
        if (originalParagraph && copiedParagraph)
          copiedParagraph.style.textIndent =
            getComputedStyle(originalParagraph).textIndent;
        const tail = document.createElement("div");
        tail.style.height = "0px";
        scratch.replaceChildren(spacer);
        if (first) {
          const heading = chapter.querySelector(".folio-chapter-title");
          if (heading) scratch.append(heading.cloneNode(true));
        }
        scratch.append(copy, tail);
        const planned = planParagraph(scratch, stride, height, fits);
        for (const i of planned) breaks.push(base + i);
        base += copy.querySelectorAll(".sentence-row").length;
        y = Math.max(
          0,
          tail.getBoundingClientRect().top -
            scratch.getBoundingClientRect().top,
        );
        first = false;
      }
    }
  } finally {
    scratch.remove();
    probe.remove();
  }
  for (const i of breaks) rows[i].dataset.pageStart = "true";
  return breaks;
}
