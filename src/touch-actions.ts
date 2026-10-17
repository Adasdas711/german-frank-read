import { useEffect, useRef } from "preact/hooks";
import type { RefObject } from "preact";

const controls =
  ".reader-exit,.reader-tools-button,.folio-toolbar,.folio-popover,.reading-menu,.word-panel";

// Activate touch buttons on release, without waiting for a compatibility click.
// Inputs/selects remain native; moving a finger or scrolling cancels activation.
export function useTouchActions(
  root: RefObject<HTMLElement>,
  disabled = false,
) {
  const current = useRef<{
    id: number;
    x: number;
    y: number;
    button: HTMLElement;
    moved: boolean;
  } | null>(null);
  const skipClick = useRef(false);
  useEffect(() => {
    const node = root.current;
    if (!node || disabled) return;
    const down = (event: PointerEvent) => {
      skipClick.current = false;
      current.current = null;
      if (
        event.pointerType === "mouse" ||
        !event.isPrimary ||
        event.button !== 0
      )
        return;
      const target = event.target as Element;
      const button = target.closest<HTMLElement>("button,a[href]");
      if (!button || button.matches(":disabled") || !target.closest(controls))
        return;
      current.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        button,
        moved: false,
      };
    };
    const move = (event: PointerEvent) => {
      const p = current.current;
      if (
        p &&
        p.id === event.pointerId &&
        Math.hypot(event.clientX - p.x, event.clientY - p.y) > 8
      )
        p.moved = true;
    };
    const cancel = () => {
      current.current = null;
    };
    const up = (event: PointerEvent) => {
      const p = current.current;
      current.current = null;
      if (
        !p ||
        p.id !== event.pointerId ||
        !p.button.isConnected ||
        p.button.matches(":disabled")
      )
        return;
      skipClick.current = true;
      event.preventDefault();
      event.stopPropagation();
      if (
        p.moved ||
        !p.button.contains(event.target as Node) ||
        Math.hypot(event.clientX - p.x, event.clientY - p.y) > 8
      )
        return;
      p.button.click();
    };
    const click = (event: MouseEvent) => {
      if (
        !skipClick.current ||
        event.detail === 0 ||
        !node.contains(event.target as Node)
      )
        return;
      skipClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    };
    node.addEventListener("pointerdown", down, true);
    node.addEventListener("pointermove", move, true);
    node.addEventListener("pointerup", up, true);
    node.addEventListener("pointercancel", cancel, true);
    node.addEventListener("scroll", cancel, true);
    // A menu can disappear on pointerup, so the browser's later click may hit
    // the book underneath it. Stop it before the reader's capture handler.
    document.addEventListener("click", click, true);
    return () => {
      cancel();
      node.removeEventListener("pointerdown", down, true);
      node.removeEventListener("pointermove", move, true);
      node.removeEventListener("pointerup", up, true);
      node.removeEventListener("pointercancel", cancel, true);
      node.removeEventListener("scroll", cancel, true);
      document.removeEventListener("click", click, true);
    };
  }, [disabled]);
}
