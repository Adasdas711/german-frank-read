type Bounds = { left: number; top: number; width: number; height: number };

// Copy only the visible text, never the entire book. The original reader DOM
// stays mounted, so its word handlers, source addresses and focus are preserved.
export function pageSnapshot(
  canvas: HTMLElement,
  box: Bounds,
  first?: HTMLElement,
) {
  const snapshot = document.createElement("div");
  snapshot.className = "curl-snapshot";
  snapshot.style.width = box.width + "px";
  snapshot.style.height = box.height + "px";
  const visible = (r: DOMRect) =>
    r.width > 0 &&
    r.height > 0 &&
    r.right > box.left &&
    r.left < box.left + box.width &&
    r.bottom > box.top &&
    r.top < box.top + box.height;
  const walker = document.createTreeWalker(canvas, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  const shown = (node: Node) => {
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()];
    return rects.length ? rects.some(visible) : null;
  };
  if (first?.firstChild) walker.currentNode = first.firstChild;
  else if (!walker.lastChild()) return snapshot;
  let begin: Node | null = null;
  do {
    if (!walker.currentNode.textContent?.trim()) continue;
    const yes = shown(walker.currentNode);
    if (yes) begin = walker.currentNode;
    else if (yes === false && begin) break;
  } while (walker.previousNode());
  if (!begin) return snapshot;
  walker.currentNode = begin;
  const styles = new Map<Element, CSSStyleDeclaration>();
  let lastVisibleRow: Element | null = null;
  const paint = (value: string, rect: DOMRect, style: CSSStyleDeclaration) => {
    const span = document.createElement("span");
    span.textContent = value;
    Object.assign(span.style, {
      position: "absolute",
      left: rect.left - box.left + "px",
      top: rect.top - box.top + "px",
      font: style.font,
      color: style.color,
      backgroundColor: style.backgroundColor,
      letterSpacing: style.letterSpacing,
      lineHeight: rect.height + "px",
      whiteSpace: "pre",
    });
    snapshot.append(span);
  };
  do {
    const node = walker.currentNode,
      value = node.textContent || "";
    if (!value.trim()) continue;
    const yes = shown(node);
    if (yes === null) continue;
    const row = node.parentElement?.closest(".sentence-row") || null;
    if (!yes) {
      // A parallel row may continue onto the next page before its translation.
      if (canvas.closest('[data-mode="parallel"]') && row === lastVisibleRow)
        continue;
      break;
    }
    lastVisibleRow = row;
    const parent = node.parentElement!;
    let style = styles.get(parent);
    if (!style) {
      style = getComputedStyle(parent);
      styles.set(parent, style);
    }
    for (const match of value.matchAll(/\S+/g)) {
      range.setStart(node, match.index!);
      range.setEnd(node, match.index! + match[0].length);
      const allRects = [...range.getClientRects()];
      const rects = allRects.filter(visible);
      if (!rects.length) continue;
      if (allRects.length === 1) {
        paint(match[0], rects[0], style);
        continue;
      }
      // Hyphenated words can have more than one line/column rectangle. Copy
      // each visible run instead of drawing the whole word over its first line.
      let run = "",
        bounds: DOMRect | null = null;
      for (let i = 0; i < match[0].length; i++) {
        range.setStart(node, match.index! + i);
        range.setEnd(node, match.index! + i + 1);
        const r = [...range.getClientRects()].find(visible);
        if (!r) {
          if (bounds) paint(run, bounds, style);
          run = "";
          bounds = null;
          continue;
        }
        if (bounds && Math.abs(r.top - bounds.top) > 1) {
          paint(run + "-", bounds, style);
          run = "";
          bounds = null;
        }
        run += match[0][i];
        bounds = bounds
          ? new DOMRect(
              bounds.left,
              bounds.top,
              r.right - bounds.left,
              Math.max(bounds.height, r.height),
            )
          : r;
      }
      if (bounds) paint(run, bounds, style);
    }
  } while (walker.nextNode());
  return snapshot;
}

export function animatePageTurn({
  kind,
  canvas,
  host,
  box,
  outgoing,
  from,
  to,
  direction,
}: {
  kind: "slide" | "curl" | "fade";
  canvas: HTMLElement;
  host: HTMLElement;
  box: Bounds;
  outgoing?: HTMLElement;
  from: string;
  to: string;
  direction: number;
}) {
  const animations: Animation[] = [];
  let layer: HTMLDivElement | undefined,
    stopped = false;
  const durationScale = matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 0.6
    : 1;
  host.dataset.turning = kind;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const animation of animations) animation.cancel();
    layer?.remove();
    delete host.dataset.turning;
  };
  const animate = (
    node: Element,
    frames: Keyframe[],
    duration: number,
    easing = "ease-out",
  ) => {
    const animation = node.animate(frames, {
      duration: duration * durationScale,
      easing,
      fill: "both",
    });
    animations.push(animation);
    return animation;
  };
  if (kind === "slide") {
    animate(
      canvas,
      [{ transform: from }, { transform: to }],
      320,
      "cubic-bezier(.2,.7,.2,1)",
    ).onfinish = stop;
  } else {
    layer = document.createElement("div");
    layer.className =
      "reader-page-layer " + (kind === "curl" ? "curl-leaf" : "fade-leaf");
    layer.setAttribute("aria-hidden", "true");
    const root = host.getBoundingClientRect();
    Object.assign(layer.style, {
      left: box.left - root.left + "px",
      top: box.top - root.top + "px",
      width: box.width + "px",
      height: box.height + "px",
    });
    host.append(layer);
    if (kind === "fade") {
      if (outgoing) layer.append(outgoing);
      animate(canvas, [{ opacity: 0 }, { opacity: 1 }], 150);
      animate(layer, [{ opacity: 1 }, { opacity: 0 }], 150).onfinish = stop;
    } else {
      // Six connected strips follow a curved surface. Their shared boundary
      // positions keep the sheet connected while it bends around its spine.
      const strips = 6,
        width = box.width / strips,
        forward = direction > 0;
      const frames: Keyframe[][] = Array.from({ length: strips }, () => []);
      for (let frame = 0; frame <= 16; frame++) {
        const progress = frame / 16,
          curve = (Math.sin(progress * Math.PI) * Math.PI) / 2.4;
        let x = forward ? 0 : box.width,
          z = 0;
        for (let i = 0; i < strips; i++) {
          const angle =
            (forward ? -1 : 1) *
            (Math.PI * progress + curve * ((i + 0.5) / strips - 0.5));
          frames[i].push({
            offset: progress,
            transform: `translate3d(${forward ? x : x - width}px,0,${z}px) rotateY(${angle}rad)`,
          });
          x += (forward ? 1 : -1) * width * Math.cos(angle);
          z += (forward ? -1 : 1) * width * Math.sin(angle);
        }
      }
      for (let i = 0; i < strips; i++) {
        const strip = document.createElement("div");
        strip.className = "curl-strip";
        strip.style.width = width + 0.3 + "px";
        strip.style.transformOrigin = forward ? "left center" : "right center";
        const front = document.createElement("div");
        front.className = "curl-face front";
        const back = document.createElement("div");
        back.className = "curl-face back";
        if (outgoing) {
          const copy = outgoing.cloneNode(true) as HTMLElement;
          copy.style.position = "absolute";
          copy.style.left = -(forward ? i : strips - 1 - i) * width + "px";
          front.append(copy);
        }
        strip.append(front, back);
        layer.append(strip);
        animate(strip, frames[i], 560, "cubic-bezier(.4,0,.6,1)");
      }
      // Keep the 3D surface unflattened while it bends; only fade its last edge.
      animate(
        layer,
        [{ opacity: 1 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }],
        560,
        "linear",
      ).onfinish = stop;
    }
  }
  return stop;
}
