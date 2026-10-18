import { useMemo, useState } from "preact/hooks";
import type { SavedWord } from "./storage";
import { useT } from "./i18n";
import { Icon } from "./ui";

export function ReaderWords({
  words,
  onRemove,
  onClose,
}: {
  words: SavedWord[];
  onRemove(key: string): void;
  onClose(): void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const list = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return words.filter(
      (w) =>
        !needle ||
        [w.lemma, w.form, w.ru, w.context].some((text) =>
          text.toLocaleLowerCase().includes(needle),
        ),
    );
  }, [words, query]);
  return (
    <>
      <div class="row between">
        <h2>
          {t("Book words")} · {words.length}
        </h2>
        <button class="round" aria-label={t("Close")} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <input
        class="book-search"
        type="search"
        aria-label={t("Search saved words")}
        placeholder={t("Search saved words")}
        value={query}
        onInput={(e) => setQuery(e.currentTarget.value)}
      />
      <div class="reader-word-list">
        {list.map((word) => (
          <article
            class="reader-saved-word"
            key={word.key}
            data-word-key={word.key}
          >
            <details>
              <summary>
                <strong>{word.lemma}</strong>
                {word.ipa && <small class="muted">[{word.ipa}]</small>}
              </summary>
              <p>{word.ru}</p>
              <blockquote lang="de">{word.context}</blockquote>
              {word.contextTranslation && (
                <p class="muted">{word.contextTranslation}</p>
              )}
            </details>
            <p>{word.ru}</p>
            <button
              class="round danger"
              aria-label={t("Remove word {0}", { 0: word.lemma })}
              onClick={() => onRemove(word.key)}
            >
              <Icon name="trash" size={18} />
            </button>
          </article>
        ))}
        {!list.length && (
          <p class="muted">
            {t(words.length ? "No results" : "No saved words in this book")}
          </p>
        )}
      </div>
    </>
  );
}
