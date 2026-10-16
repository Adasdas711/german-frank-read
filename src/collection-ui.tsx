import { useState } from "preact/hooks";
import type { Book } from "./core";
import type { BookCollection } from "./collections";
import { useT } from "./i18n";
import { Icon, Modal } from "./ui";
const COLLECTION = "application/x-franka-collection",
  BOOK = "application/x-franka-book";
type MenuProps = {
  collections: BookCollection[];
  books: Book[];
  active: string;
  onSelect(id: string): void;
  onCreate(): void;
  onManage(c: BookCollection): void;
  onReorder(id: string, before: string | null): void;
  onMoveBook(book: string, target: string): void;
};
export function CollectionMenu(props: MenuProps) {
  const t = useT();
  const [over, setOver] = useState("");
  return (
    <section class="collection-menu">
      <div class="collection-heading">
        <h3>{t("My Collections")}</h3>
        <button
          class="round quiet"
          aria-label={t("New Collection")}
          onClick={props.onCreate}
        >
          <Icon name="plus" size={15} />
        </button>
      </div>
      {props.collections.map((c) => (
        <div
          class={"collection-nav-row" + (over === c.id ? " drop-target" : "")}
          key={c.id}
          data-collection={c.id}
          draggable
          onDragStart={(e) => {
            if (!e.dataTransfer) return;
            e.dataTransfer.setData(COLLECTION, c.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            if (
              e.dataTransfer?.types.some((type) =>
                [COLLECTION, BOOK].includes(type),
              )
            ) {
              e.preventDefault();
              e.stopPropagation();
              setOver(c.id);
            }
          }}
          onDragLeave={() => setOver("")}
          onDrop={(e) => {
            const data = e.dataTransfer;
            if (!data) return;
            const book = data.getData(BOOK),
              collection = data.getData(COLLECTION);
            if (!book && !collection) return;
            e.preventDefault();
            e.stopPropagation();
            setOver("");
            if (book) props.onMoveBook(book, c.id);
            else props.onReorder(collection, c.id);
          }}
        >
          <button
            class={"sidebar-item" + (props.active === c.id ? " active" : "")}
            onClick={() => props.onSelect(c.id)}
          >
            <Icon name="collection" size={17} />
            <span>{c.name}</span>
            <small>
              {
                c.bookIds.filter((id) =>
                  props.books.some((b) => b.manifest.id === id),
                ).length
              }
            </small>
          </button>
          <button
            class="collection-manage round quiet"
            aria-label={t("Manage collection {0}", { 0: c.name })}
            onClick={() => props.onManage(c)}
          >
            ···
          </button>
        </div>
      ))}
      <button class="sidebar-item new-collection" onClick={props.onCreate}>
        <Icon name="plus" size={17} />
        {t("New Collection")}
      </button>
    </section>
  );
}
export function CollectionStrip(
  props: Pick<
    MenuProps,
    "collections" | "active" | "onSelect" | "onCreate" | "onManage"
  >,
) {
  const t = useT();
  return (
    <div class="collection-strip">
      <span>{t("My Collections")}</span>
      <div class="collection-chips">
        {props.collections.map((c) => (
          <button
            class={"pill" + (props.active === c.id ? " selected" : " glass")}
            aria-pressed={props.active === c.id}
            onClick={() => props.onSelect(c.id)}
          >
            {c.name}
          </button>
        ))}
        <button
          class="round glass"
          aria-label={t("New Collection")}
          onClick={props.onCreate}
        >
          <Icon name="plus" size={17} />
        </button>
        {props.active && (
          <button
            class="round glass"
            aria-label={t("Manage Collection")}
            onClick={() => {
              const c = props.collections.find((c) => c.id === props.active);
              if (c) props.onManage(c);
            }}
          >
            ···
          </button>
        )}
      </div>
    </div>
  );
}
export function CollectionEditor({
  collection,
  collections,
  books,
  initialBooks = [],
  onSave,
  onClose,
  onReorder,
  onDelete,
}: {
  collection: BookCollection | null;
  collections: BookCollection[];
  books: Book[];
  initialBooks?: string[];
  onSave: (name: string, bookIds: string[]) => Promise<void>;
  onClose: () => void;
  onReorder: (direction: number) => void;
  onDelete: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(collection?.name || ""),
    [chosen, setChosen] = useState(
      new Set(collection?.bookIds || initialBooks),
    ),
    [saving, setSaving] = useState(false);
  const index = collections.findIndex((c) => c.id === collection?.id);
  return (
    <Modal
      title={t(collection ? "Edit Collection" : "New Collection")}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || saving) return;
          setSaving(true);
          void onSave(name.trim(), [...chosen]).finally(() => setSaving(false));
        }}
      >
        <label class="collection-name-label">
          {t("Collection name")}
          <input
            autoFocus
            maxLength={80}
            aria-label={t("Collection name")}
            value={name}
            onInput={(e) => setName(e.currentTarget.value)}
            placeholder={t("Collection name")}
          />
        </label>
        {collection && (
          <div class="collection-order group">
            <span>{t("Order in menu")}</span>
            <button
              type="button"
              aria-label={t("Move Up")}
              disabled={index <= 0}
              onClick={() => onReorder(-1)}
            >
              <Icon name="up" size={16} />
              {t("Move Up")}
            </button>
            <button
              type="button"
              aria-label={t("Move Down")}
              disabled={index === collections.length - 1}
              onClick={() => onReorder(1)}
            >
              <Icon name="down" size={16} />
              {t("Move Down")}
            </button>
          </div>
        )}
        <h3 class="group-label">{t("Books in this collection")}</h3>
        <div class="collection-book-list group">
          {books.map((b) => (
            <label>
              <input
                type="checkbox"
                checked={chosen.has(b.manifest.id)}
                onChange={() =>
                  setChosen((previous) => {
                    const next = new Set(previous);
                    next.has(b.manifest.id)
                      ? next.delete(b.manifest.id)
                      : next.add(b.manifest.id);
                    return next;
                  })
                }
              />
              <span>
                {b.manifest.title}
                <small>{b.manifest.author}</small>
              </span>
            </label>
          ))}
          {!books.length && <p class="footnote">{t("Add your first book")}</p>}
        </div>
        <button
          class="primary wide"
          type="submit"
          disabled={!name.trim() || saving}
        >
          {t("Done")}
        </button>
        {collection && (
          <button type="button" class="wide quiet danger" onClick={onDelete}>
            {t("Delete Collection")}
          </button>
        )}
      </form>
    </Modal>
  );
}
export function MoveBookDialog({
  book,
  collections,
  onSave,
  onClose,
  onCreate,
}: {
  book: Book;
  collections: BookCollection[];
  onSave: (id: string | null) => Promise<void>;
  onClose: () => void;
  onCreate: () => void;
}) {
  const t = useT();
  const [id, setId] = useState(
    collections.find((c) => c.bookIds.includes(book.manifest.id))?.id || "",
  );
  return (
    <Modal title={t("Move to Collection")} onClose={onClose}>
      <p class="muted">{book.manifest.title}</p>
      <div class="group move-collection-list">
        {[{ id: "", name: t("All Books only") }, ...collections].map((c) => (
          <button aria-pressed={id === c.id} onClick={() => setId(c.id)}>
            <Icon name={c.id ? "collection" : "book"} size={18} />
            <span>{c.name}</span>
            {id === c.id && <Icon name="check" size={17} />}
          </button>
        ))}
      </div>
      <button class="wide quiet accent" onClick={onCreate}>
        <Icon name="plus" />
        {t("New Collection")}
      </button>
      <button class="wide primary" onClick={() => void onSave(id || null)}>
        {t("Move")}
      </button>
    </Modal>
  );
}
export function bookDrag(event: DragEvent, id: string) {
  if (!event.dataTransfer) return;
  event.dataTransfer.setData(BOOK, id);
  event.dataTransfer.effectAllowed = "move";
}
