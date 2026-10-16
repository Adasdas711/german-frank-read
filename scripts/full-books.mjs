// Keep original uploaded archives intact and retain the site's established UUIDs.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readBook } from "../src/core.ts";
import { zipSync, strToU8 } from "fflate";
const catalog = JSON.parse(await readFile("books/catalog.json", "utf8"));
const embedded = [];
for (const item of catalog) {
  const original = new Uint8Array(await readFile(item.source));
  if (createHash("sha256").update(original).digest("hex") !== item.sha256)
    throw Error("Source checksum mismatch: " + item.source);
  const { manifest, content } = readBook(original);
  if (
    manifest.id !== item.sourceId ||
    manifest.title !== item.title ||
    JSON.stringify(manifest.stats) !== JSON.stringify(item.stats)
  )
    throw Error("Unexpected source edition: " + item.source);
  const updated = { ...manifest, id: item.id, revision: item.revision };
  const bytes = zipSync(
    {
      mimetype: [strToU8("application/vnd.fbook+zip"), { level: 0 }],
      "manifest.json": strToU8(JSON.stringify(updated)),
      "book.json": strToU8(JSON.stringify(content)),
    },
    { level: 9, mtime: new Date("1980-01-01T00:00:00Z") },
  );
  readBook(bytes);
  await writeFile("books/" + item.file, bytes);
  embedded.push(Buffer.from(bytes).toString("base64"));
  console.log(
    item.title,
    manifest.stats.words + " words",
    manifest.chapters.length + " chapters",
  );
}
await writeFile("src/demos.json", JSON.stringify(embedded) + "\n");
