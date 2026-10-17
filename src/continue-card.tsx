import { useEffect, useRef } from "preact/hooks";
import type { Book } from "./core";
import { BookCover, bookColor } from "./book-cover";
import { useT } from "./i18n";
import { Icon, ContextMenu } from "./ui";

export function ContinueCard({
  book,
  percent,
  onOpen,
  onMenu,
}: {
  book: Book;
  percent: number;
  onOpen(): void;
  onMenu(x: number, y: number): void;
}) {
  const t = useT();
  const card = useRef<HTMLElement>(null);
  const openMenu = useRef(onMenu);
  openMenu.current = onMenu;
  const press = useRef<{
    id: number;
    x: number;
    y: number;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const suppressClick = useRef(false);
  const cancel = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const p = press.current;
      if (
        p &&
        event.pointerId === p.id &&
        Math.hypot(event.clientX - p.x, event.clientY - p.y) > 10
      )
        cancel();
    };
    const anotherFinger = (event: PointerEvent) => {
      // Some touch browsers omit the synthetic click after a long press. A
      // fresh physical interaction must still be able to use the open menu.
      suppressClick.current = false;
      if (press.current && event.pointerId !== press.current.id) cancel();
    };
    const click = (event: MouseEvent) => {
      // Suppress the release click even if the newly opened menu is its target.
      if (!suppressClick.current || event.detail === 0) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerdown", anotherFinger, true);
    document.addEventListener("click", click, true);
    document.addEventListener("pointerup", cancel);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("scroll", cancel, true);
    document.addEventListener("visibilitychange", cancel);
    window.addEventListener("blur", cancel);
    return () => {
      cancel();
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerdown", anotherFinger, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("pointerup", cancel);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("scroll", cancel, true);
      document.removeEventListener("visibilitychange", cancel);
      window.removeEventListener("blur", cancel);
    };
  }, []);
  const showMenu = () => {
    cancel();
    const r = card.current!.getBoundingClientRect();
    openMenu.current(r.left, r.bottom + 8);
  };
  return (
    <article
      ref={card}
      class="continue-card"
      data-book={book.manifest.id}
      style={{ "--reading-cover": bookColor(book.manifest) }}
      onPointerDown={(event) => {
        if (!event.isPrimary) {
          cancel();
          return;
        }
        suppressClick.current = false;
        if (
          event.pointerType === "mouse" ||
          event.button !== 0 ||
          (event.target as HTMLElement).closest(".continue-more")
        )
          return;
        cancel();
        press.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          timer: setTimeout(() => {
            suppressClick.current = true;
            showMenu();
          }, 500),
        };
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (press.current) suppressClick.current = true;
        cancel();
        if (event.clientX === 0 && event.clientY === 0) showMenu();
        else openMenu.current(event.clientX, event.clientY);
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
        onClick={showMenu}
      >
        <Icon name="more" />
      </button>
    </article>
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
