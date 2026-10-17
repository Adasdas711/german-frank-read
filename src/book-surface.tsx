import type { JSX, ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

type Props = JSX.HTMLAttributes<HTMLElement> & {
  as?: "article" | "button" | "div" | "header";
  onHold?(x: number, y: number): void;
  menuOpen?: boolean;
  children?: ComponentChildren;
};

// Only the actively touched book installs document listeners. A large library
// must not attach a set of global gesture handlers for every visible cover.
export function BookSurface({
  as: Tag = "article",
  onHold,
  onContextMenu,
  onDragStart,
  menuOpen,
  children,
  ...props
}: Props) {
  const node = useRef<HTMLElement>(null);
  const pointerType = useRef("mouse");
  const callbacks = useRef({ onHold, onContextMenu });
  callbacks.current = { onHold, onContextMenu };
  const interaction = useRef<{ held: boolean; open(): void } | null>(null);
  const cleanup = useRef<() => void>(() => {});
  useEffect(() => () => cleanup.current(), []);
  const start = (event: PointerEvent) => {
    pointerType.current = event.pointerType;
    cleanup.current();
    if (
      !callbacks.current.onHold ||
      event.pointerType === "mouse" ||
      !event.isPrimary ||
      event.button !== 0 ||
      (event.target as Element).closest(
        ".book-more,.continue-more,[data-no-book-hold]",
      )
    )
      return;
    const id = event.pointerId,
      x = event.clientX,
      y = event.clientY;
    let expiry: ReturnType<typeof setTimeout>;
    const current = {
      held: false,
      open: () => {
        if (current.held || !node.current?.isConnected) return;
        current.held = true;
        clearTimeout(timer);
        const rect = node.current.getBoundingClientRect();
        callbacks.current.onHold?.(
          rect.left,
          Math.min(rect.bottom + 8, y + 36),
        );
      },
    };
    interaction.current = current;
    const timer = setTimeout(current.open, 420);
    const move = (e: PointerEvent) => {
      if (
        e.pointerId === id &&
        Math.hypot(e.clientX - x, e.clientY - y) > 8 &&
        !current.held
      )
        cancel();
    };
    const next = () => cancel();
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      clearTimeout(timer);
      if (!current.held) cancel();
      else expiry = setTimeout(cancel, 1200);
    };
    const click = (e: MouseEvent) => {
      if (!current.held || e.detail === 0) return;
      e.preventDefault();
      e.stopPropagation();
      cancel();
    };
    const cancel = () => {
      clearTimeout(timer);
      clearTimeout(expiry);
      interaction.current = null;
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", next);
      document.removeEventListener("pointerdown", next, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("scroll", next, true);
      document.removeEventListener("visibilitychange", next);
      window.removeEventListener("blur", next);
      cleanup.current = () => {};
    };
    cleanup.current = cancel;
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", next);
    document.addEventListener("pointerdown", next, true);
    document.addEventListener("click", click, true);
    document.addEventListener("scroll", next, true);
    document.addEventListener("visibilitychange", next);
    window.addEventListener("blur", next);
  };
  return (
    <Tag
      {...props}
      ref={node as any}
      data-book-surface
      data-book-menu-open={menuOpen || undefined}
      onPointerDown={start as any}
      onDragStart={(event) => {
        if (interaction.current || pointerType.current !== "mouse")
          event.preventDefault();
        else onDragStart?.(event as any);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (interaction.current) interaction.current.open();
        else callbacks.current.onContextMenu?.(event as any);
      }}
    >
      {children}
    </Tag>
  );
}
