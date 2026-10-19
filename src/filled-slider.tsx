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
  step = 1,
  disabled = false,
  onCommit,
  onCancel,
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
  step?: number;
  disabled?: boolean;
  onCommit?(value: number): void;
  onCancel?(): void;
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
    const raw =
      min + Math.max(0, Math.min(1, (x - p.left) / p.width)) * (max - min);
    pending.current = Number(
      Math.max(
        min,
        Math.min(max, min + Math.round((raw - min) / step + 1e-9) * step),
      ).toFixed(8),
    );
    // Paint directly during the drag, before a page jump or a resized panel
    // commits. Both Contents and Reading controls use the same fill.
    root.current?.style.setProperty(
      "--fill",
      `${max > min ? ((pending.current - min) / (max - min)) * 100 : 0}%`,
    );
    if (flush) {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      callback.current(pending.current);
    } else if (!frame.current) {
      // Coalesce moves without postponing the already scheduled frame.
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        callback.current(pending.current);
      });
    }
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
        if (disabled || max <= min || !e.isPrimary || e.button !== 0) return;
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
        // Keep receiving moves even if a press near an edge leaves the row
        // before it has travelled far enough to be recognised as a drag.
        const target =
          (e.target as Element).closest("button,input") || root.current!;
        target.setPointerCapture(e.pointerId);
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
        }
        if (p.dragged) {
          e.preventDefault();
          write(e.clientX);
        }
      }}
      onPointerUp={(e) => {
        const p = press.current;
        if (!p || p.id !== e.pointerId) return;
        if (!p.cancelled && (p.dragged || !onActivate)) {
          write(e.clientX, true);
          onCommit?.(pending.current);
        } else if (p.cancelled) onCancel?.();
        suppress.current = p.dragged || p.cancelled;
        press.current = undefined;
        delete root.current!.dataset.dragging;
      }}
      onPointerCancel={() => {
        onCancel?.();
        press.current = undefined;
        suppress.current = true;
        cancelAnimationFrame(frame.current);
        frame.current = 0;
        delete root.current!.dataset.dragging;
        root.current!.style.setProperty(
          "--fill",
          `${max > min ? ((value - min) / (max - min)) * 100 : 0}%`,
        );
      }}
      onLostPointerCapture={() => {
        if (!press.current) return;
        onCancel?.();
        press.current = undefined;
        suppress.current = true;
        cancelAnimationFrame(frame.current);
        frame.current = 0;
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
        step={step}
        value={value}
        aria-label={label}
        aria-valuetext={valueText}
        disabled={disabled || max <= min}
        onInput={(e) => callback.current(+e.currentTarget.value)}
        onChange={(e) => onCommit?.(+e.currentTarget.value)}
      />
    </div>
  );
}
