import { readBook, type Book, type Content } from "./core";
import * as store from "./storage";
import type { Progress } from "./storage";
import { upgradeProgress } from "./book-upgrade";

export async function ensureDemos(
  packedBooks: string[],
  initializedKey = "initialized",
) {
  const initialized = await store.get("settings", initializedKey);
  for (const packed of packedBooks) {
    const bytes = Uint8Array.from(atob(packed), (c) => c.charCodeAt(0));
    const book = readBook(bytes);
    const old = await store.get<Book>("books", book.manifest.id);
    // A deliberately removed example stays removed. A user's newer edition wins.
    if (
      (!old && initialized) ||
      (old && old.manifest.revision >= book.manifest.revision)
    )
      continue;
    const progress = old
      ? await store.get<Progress>("progress", book.manifest.id)
      : undefined;
    let oldContent: Content | undefined;
    if (progress && old) {
      try {
        oldContent = readBook(old.bytes).content;
      } catch {
        /* Recover invalid old anchors without blocking startup. */
      }
    }
    const upgraded = progress
      ? upgradeProgress(progress, oldContent, book.content)
      : undefined;
    const db = await store.db();
    await new Promise<void>((resolve, reject) => {
      // Upgrade file and reading anchors together; vocabulary and memberships stay intact.
      const transaction = db.transaction(["books", "progress"], "readwrite");
      transaction.objectStore("books").put(
        {
          manifest: book.manifest,
          bytes,
          addedAt: old?.addedAt || new Date().toISOString(),
        },
        book.manifest.id,
      );
      if (upgraded)
        transaction.objectStore("progress").put(upgraded, book.manifest.id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
  if (!initialized) await store.put("settings", initializedKey, true);
}
