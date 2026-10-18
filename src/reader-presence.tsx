import type { ComponentChildren, RefObject } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Keep a closing panel mounted until its exit finishes. It becomes inert at
// once, so an animation never delays a button or catches a subsequent tap.
export function ReaderPresence({ children }: { children: ComponentChildren }) {
  const container = useRef<HTMLDivElement>(null);
  const previous = useRef(children);
  const shown = !!children;
  const [retained, setRetained] = useState(shown);
  if (shown) previous.current = children;
  useLayoutEffect(() => {
    const node = container.current?.firstElementChild as
      | HTMLElement
      | undefined;
    if (!node) return;
    if (shown) setRetained(true);
    node.inert = !shown;
    node.style.pointerEvents = shown ? "" : "none";
    node.dataset.closing = String(!shown);
    if (!node.closest(".books-reader")) {
      if (!shown) setRetained(false);
      return;
    }
    const from = {
      opacity: 0,
      transform: reduced() ? "none" : "translateY(12px) scale(.96)",
    };
    const to = { opacity: 1, transform: "none" };
    node.style.transformOrigin = "bottom right";
    const animation = node.animate(shown ? [from, to] : [to, from], {
      duration: reduced() ? 100 : shown ? 240 : 160,
      easing: shown ? "cubic-bezier(.16,1,.3,1)" : "ease-in",
      fill: "both",
    });
    animation.onfinish = () => {
      if (!shown) setRetained(false);
      else animation.cancel();
    };
    return () => animation.cancel();
  }, [shown]);
  return shown || retained ? (
    <div ref={container} style={{ display: "contents" }}>
      {previous.current}
    </div>
  ) : null;
}

export function useReaderControls(
  root: RefObject<HTMLElement>,
  shown: boolean,
) {
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const animations: Animation[] = [];
    const nodes =
      root.current?.querySelectorAll<HTMLElement>(
        ".reader-exit,.reader-tools-button,.folio-toolbar",
      ) || [];
    for (const node of nodes) {
      node.style.visibility = "visible";
      node.inert = !shown;
      const animation = node.animate(
        [{ opacity: shown ? 0 : 1 }, { opacity: shown ? 1 : 0 }],
        { duration: reduced() ? 100 : 200, easing: "ease-out", fill: "both" },
      );
      animation.onfinish = () => {
        node.style.visibility = "";
        animation.cancel();
      };
      animations.push(animation);
    }
    return () => {
      animations.forEach((a) => a.cancel());
      for (const node of nodes) node.style.visibility = "";
    };
  }, [shown]);
}
