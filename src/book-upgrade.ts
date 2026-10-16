import { plain, WORD, type Content } from "./core";
import type { Progress } from "./storage";

type Token = { form: string; at: string; offset: number; end: number };
function index(content: Content) {
  const tokens: Token[] = [],
    blocks = new Map<string, string>();
  content.c.forEach((chapter, ci) =>
    chapter.forEach((fragment, fi) => {
      const at = `${ci + 1}.${fi + 1}`,
        text = plain(fragment);
      blocks.set(at, text);
      for (const match of text.matchAll(WORD))
        tokens.push({
          form: match[0]
            .normalize("NFC")
            .toLocaleLowerCase("de")
            .replaceAll("ß", "ss"),
          at,
          offset: match.index!,
          end: match.index! + match[0].length,
        });
    }),
  );
  return { tokens, blocks };
}
// Fragment numbers change between editions. Prefer an actual text anchor rather
// than carrying a demo's fragment number into an unrelated full-book paragraph.
export function upgradeProgress(
  progress: Progress,
  oldContent: Content | undefined,
  newContent: Content,
): Progress {
  const next = index(newContent),
    old = oldContent && index(oldContent);
  const firstAt = next.blocks.keys().next().value || "1.1";
  const candidates = new Map<string, number[]>();
  next.tokens.forEach((token, i) => {
    const entries = candidates.get(token.form) || [];
    entries.push(i);
    candidates.set(token.form, entries);
  });
  const locate = (at: string, offset = 0) => {
    const source = old?.blocks.get(at),
      local = source ? offset % (source.length + 1) : offset;
    let target =
      old?.tokens.findIndex((token) => token.at === at && token.end > local) ??
      -1;
    if (target < 0 && old) {
      for (let i = old.tokens.length - 1; i >= 0; i--)
        if (old.tokens[i].at === at) {
          target = i;
          break;
        }
    }
    if (old && target >= 0) {
      for (const size of [12, 8, 5, 3]) {
        let best: { token: number; distance: number } | undefined;
        for (const start of new Set([
          target,
          Math.max(0, target - Math.floor(size / 2)),
          Math.max(0, target - size + 1),
        ])) {
          const phrase = old.tokens.slice(start, start + size);
          if (phrase.length !== size) continue;
          for (const candidate of candidates.get(phrase[0].form) || []) {
            if (
              !phrase.every(
                (token, i) => next.tokens[candidate + i]?.form === token.form,
              )
            )
              continue;
            const found = candidate + target - start;
            const distance = Math.abs(
              found / Math.max(1, next.tokens.length) -
                target / Math.max(1, old.tokens.length),
            );
            if (!best || distance < best.distance)
              best = { token: found, distance };
          }
        }
        if (best) {
          const token = next.tokens[best.token],
            inside = Math.max(0, local - old.tokens[target].offset);
          return {
            at: token.at,
            offset:
              token.offset + Math.min(inside, token.end - token.offset - 1),
            token: best.token,
          };
        }
      }
    }
    const validAt = next.blocks.has(at) ? at : firstAt,
      text = next.blocks.get(validAt)!;
    const validOffset = Math.max(0, Math.min(local, text.length));
    return {
      at: validAt,
      offset: validOffset,
      token: Math.max(
        0,
        next.tokens.findIndex(
          (token) => token.at === validAt && token.end > validOffset,
        ),
      ),
    };
  };
  const position = locate(progress.at, progress.offset);
  return {
    ...progress,
    at: position.at,
    offset: position.offset,
    percent:
      progress.percent === 100
        ? 100
        : Math.min(
            99,
            Math.round(
              (position.token / Math.max(1, next.tokens.length)) * 100,
            ),
          ),
    ...(progress.bookmarks
      ? {
          bookmarks: progress.bookmarks.map((mark) => {
            const mapped = locate(mark.at, mark.offset);
            return { ...mark, at: mapped.at, offset: mapped.offset };
          }),
        }
      : {}),
  };
}
