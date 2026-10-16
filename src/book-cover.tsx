import type { Manifest } from "./core";
export function BookCover({
  manifest,
  small = false,
}: {
  manifest: Manifest;
  small?: boolean;
}) {
  const title = manifest.title;
  const variant =
    title === "Rotkäppchen"
      ? "red"
      : title === "Die Verwandlung"
        ? "ink"
        : title === "Die Bremer Stadtmusikanten"
          ? "sage"
          : ["ochre", "red", "sage", "ink"][
              [...manifest.id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 4
            ];
  const longest = Math.max(...title.split(/\s+/).map((word) => word.length));
  return (
    <div
      class={"book-cover cover-" + variant + (small ? " small" : "")}
      aria-hidden="true"
    >
      <div class="cover-author">{manifest.author}</div>
      <div
        class="cover-name"
        style={{ fontSize: Math.min(22, 160 / longest) + "cqw" }}
      >
        {title}
      </div>
      <div class="cover-illustration">
        <span />
        <span />
        <span />
      </div>
      <div class="cover-footer">
        {manifest.lang.toUpperCase()} · {manifest.level}
      </div>
    </div>
  );
}
