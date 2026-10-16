export type BookCollection = {
  id: string;
  name: string;
  bookIds: string[];
  updatedAt: string;
};
export function checkedCollections(value: unknown): BookCollection[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 200)
    throw Error("Invalid collections backup");
  const ids = new Set<string>();
  return value.map((c) => {
    if (
      !c ||
      typeof c.id !== "string" ||
      !c.id ||
      c.id.length > 160 ||
      ids.has(c.id) ||
      typeof c.name !== "string" ||
      !c.name.trim() ||
      c.name.trim().length > 80 ||
      !Array.isArray(c.bookIds) ||
      c.bookIds.length > 10000 ||
      !c.bookIds.every(
        (id) => typeof id === "string" && id.length > 0 && id.length <= 160,
      ) ||
      typeof c.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(c.updatedAt))
    )
      throw Error("Invalid collections backup");
    ids.add(c.id);
    return {
      id: c.id,
      name: c.name.trim(),
      bookIds: [...new Set(c.bookIds)] as string[],
      updatedAt: c.updatedAt,
    };
  });
}
export function moveCollection(
  list: BookCollection[],
  id: string,
  beforeId: string | null,
): BookCollection[] {
  const moving = list.find((c) => c.id === id);
  if (!moving || id === beforeId) return list;
  const rest = list.filter((c) => c.id !== id),
    index = beforeId ? rest.findIndex((c) => c.id === beforeId) : -1;
  rest.splice(index < 0 ? rest.length : index, 0, moving);
  return rest;
}
export function moveBookToCollection(
  list: BookCollection[],
  bookId: string,
  collectionId: string | null,
): BookCollection[] {
  if (collectionId && !list.some((c) => c.id === collectionId)) return list;
  const now = new Date().toISOString();
  return list.map((c) => {
    const next =
      c.id === collectionId
        ? [...new Set([...c.bookIds, bookId])]
        : c.bookIds.filter((id) => id !== bookId);
    return next.join("|") === c.bookIds.join("|")
      ? c
      : { ...c, bookIds: next, updatedAt: now };
  });
}
export function mergeCollections(
  current: BookCollection[],
  incoming: BookCollection[],
): BookCollection[] {
  const existing = new Map(current.map((c) => [c.id, c]));
  const merged = [
    ...incoming.map((c) => {
      const old = existing.get(c.id);
      existing.delete(c.id);
      return old && Date.parse(old.updatedAt) > Date.parse(c.updatedAt)
        ? old
        : c;
    }),
    ...existing.values(),
  ];
  if (merged.length > 200) throw Error("Collection limit reached");
  return merged;
}
