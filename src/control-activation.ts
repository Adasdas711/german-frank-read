import { useEffect, useRef } from "preact/hooks";
import type { RefObject } from "preact";

// Keep native clicks and input defaults. A browser may consume the first tap
// after scrolling without dispatching a click; only then activate the button.
export function useControlActivation(
  root: RefObject<HTMLElement>,
  disabled = false,
) {
  const press = useRef<{
    id: number;
    x: number;
    y: number;
    button: HTMLElement;
    moved: boolean;
    released: boolean;
    delivered: boolean;
  } | null>(null);
  useEffect(() => {
    const node = root.current;
    if (!node || disabled) return;
    let fallback: ReturnType<typeof setTimeout>;
    let expiry: ReturnType<typeof setTimeout>;
    const clear = () => {
      clearTimeout(fallback);
      clearTimeout(expiry);
      press.current = null;
    };
    const down = (event: PointerEvent) => {
      if (
        event.pointerType === "mouse" ||
        !event.isPrimary ||
        event.button !== 0
      )
        return;
      const target = event.target as Element;
      // Inputs, labels, selects and disclosure summaries always stay native.
      if (target.closest("input,select,textarea,label,summary")) return;
      const button = target.closest<HTMLElement>("button,a[href]");
      if (
        !button ||
        button.matches(":disabled") ||
        !target.closest(
          ".reader-exit,.reader-tools-button,.folio-toolbar,.folio-popover,.reading-menu,.word-panel",
        )
      )
        return;
      press.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        button,
        moved: false,
        released: false,
        delivered: false,
      };
    };
    const move = (event: PointerEvent) => {
      const p = press.current;
      if (
        p?.id === event.pointerId &&
        Math.hypot(event.clientX - p.x, event.clientY - p.y) > 8
      )
        p.moved = true;
    };
    const up = (event: PointerEvent) => {
      const p = press.current;
      if (!p || p.id !== event.pointerId) return;
      p.released = true;
      p.moved ||=
        !p.button.contains(event.target as Node) ||
        Math.hypot(event.clientX - p.x, event.clientY - p.y) > 8;
      if (!p.moved)
        fallback = setTimeout(() => {
          if (
            press.current !== p ||
            !p.button.isConnected ||
            p.button.matches(":disabled")
          )
            return;
          p.delivered = true;
          p.button.click();
        }, 80);
      expiry = setTimeout(clear, 1000);
    };
    const click = (event: MouseEvent) => {
      const p = press.current;
      if (
        !p?.released ||
        (!event.isTrusted && event.detail === 0) ||
        !node.contains(event.target as Node)
      )
        return;
      clearTimeout(fallback);
      if (p.delivered || p.moved) {
        event.preventDefault();
        event.stopPropagation();
      }
      clear();
    };
    const scroll = () => {
      if (press.current && !press.current.released) press.current.moved = true;
    };
    document.addEventListener("pointerdown", clear, true);
    document.addEventListener("keydown", clear, true);
    node.addEventListener("pointerdown", down, true);
    node.addEventListener("pointermove", move, true);
    node.addEventListener("pointerup", up, true);
    node.addEventListener("pointercancel", clear, true);
    node.addEventListener("scroll", scroll, true);
    document.addEventListener("click", click, true);
    window.addEventListener("blur", clear);
    return () => {
      clear();
      document.removeEventListener("pointerdown", clear, true);
      document.removeEventListener("keydown", clear, true);
      node.removeEventListener("pointerdown", down, true);
      node.removeEventListener("pointermove", move, true);
      node.removeEventListener("pointerup", up, true);
      node.removeEventListener("pointercancel", clear, true);
      node.removeEventListener("scroll", scroll, true);
      document.removeEventListener("click", click, true);
      window.removeEventListener("blur", clear);
    };
  }, [disabled]);
}
