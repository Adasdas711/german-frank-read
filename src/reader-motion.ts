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

export type PageMotion = {
  stop(): void;
  seek(progress: number): void;
  finish(commit: boolean): void;
};

// Clip a rectangular sheet against its fold line. Both faces use the same
// boundary; the reflected back is one continuous surface, without strip seams.
function halfSheet(
  w: number,
  h: number,
  nx: number,
  ny: number,
  c: number,
  front: boolean,
) {
  const points = [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ],
    result: number[][] = [];
  const distance = ([x, y]: number[]) =>
    (nx * x + ny * y - c) * (front ? 1 : -1);
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const da = distance(a),
      db = distance(b);
    if (da <= 0) result.push(a);
    if (da <= 0 !== db <= 0) {
      const t = da / (da - db);
      result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  if (result.length < 3) return "polygon(0px 0px,0px 0px,0px 0px)";
  return `polygon(${result.map(([x, y]) => `${x}px ${y}px`).join(",")})`;
}

export function animatePageTurn({
  kind,
  canvas,
  host,
  box,
  outgoing,
  incoming,
  to,
  direction,
  interactive = false,
  originY = 0.75,
  onFinish,
}: {
  kind: "slide" | "curl" | "fade";
  canvas: HTMLElement;
  host: HTMLElement;
  box: Bounds;
  outgoing: HTMLElement;
  incoming?: HTMLElement;
  to: string;
  direction: number;
  interactive?: boolean;
  originY?: number;
  onFinish(commit: boolean): void;
}): PageMotion {
  const animations: Animation[] = [];
  const tracks: { node: Element; frames: Keyframe[]; animation: Animation }[] =
    [];
  const duration = kind === "curl" ? 520 : kind === "slide" ? 360 : 160;
  let stopped = false,
    progress = 0;
  const layer = document.createElement("div");
  layer.className = `reader-page-layer ${kind}-leaf`;
  layer.setAttribute("aria-hidden", "true");
  const root = host.getBoundingClientRect();
  Object.assign(layer.style, {
    left: box.left - root.left + "px",
    top: box.top - root.top + "px",
    width: box.width + "px",
    height: box.height + "px",
  });
  host.append(layer);
  host.dataset.turning = kind;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    animations.forEach((a) => a.cancel());
    layer.remove();
    delete host.dataset.turning;
  };
  const animate = (node: Element, frames: Keyframe[]) => {
    const a = node.animate(frames, {
      duration,
      fill: "both",
      easing: "linear",
    });
    a.pause();
    a.currentTime = 0;
    animations.push(a);
    tracks.push({ node, frames, animation: a });
    return a;
  };
  if (kind === "slide") {
    layer.append(outgoing);
    animate(layer, [
      { transform: "translateX(0)" },
      { transform: `translateX(${-direction * box.width}px)` },
    ]);
    const destination = new DOMMatrix(to).m41;
    animate(canvas, [
      {
        transform: `translateX(${destination + direction * box.width * 0.22}px)`,
      },
      { transform: to },
    ]);
  } else if (kind === "fade") {
    layer.append(outgoing);
    animate(layer, [{ opacity: 1 }, { opacity: 0 }]);
    animate(canvas, [{ opacity: 0 }, { opacity: 1 }]);
  } else {
    if (direction < 0) {
      const under = document.createElement("div");
      under.className = "curl-under";
      under.append(outgoing);
      layer.append(under);
    }
    const sheet = direction > 0 ? outgoing : incoming!;
    const front = document.createElement("div"),
      back = document.createElement("div"),
      shadow = document.createElement("div");
    front.className = "curl-front";
    back.className = "curl-back";
    shadow.className = "curl-shadow";
    front.append(sheet);
    back.append(sheet.cloneNode(true));
    layer.append(shadow, front, back);
    const frontFrames: Keyframe[] = [],
      backFrames: Keyframe[] = [],
      shadows: Keyframe[] = [];
    for (let i = 0; i <= 60; i++) {
      const time = i / 60,
        p = direction > 0 ? time : 1 - time;
      const angle = (originY >= 0.5 ? -0.13 : 0.13) * Math.sin(Math.PI * p);
      const nx = Math.cos(angle),
        ny = Math.sin(angle);
      const foldX = box.width * (1 - p),
        c = nx * foldX + (ny * box.height) / 2;
      frontFrames.push({
        offset: time,
        clipPath: halfSheet(box.width, box.height, nx, ny, c, true),
      });
      backFrames.push({
        offset: time,
        clipPath: halfSheet(box.width, box.height, nx, ny, c, false),
        transform: `matrix(${1 - 2 * nx * nx},${-2 * nx * ny},${-2 * nx * ny},${1 - 2 * ny * ny},${2 * c * nx},${2 * c * ny})`,
      });
      shadows.push({
        offset: time,
        opacity: Math.sin(Math.PI * p) * 0.65,
        transform: `translateX(${foldX}px) rotate(${-angle}rad)`,
      });
    }
    animate(front, frontFrames);
    animate(back, backFrames);
    animate(shadow, shadows);
  }
  const seek = (value: number) => {
    progress = Math.max(0, Math.min(1, value));
    for (const a of animations) {
      a.pause();
      a.currentTime = progress * duration;
    }
  };
  const finish = (commit: boolean) => {
    if (stopped) return;
    const target = commit ? 1 : 0;
    if (target === progress) {
      stop();
      onFinish(commit);
      return;
    }
    // Continue from the exact finger position. A cancelled swipe plays back
    // towards the original page, rather than jumping to it.
    for (const { node, frames, animation } of tracks) {
      const style = getComputedStyle(node);
      const first: Keyframe = { offset: 0 };
      for (const key of Object.keys(frames[0]))
        if (!["offset", "easing", "composite"].includes(key))
          first[key] = style[key];
      const tail = frames
        .map((frame, i) => ({
          ...frame,
          offset: frame.offset ?? i / (frames.length - 1),
        }))
        .filter((frame) =>
          commit ? frame.offset > progress : frame.offset < progress,
        );
      if (!commit) tail.reverse();
      const settled = [
        first,
        ...tail.map((frame) => ({
          ...frame,
          offset: (frame.offset - progress) / (target - progress),
        })),
      ];
      const effect = animation.effect as KeyframeEffect;
      effect.setKeyframes(settled);
      effect.updateTiming({
        duration: Math.max(80, duration * Math.abs(target - progress)),
        easing: "cubic-bezier(.2,.65,.3,1)",
      });
      animation.currentTime = 0;
      animation.play();
    }
    animations[0].onfinish = () => {
      stop();
      onFinish(commit);
    };
  };
  if (!interactive) finish(true);
  return { stop, seek, finish };
}
