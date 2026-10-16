import { useT } from "./i18n";
import { useLayoutEffect, useRef, useState, useCallback } from "preact/hooks";
import { locate, plain, sentences, type Content, type Chunk } from "./core";
import { BookFlow, type ReadingFlow } from "./book-flow";
import { Icon } from "./ui";

type Props = {
  content: Content;
  chapters: string[];
  flow: ReadingFlow;
  layoutKey: string;
  onPosition(at: string): void;
  at: string;
  mode: string;
  showClean: boolean;
  index: number;
  total: number;
  navigate(delta: number): void;
  onExit(): void;
};

export function FocusReader({
  content,
  chapters,
  flow,
  layoutKey,
  onPosition,
  at,
  mode,
  showClean,
  index,
  total,
  navigate,
  onExit,
}: Props) {
  const t = useT();
  const [controls, setControls] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const main = useRef<HTMLElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const actions = useRef({ navigate, onExit });
  actions.current = { navigate, onExit };
  function reveal() {
    setControls(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setControls(false), 1800);
  }
  useLayoutEffect(() => {
    main.current?.focus({ preventScroll: true });
    return () => clearTimeout(timer.current);
  }, []);
  useLayoutEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        actions.current.onExit();
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
        return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        actions.current.navigate(1);
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        actions.current.navigate(-1);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  function hinted(chunks: Chunk[]) {
    return chunks.map((chunk) =>
      typeof chunk === "string" ? (
        chunk
      ) : (
        <span class={chunk[3] === 1 ? "uncertain" : ""}>
          {chunk[0]}{" "}
          <span class="hint" lang="ru">
            ({content.g[chunk[1]]}
            {chunk[2] != null ? " = " + content.g[chunk[2]] : ""})
          </span>
        </span>
      ),
    );
  }
  const renderFragment = useCallback(
    (chunks, address) => {
      const fragment = locate(content, address);
      return mode === "parallel" ? (
        (content.t?.[fragment.c]?.[fragment.f] || []).map((translation, i) => (
          <div class="focus-sentence">
            <p lang="de">{sentences(plain(chunks))[i]}</p>
            <p lang="ru" class="focus-translation">
              {translation}
            </p>
          </div>
        ))
      ) : (
        <>
          {mode === "frank" && <p lang="de">{hinted(chunks)}</p>}
          {(mode !== "frank" || showClean) && <p lang="de">{plain(chunks)}</p>}
        </>
      );
    },
    [content, mode, showClean],
  );
  return (
    <div
      class="focus-view"
      onPointerMove={reveal}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest(".focus-toolbar")) return;
        reveal();
        touch.current =
          event.pointerType === "touch" && event.isPrimary
            ? { x: event.clientX, y: event.clientY }
            : null;
      }}
      onPointerCancel={() => (touch.current = null)}
      onPointerUp={(event) => {
        const start = touch.current;
        touch.current = null;
        if (!start || window.getSelection()?.toString()) return;
        const dx = event.clientX - start.x,
          dy = event.clientY - start.y;
        if (Math.abs(dx) >= 70 && Math.abs(dx) > Math.abs(dy) * 1.5)
          navigate(dx < 0 ? 1 : -1);
      }}
    >
      <main
        class={"focus-reader" + (mode === "parallel" ? " focus-parallel" : "")}
        ref={main}
        tabIndex={-1}
        aria-label={t("Чтение без отвлечений")}
      >
        <BookFlow
          content={content}
          chapters={chapters}
          at={at}
          flow={flow}
          layoutKey={layoutKey}
          onPosition={onPosition}
        >
          {renderFragment}
        </BookFlow>
      </main>
      <div
        class={"focus-toolbar" + (controls ? " is-visible" : "")}
        role="toolbar"
        aria-label={t("Управление режимом чтения")}
        onFocusCapture={reveal}
        onPointerDown={reveal}
        onClick={(event) => {
          if (event.detail > 0) main.current?.focus({ preventScroll: true });
        }}
      >
        <button
          class="icon"
          aria-label={t("Предыдущий отрывок")}
          disabled={index === 0}
          onClick={() => navigate(-1)}
        >
          <Icon name="back" />
        </button>
        <span class="focus-counter" aria-live="polite">
          {index + 1} / {total}
        </span>
        <button
          class="icon"
          aria-label={
            index === total - 1 ? t("Завершить чтение") : t("Следующий отрывок")
          }
          onClick={() => navigate(1)}
        >
          <Icon name="next" />
        </button>
        <button
          class="focus-exit"
          aria-label={t("Выйти из режима чтения")}
          onClick={onExit}
        >
          <Icon name="close" />
          {t("Выйти")}
        </button>
      </div>
    </div>
  );
}
