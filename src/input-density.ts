import { useEffect, useState } from "preact/hooks";

// A mouse or trackpad needs smaller targets than a finger. The interface size
// settings (100% by default) are relative to the size recommended for the
// current input, so "100%" is compact on a computer and roomy on a phone.
const FINE = "(hover: hover) and (pointer: fine)";
export const fineInput = () =>
  typeof matchMedia === "function" && matchMedia(FINE).matches;
// Library and settings; the reader's controls have their own base.
export const appBase = (fine = fineInput()) => (fine ? 1 : 1.25);
export const readerBase = (fine = fineInput()) => (fine ? 0.9 : 1.08);

// Re-render when a mouse is attached to or removed from a tablet.
export function useFineInput() {
  const [fine, setFine] = useState(fineInput);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia(FINE),
      change = () => setFine(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return fine;
}
