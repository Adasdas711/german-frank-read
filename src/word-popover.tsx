import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

// Positions stay in physical viewport coordinates, including on scaled interfaces.
export function WordPopover({
  anchor,
  onDismiss,
  children,
}: {
  anchor: HTMLElement;
  onDismiss(): void;
  children: ComponentChildren;
}) {
  const bubble = useRef<HTMLDivElement>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useLayoutEffect(() => {
    const node = bubble.current!;
    const panel = node.firstElementChild as HTMLElement;
    let frame = 0;
    const position = () => {
      const visual = window.visualViewport;
      const left = (visual?.offsetLeft || 0) + 12;
      const top = (visual?.offsetTop || 0) + 12;
      const right = left + (visual?.width || innerWidth) - 24;
      const bottom = top + (visual?.height || innerHeight) - 24;
      node.style.maxWidth = Math.max(0, right - left) + "px";
      const canvas = anchor.closest(".folio-viewport")?.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(anchor);
      const word = [...range.getClientRects()].find(
        (rect) =>
          rect.width &&
          rect.right > left &&
          rect.left < right &&
          rect.bottom > top &&
          rect.top < bottom &&
          (!canvas ||
            (rect.bottom > canvas.top &&
              rect.top < canvas.bottom &&
              rect.right > canvas.left &&
              rect.left < canvas.right)),
      );
      if (!anchor.isConnected || !word) {
        dismiss.current();
        return;
      }
      const above = Math.max(0, word.top - top - 8);
      const below = Math.max(0, bottom - word.bottom - 8);
      const desired = panel.scrollHeight + 2;
      const under = below >= desired || below >= above;
      node.style.maxHeight =
        Math.floor(Math.max(40, under ? below : above)) + "px";
      const box = node.getBoundingClientRect();
      node.style.left =
        Math.max(
          left,
          Math.min(
            word.left + word.width / 2 - box.width / 2,
            right - box.width,
          ),
        ) + "px";
      node.style.top =
        Math.max(
          top,
          Math.min(
            under ? word.bottom + 8 : word.top - box.height - 8,
            bottom - box.height,
          ),
        ) + "px";
      node.dataset.placement = under ? "below" : "above";
      node.style.visibility = "visible";
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(position);
    };
    const outside = (event: PointerEvent) => {
      if (
        !node.contains(event.target as Node) &&
        !anchor.contains(event.target as Node)
      )
        dismiss.current();
    };
    const scroll = (event: Event) => {
      if (!node.contains(event.target as Node)) dismiss.current();
    };
    anchor.classList.add("chosen");
    position();
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    observer.observe(anchor);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      anchor.classList.remove("chosen");
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [anchor]);
  return (
    <div class="folio-word-overlay word-popover" ref={bubble}>
      {children}
    </div>
  );
}
