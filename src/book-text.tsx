import type { Chunk, Content, Manifest } from "./core";
import { plain } from "./core";
import { memo } from "preact/compat";
import { useMemo } from "preact/hooks";
import { readingSentences } from "./reading-text";
export type WordSelection = {
  form: string;
  at: string;
  context: string;
  translation: string;
  hint: string;
};
export const BookText = memo(function BookText({
  chunks,
  address,
  content,
  manifest,
  mode,
  repeat,
  onWord,
}: {
  chunks: Chunk[];
  address: string;
  content: Content;
  manifest: Manifest;
  mode: string;
  repeat: boolean;
  onWord?: (w: WordSelection) => void;
}) {
  const source = plain(chunks),
    [ci, fi] = address.split(".").map((n) => +n - 1);
  const lines = useMemo(
    () => readingSentences(source, content.t?.[ci]?.[fi] || []),
    [source, content, ci, fi],
  );
  const phrase = (offset: number) => {
    const row = lines.find((row) => offset < row.end);
    return row
      ? { context: row.text, translation: row.translation }
      : {
          context: source,
          translation: lines.map((row) => row.translation).join(" "),
        };
  };
  const sourceHint = (offset: number) => {
    let start = 0;
    for (const chunk of chunks) {
      const value = typeof chunk === "string" ? chunk : chunk[0];
      if (
        offset >= start &&
        offset < start + value.length &&
        typeof chunk !== "string"
      )
        return (
          content.g[chunk[1]] +
          (chunk[2] != null ? " = " + content.g[chunk[2]] : "")
        );
      start += value.length;
    }
    return "";
  };
  const text = (s: string, base: number) => {
    let pos = base;
    return s
      .split(/([\p{L}\p{M}]+(?:[’'-][\p{L}\p{M}]+)*)/gu)
      .map((part, i) => {
        const offset = pos;
        pos += part.length;
        // The split captures words at odd indexes; avoid tokenizing each one a
        // second time when opening a complete novel.
        return i % 2 === 1 ? (
          <button
            key={i}
            class="word"
            lang={manifest.lang}
            data-book-char={offset}
          >
            {part}
          </button>
        ) : (
          part
        );
      });
  };
  // All modes share the same original-word nodes. Switching changes layout,
  // not thousands of interactive elements; source offsets and focus survive.
  const inlineText = useMemo(() => {
    let cursor = 0;
    const pieces = chunks.map((chunk) => {
      const value = typeof chunk === "string" ? chunk : chunk[0];
      const start = cursor;
      cursor += value.length;
      return { chunk, value, start, end: cursor };
    });
    let previous = 0;
    return lines.map((line, i) => {
      const start = previous,
        end = i === lines.length - 1 ? source.length : line.end;
      previous = end;
      const original = pieces
        .filter((piece) => piece.end > start && piece.start < end)
        .map((piece) => {
          const from = Math.max(start, piece.start),
            to = Math.min(end, piece.end);
          const hint =
            typeof piece.chunk === "string"
              ? ""
              : content.g[piece.chunk[1]] +
                (piece.chunk[2] != null
                  ? " = " + content.g[piece.chunk[2]]
                  : "");
          return (
            <span key={piece.start}>
              {text(source.slice(from, to), from)}
              {hint && to === piece.end && (
                <span class="hint" lang={manifest.hintLang}>
                  {" "}
                  ({hint})
                </span>
              )}
            </span>
          );
        });
      return (
        <span class="sentence-row parallel-row" key={line.start}>
          <span class="sentence-original" lang={manifest.lang}>
            {original}
          </span>
          <span class="translation" lang={manifest.hintLang}>
            {line.translation}
          </span>
        </span>
      );
    });
  }, [chunks, content, manifest, address, lines]);
  return (
    <div
      class="reading-columns"
      key="inline"
      onClick={
        onWord
          ? (event) => {
              const word = (event.target as Element).closest<HTMLElement>(
                "[data-book-char]",
              );
              if (!word || !event.currentTarget.contains(word)) return;
              const offset =
                Number(word.dataset.bookChar) % (source.length + 1);
              onWord({
                form: word.textContent || "",
                at: address,
                hint: sourceHint(offset),
                ...phrase(offset),
              });
            }
          : undefined
      }
    >
      <section class="reading-panel">
        <p lang={manifest.lang}>{inlineText}</p>
      </section>
      {mode === "frank" && repeat && (
        <section class="reading-panel repeat-panel">
          <p lang={manifest.lang}>{text(source, source.length + 1)}</p>
        </section>
      )}
    </div>
  );
});
