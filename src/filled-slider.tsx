import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

// A filled row: the input remains native for keyboard/assistive interaction.
// Pointer drags use the bounds at press time, so changing interface size cannot
// move the slider away from the finger or change its value a second time.
export function FilledSlider({
  value,
  min,
  max,
  label,
  children,
  onInput,
  onActivate,
  activationLabel,
  valueText,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  children: ComponentChildren;
  onInput(value: number): void;
  onActivate?(): void;
  activationLabel?: string;
  valueText?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const press = useRef<{
    id: number;
    x: number;
    y: number;
    left: number;
    width: number;
    dragged: boolean;
    cancelled: boolean;
  }>();
  const suppress = useRef(false),
    frame = useRef(0),
    pending = useRef(value);
  const callback = useRef(onInput);
  callback.current = onInput;
  const write = (x: number, flush = false) => {
    const p = press.current!;
    pending.current = Math.round(
      min + Math.max(0, Math.min(1, (x - p.left) / p.width)) * (max - min),
    );
    // Paint directly during the drag, before a page jump or a resized panel
    // commits. Both Contents and Reading controls use the same fill.
    root.current?.style.setProperty(
      "--fill",
      `${max > min ? ((pending.current - min) / (max - min)) * 100 : 0}%`,
    );
    cancelAnimationFrame(frame.current);
    if (flush) callback.current(pending.current);
    else
      frame.current = requestAnimationFrame(() =>
        callback.current(pending.current),
      );
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return (
    <div
      class={"filled-control" + (onActivate ? " contents-progress" : "")}
      style={{
        "--fill": `${max > min ? ((value - min) / (max - min)) * 100 : 0}%`,
      }}
      ref={root}
      onPointerDown={(e) => {
        if (!e.isPrimary || e.button !== 0) return;
        suppress.current = false;
        delete root.current!.dataset.dragging;
        const box = root.current!.getBoundingClientRect();
        press.current = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          left: box.left,
          width: box.width,
          dragged: false,
          cancelled: false,
        };
        if (!onActivate) e.preventDefault();
      }}
      onPointerMove={(e) => {
        const p = press.current;
        if (!p || p.id !== e.pointerId || p.cancelled) return;
        const dx = e.clientX - p.x,
          dy = e.clientY - p.y;
        if (!p.dragged && Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
          p.cancelled = true;
          return;
        }
        if (!p.dragged && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
          p.dragged = true;
          root.current!.dataset.dragging = "true";
          suppress.current = true;
          root.current!.setPointerCapture(e.pointerId);
        }
        if (p.dragged) {
          e.preventDefault();
          write(e.clientX);
        }
      }}
      onPointerUp={(e) => {
        const p = press.current;
        if (!p || p.id !== e.pointerId) return;
        if (!p.cancelled && (p.dragged || !onActivate)) write(e.clientX, true);
        suppress.current = p.dragged || p.cancelled;
        press.current = undefined;
        delete root.current!.dataset.dragging;
      }}
      onPointerCancel={() => {
        press.current = undefined;
        suppress.current = true;
        cancelAnimationFrame(frame.current);
        delete root.current!.dataset.dragging;
        root.current!.style.setProperty(
          "--fill",
          `${max > min ? ((value - min) / (max - min)) * 100 : 0}%`,
        );
      }}
      onClickCapture={(e) => {
        if (suppress.current && e.detail > 0) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      {onActivate ? (
        <button
          class="filled-control-label"
          aria-label={activationLabel}
          aria-haspopup="dialog"
          onClick={onActivate}
        >
          {children}
        </button>
      ) : (
        <div class="filled-control-label" aria-hidden="true">
          {children}
        </div>
      )}
      <input
        class={"filled-control-input" + (onActivate ? " keyboard-range" : "")}
        type="range"
        min={min}
        max={max}
        step="1"
        value={value}
        aria-label={label}
        aria-valuetext={valueText}
        disabled={max <= min}
        onInput={(e) => callback.current(+e.currentTarget.value)}
      />
    </div>
  );
}
