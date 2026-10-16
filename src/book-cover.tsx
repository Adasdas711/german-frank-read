import type { Manifest } from "./core";
export function BookCover({
  manifest,
  small = false,
}: {
  manifest: Manifest;
  small?: boolean;
}) {
  const colors = [
    "#228a80",
    "#a53937",
    "#675084",
    "#32618b",
    "#598235",
    "#a37b40",
  ];
  const color =
    manifest.title === "Die Bremer Stadtmusikanten"
      ? colors[0]
      : manifest.title === "Rotkäppchen"
        ? colors[1]
        : manifest.title === "Die Verwandlung"
          ? colors[2]
          : colors[
              [...manifest.id].reduce((s, c) => s + c.charCodeAt(0), 0) %
                colors.length
            ];
  const letter = manifest.title
    .replace(/^(Die|Der|Das|Ein|Eine)\s+/, "")
    .charAt(0);
  return (
    <div
      class={"book-cover" + (small ? " small" : "")}
      style={{ "--cover": color }}
      aria-hidden="true"
    >
      <div class="cover-copy">
        <strong>{manifest.title}</strong>
        <small>{manifest.author}</small>
      </div>
      <span class="cover-letter">{letter}</span>
      <span class="cover-level">{manifest.level}</span>
    </div>
  );
}
