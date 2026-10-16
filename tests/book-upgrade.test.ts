import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { readBook, plain } from "../src/core";
import { upgradeProgress } from "../src/book-upgrade";
import type { Progress } from "../src/storage";
const old = JSON.parse(
  readFileSync("tests/fixtures/legacy-books.json", "utf8"),
).map((data: string) => readBook(new Uint8Array(Buffer.from(data, "base64"))));
const full = [
  "die-bremer-stadtmusikanten",
  "rotkappchen",
  "die-verwandlung",
].map((name) =>
  readBook(new Uint8Array(readFileSync("books/" + name + "-demo.fbook"))),
);
const base: Progress = {
  book: old[0].manifest.id,
  at: "1.2",
  offset: 0,
  percent: 33,
  mode: "parallel",
  updatedAt: "2026-10-16T10:00:00Z",
};
function at(book: (typeof full)[0], value: { at: string; offset?: number }) {
  const [c, f] = value.at.split(".").map((n) => +n - 1);
  return plain(book.content.c[c][f]).slice(value.offset || 0);
}
describe("edition upgrade", () => {
  it("anchors Grimm progress to the corresponding text despite merged and rewritten paragraphs", () => {
    const mapped = upgradeProgress(base, old[0].content, full[0].content);
    expect(mapped.at).toBe("1.1");
    expect(at(full[0], mapped)).toMatch(/^Da dachte der Herr daran/);
    const red = upgradeProgress(
      { ...base, book: old[1].manifest.id },
      old[1].content,
      full[1].content,
    );
    expect(red.at).toBe("1.1");
    expect(at(full[1], red)).toMatch(/^Einmal schenkte/);
  });
  it("transfers bookmarks and completed state without changing identifiers or dates", () => {
    const progress = {
      ...base,
      percent: 100,
      bookmarks: [{ at: "1.2", offset: 0, createdAt: base.updatedAt }],
    };
    const mapped = upgradeProgress(progress, old[0].content, full[0].content);
    expect(mapped.percent).toBe(100);
    expect(mapped.book).toBe(base.book);
    expect(mapped.updatedAt).toBe(base.updatedAt);
    expect(at(full[0], mapped.bookmarks![0])).toMatch(
      /^Da dachte der Herr daran/,
    );
    expect(mapped.bookmarks![0].createdAt).toBe(base.updatedAt);
  });
  it("keeps Kafka anchors inside the corresponding original text of the full first part", () => {
    const text = plain(old[2].content.c[0][1]),
      offset = text.indexOf("panzerartig");
    expect(offset).toBeGreaterThan(0);
    const mapped = upgradeProgress(
      { ...base, book: old[2].manifest.id, at: "1.2", offset },
      old[2].content,
      full[2].content,
    );
    expect(mapped.at).toBe("1.1");
    expect(at(full[2], mapped)).toMatch(/^panzerartig harten Rücken/);
  });
  it("recovers invalid old addresses without blocking the library", () => {
    const mapped = upgradeProgress(
      { ...base, at: "8.100", offset: 999999 },
      undefined,
      full[0].content,
    );
    expect(mapped.at).toBe("1.1");
    expect(mapped.offset).toBeLessThanOrEqual(
      plain(full[0].content.c[0][0]).length,
    );
  });
});
