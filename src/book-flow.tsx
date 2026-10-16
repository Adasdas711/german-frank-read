import { useLayoutEffect, useRef, useMemo } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { useT } from "./i18n";
import type { Content, Chunk } from "./core";

export type ReadingFlow = "blocks" | "continuous";
type Props = {
  content: Content;
  chapters: string[];
  at: string;
  flow: ReadingFlow;
  layoutKey: string;
  onPosition(at: string): void;
  children(chunks: Chunk[], at: string): ComponentChildren;
};

// Scroll changes the bookmark without navigating or moving the document.
// Explicit navigation, restored bookmarks and layout changes align the text again.
export function BookFlow({
  content,
  chapters,
  at,
  flow,
  layoutKey,
  onPosition,
  children,
}: Props) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const reported = useRef<string | null>(null);
  const callback = useRef(onPosition);
  const previousLayout = useRef("");
  const previousContent = useRef<Content | null>(null);
  const aligning = useRef(false);
  callback.current = onPosition;
  const top = () =>
    (document.querySelector(".reader-header")?.getBoundingClientRect().height ||
      40) + 24;
  useLayoutEffect(() => {
    if (flow !== "continuous") {
      reported.current = null;
      previousLayout.current = "";
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    const shouldAlign =
      reported.current !== at ||
      previousLayout.current !== layoutKey ||
      previousContent.current !== content;
    reported.current = at;
    previousLayout.current = layoutKey;
    previousContent.current = content;
    if (!shouldAlign) return;
    const align = () => {
      const node = root.current?.querySelector<HTMLElement>(
        `[data-reading-at="${at}"]`,
      );
      if (node) {
        const y =
          at === "1.1"
            ? 0
            : window.scrollY + node.getBoundingClientRect().top - top();
        window.scrollTo({ top: Math.max(0, y), behavior: "instant" });
      }
    };
    aligning.current = true;
    align();
    const frame = requestAnimationFrame(() => {
      align();
      aligning.current = false;
    });
    return () => {
      cancelAnimationFrame(frame);
      aligning.current = false;
    };
  }, [at, flow, layoutKey, content]);
  useLayoutEffect(() => {
    if (flow !== "continuous") return;
    const nodes = [
      ...root.current!.querySelectorAll<HTMLElement>("[data-reading-at]"),
    ];
    let frame = 0;
    const scroll = () => {
      if (frame || aligning.current) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const edge = top() + 2;
        let current = nodes[0],
          left = 0,
          right = nodes.length - 1;
        while (left <= right) {
          const middle = (left + right) >>> 1;
          if (nodes[middle].getBoundingClientRect().top <= edge) {
            current = nodes[middle];
            left = middle + 1;
          } else right = middle - 1;
        }
        if (
          window.scrollY > 0 &&
          window.scrollY + window.innerHeight >=
            document.documentElement.scrollHeight - 2
        )
          current = nodes[nodes.length - 1];
        const next = current?.dataset.readingAt;
        if (next && next !== reported.current) {
          reported.current = next;
          callback.current(next);
        }
      });
    };
    window.addEventListener("scroll", scroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", scroll);
      cancelAnimationFrame(frame);
    };
  }, [content, flow]);
  const pages = useMemo(
    () =>
      content.c.map((chapter, ci) => {
        const fragments = chapter
          .map((chunks, fi) => ({ chunks, at: `${ci + 1}.${fi + 1}` }))
          .filter((fragment) => flow === "continuous" || fragment.at === at);
        if (!fragments.length) return null;
        return (
          <section class="book-chapter" key={ci}>
            {flow === "continuous" && (
              <h2 class="chapter-heading">
                {chapters[ci] || t("Глава ") + (ci + 1)}
              </h2>
            )}
            {fragments.map((fragment) => (
              <section
                class="book-fragment"
                key={fragment.at}
                data-reading-at={fragment.at}
                aria-label={t("Отрывок {0}", { 0: fragment.at })}
              >
                {children(fragment.chunks, fragment.at)}
              </section>
            ))}
          </section>
        );
      }),
    [
      content,
      chapters.join("\n"),
      flow,
      flow === "blocks" ? at : null,
      children,
      t,
    ],
  );
  return (
    <div class={"book-flow " + flow} ref={root} data-flow={flow}>
      {pages}
    </div>
  );
}
