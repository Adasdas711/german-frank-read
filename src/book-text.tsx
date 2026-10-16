import type { Chunk, Content, Manifest } from "./core";
import { plain, words, sentences } from "./core";
export type WordSelection = {
  form: string;
  at: string;
  context: string;
  translation: string;
  hint: string;
};
export function BookText({
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
  const lines = sentences(source),
    translations = content.t?.[ci]?.[fi] || [];
  const phrase = (offset: number) => {
    let cursor = 0;
    for (let i = 0; i < lines.length; i++) {
      const start = source.indexOf(lines[i], cursor);
      cursor = start + lines[i].length;
      if (offset < cursor)
        return { context: lines[i], translation: translations[i] || "" };
    }
    return { context: source, translation: translations.join(" ") };
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
  const text = (s: string, base: number, hint = "") => {
    let pos = base;
    return s
      .split(/([\p{L}\p{M}]+(?:[’'-][\p{L}\p{M}]+)*)/gu)
      .map((part, i) => {
        const offset = pos;
        pos += part.length;
        return words(part).length ? (
          <button
            key={i}
            class="word"
            lang={manifest.lang}
            data-book-char={offset}
            onClick={() =>
              onWord?.({
                form: part,
                at: address,
                hint: hint || sourceHint(offset % (source.length + 1)),
                ...phrase(offset % (source.length + 1)),
              })
            }
          >
            {part}
          </button>
        ) : (
          part
        );
      });
  };
  const annotated = () => {
    let pos = 0;
    return chunks.map((chunk, i) => {
      const start = pos;
      pos += typeof chunk === "string" ? chunk.length : chunk[0].length;
      if (typeof chunk === "string") return text(chunk, start);
      const hint =
        content.g[chunk[1]] +
        (chunk[2] != null ? " = " + content.g[chunk[2]] : "");
      return (
        <span key={i}>
          {text(chunk[0], start, hint)}{" "}
          <span class="hint" lang={manifest.hintLang}>
            ({hint})
          </span>
        </span>
      );
    });
  };
  if (mode === "parallel") {
    let cursor = 0;
    return (
      <section class="reading-panel parallel-panel">
        {lines.map((line, i) => {
          const start = source.indexOf(line, cursor);
          cursor = start + line.length;
          return (
            <div class="parallel-row">
              <p lang={manifest.lang}>{text(line, start, translations[i])}</p>
              <p class="translation" lang={manifest.hintLang}>
                {translations[i]}
              </p>
            </div>
          );
        })}
      </section>
    );
  }
  return (
    <div class="reading-columns">
      <section class="reading-panel">
        <p lang={manifest.lang}>
          {mode === "frank" ? annotated() : text(source, 0)}
        </p>
      </section>
      {mode === "frank" && repeat && (
        <section class="reading-panel repeat-panel">
          <p lang={manifest.lang}>{text(source, source.length + 1)}</p>
        </section>
      )}
    </div>
  );
}
