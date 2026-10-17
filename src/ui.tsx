import { useT } from "./i18n";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, any> = {
    more: (
      <>
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </>
    ),
    "plus-circle": (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v8M8 12h8" />
      </>
    ),
    "minus-circle": (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M8 12h8" />
      </>
    ),
    "check-circle": (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m7 12 3 3 7-7" />
      </>
    ),
    rename: (
      <>
        <path d="m3 18 4-12 4 12M4 15h6M17 4v16M14 4h6M14 20h6" />
      </>
    ),
    collection: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 9h18M7 3h10" />
      </>
    ),
    up: <path d="m6 15 6-6 6 6" />,
    down: <path d="m6 9 6 6 6-6" />,
    hints: (
      <>
        <path d="M5 5h14M7 9h10M9 13h6M5 17h14M4 3l16 18" />
      </>
    ),
    home: (
      <>
        <path d="m3 11 9-8 9 8M5 10v11h5v-7h4v7h5V10" />
      </>
    ),
    sidebar: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="M9 4v16M5 8h2M5 11h2" />
      </>
    ),
    bookmark: <path d="M6 3h12v18l-6-4-6 4z" />,
    plus: <path d="M12 4v16M4 12h16" />,
    pages: (
      <>
        <rect x="5" y="4" width="15" height="17" rx="2" />
        <path d="M3 17V3h14M16 4v6h4" />
      </>
    ),
    scroll: (
      <>
        <path d="M8 7h8M8 12h8M8 17h8M20 5v14m-2-2 2 2 2-2" />
        <rect x="3" y="2" width="14" height="20" rx="2" />
      </>
    ),
    slide: (
      <>
        <rect x="2" y="5" width="13" height="14" rx="2" />
        <path d="M18 5h4v14h-4M6 12h5m-2-2 2 2-2 2" />
      </>
    ),
    fade: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 8h10M7 12h7M7 16h4" />
      </>
    ),
    sliders: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="8" cy="7" r="2" />
        <circle cx="16" cy="17" r="2" />
      </>
    ),
    book: (
      <>
        <path d="M4 4h6l2 2 2-2h6v15h-6l-2 2-2-2H4z" />
        <path d="M12 6v15" />
      </>
    ),
    texts: (
      <>
        <path d="M5 3h10l4 4v14H5z" />
        <path d="M15 3v5h4M8 12h8M8 16h6" />
      </>
    ),
    words: (
      <>
        <path d="M4 4h16v13H9l-5 4z" />
        <path d="M8 8h8M8 12h5" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="m10 3-.5 3-2 1-3-1-2 4 2 2v2l-2 2 2 4 3-1 2 1 .5 3h4l.5-3 2-1 3 1 2-4-2-2v-2l2-2-2-4-3 1-2-1-.5-3z" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" />
      </>
    ),
    moon: <path d="M20.5 13.5A8.5 8.5 0 0 1 10.5 3a8.5 8.5 0 1 0 10 10.5Z" />,
    sound: (
      <>
        <path d="M4 10v4h4l5 4V6L8 10zM17 8a6 6 0 0 1 0 8M20 5a10 10 0 0 1 0 14" />
      </>
    ),
    back: <path d="m15 5-7 7 7 7" />,
    next: <path d="m9 5 7 7-7 7" />,
    upload: (
      <>
        <path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    trash: (
      <>
        <path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" />
      </>
    ),
    stop: <rect x="6" y="6" width="12" height="12" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 5 5" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.book}
    </svg>
  );
}
export function Modal({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: any;
  onClose: () => void;
  className?: string;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    const dialog = ref.current!;
    const el = dialog.querySelector<HTMLElement>("button,input,select");
    el?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const a = [
          ...dialog.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input,select,a[href]",
          ),
        ];
        if (e.shiftKey && document.activeElement === a[0]) {
          e.preventDefault();
          a.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === a.at(-1)) {
          e.preventDefault();
          a[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      before?.focus();
    };
  }, []);
  return (
    <div
      class="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        class={"modal " + className}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <div class="row between">
          <h2>{title}</h2>
          <button class="icon" aria-label={t("Close")} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (b: boolean) => void;
  children: any;
}) {
  return (
    <label class="switch-label">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      <span>{children}</span>
    </label>
  );
}
export function ProgressBar({ value }: { value: number }) {
  const t = useT();
  return (
    <div
      class="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-label={t("Reading")}
    >
      <div style={{ width: value + "%" }} />
    </div>
  );
}

export function ContextMenu({
  x,
  y,
  label,
  className = "",
  onClose,
  children,
}: {
  x: number;
  y: number;
  label: string;
  className?: string;
  onClose(): void;
  children: any;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = menu.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    node.style.left =
      Math.max(8, Math.min(x, innerWidth - rect.width - 8)) + "px";
    node.style.top =
      Math.max(8, Math.min(y, innerHeight - rect.height - 8)) + "px";
  }, [x, y, children]);
  useLayoutEffect(() => {
    const node = menu.current;
    const items = () =>
      Array.from(
        node?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ||
          [],
      );
    items()[0]?.focus({ preventScroll: true });
    const outside = (event: Event) => {
      if (!node?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Tab") {
        onClose();
        if (event.key === "Escape") event.preventDefault();
      }
      const buttons = items(),
        index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  buttons.length) %
                buttons.length;
        buttons[next]?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", outside, true);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", outside, true);
      window.removeEventListener("blur", onClose);
    };
  }, [x, y]);
  return (
    <div
      ref={menu}
      role="menu"
      aria-label={label}
      class={"folder-context-menu glass " + className}
      style={{ left: x, top: y }}
    >
      {children}
    </div>
  );
}
