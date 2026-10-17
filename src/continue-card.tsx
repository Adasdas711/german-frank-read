import type { Book } from "./core";
import { BookCover, bookColor } from "./book-cover";
import { useT } from "./i18n";
import { Icon, ContextMenu } from "./ui";
import { BookSurface } from "./book-surface";

export function ContinueCard({
  book,
  percent,
  onOpen,
  onMenu,
  menuOpen,
}: {
  book: Book;
  percent: number;
  onOpen(): void;
  onMenu(x: number, y: number): void;
  menuOpen?: boolean;
}) {
  const t = useT();
  return (
    <BookSurface
      menuOpen={menuOpen}
      class="continue-card"
      data-book={book.manifest.id}
      style={{ "--reading-cover": bookColor(book.manifest) }}
      onHold={onMenu}
      onContextMenu={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onMenu(event.clientX || rect.left, event.clientY || rect.bottom + 8);
      }}
    >
      <button
        class="continue-open"
        aria-label={t("Continue reading {0}", { 0: book.manifest.title })}
        onClick={onOpen}
      >
        <BookCover manifest={book.manifest} small />
        <div class="continue-copy">
          <h3>{book.manifest.title}</h3>
          <p>{book.manifest.author}</p>
          <small class="continue-meta">
            {t("Book")} · {book.manifest.level} · {percent}%
          </small>
        </div>
      </button>
      <button
        class="continue-more quiet"
        aria-label={t("Book options for {0}", { 0: book.manifest.title })}
        aria-haspopup="menu"
        onClick={(event) => {
          const rect = event.currentTarget
            .closest("[data-book-surface]")!
            .getBoundingClientRect();
          onMenu(rect.left, rect.bottom + 8);
        }}
      >
        <Icon name="more" />
      </button>
    </BookSurface>
  );
}

export function ContinueMenu({
  x,
  y,
  wanted,
  onClose,
  onShare,
  onWant,
  onCollection,
  onFinish,
  onRename,
  onHide,
  onRemove,
  folders,
  onRemoveFolder,
}: {
  x: number;
  y: number;
  wanted: boolean;
  onClose(): void;
  onShare(): void;
  onWant(): void;
  onCollection(): void;
  onFinish(): void;
  onRename(): void;
  onHide(): void;
  onRemove(): void;
  folders: { id: string; name: string }[];
  onRemoveFolder(id: string): void;
}) {
  const t = useT();
  return (
    <>
      <div
        class="book-menu-backdrop"
        onPointerDown={onClose}
        aria-hidden="true"
      />
      <ContextMenu
        x={x}
        y={y}
        label={t("Book options")}
        className="continue-context-menu"
        onClose={onClose}
      >
        <div class="continue-menu-shortcuts">
          <button role="menuitem" class="quiet" onClick={onShare}>
            <Icon name="upload" size={24} />
            {t("Share")}
          </button>
          <button role="menuitem" class="quiet" onClick={onWant}>
            <Icon name={wanted ? "check-circle" : "plus-circle"} size={24} />
            {t(wanted ? "Remove from Want to Read" : "Want to Read")}
          </button>
        </div>
        <div role="separator" />
        <button role="menuitem" class="quiet" onClick={onCollection}>
          <Icon name="collection" />
          {t("Add to Collection")}
        </button>
        {folders.map((folder) => (
          <button
            role="menuitem"
            class="quiet"
            key={folder.id}
            onClick={() => onRemoveFolder(folder.id)}
          >
            <Icon name="minus-circle" />
            {t(
              folders.length > 1
                ? "Remove from folder {0}"
                : "Remove from Folder",
              { 0: folder.name },
            )}
          </button>
        ))}
        <button role="menuitem" class="quiet" onClick={onFinish}>
          <Icon name="check-circle" />
          {t("Mark as Finished")}
        </button>
        <div role="separator" />
        <button role="menuitem" class="quiet" onClick={onRename}>
          <Icon name="rename" />
          {t("Rename…")}
        </button>
        <div role="separator" />
        <button role="menuitem" class="quiet" onClick={onHide}>
          <Icon name="minus-circle" />
          {t("Remove from Continue")}
        </button>
        <button role="menuitem" class="quiet danger" onClick={onRemove}>
          <Icon name="trash" />
          {t("Remove…")}
        </button>
      </ContextMenu>
    </>
  );
}
