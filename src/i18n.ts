import { createContext } from "preact";
import { useContext, useMemo } from "preact/hooks";
import german from "./de.json";
export type Language = "ru" | "de";
export const LocaleContext = createContext<Language>("ru");
const dictionary: Record<string, string> = german;
function format(text: string, params: Record<string, unknown> = {}) {
  return text.replace(/\{(\d+)\}/g, (all, key) =>
    params[key] === undefined ? all : String(params[key]),
  );
}
export function translate(
  language: Language,
  text: string,
  params: Record<string, unknown> = {},
): string {
  const key = text.replace(/\s+/g, " ").trim();
  if (language === "ru" || !dictionary[key]) return format(text, params);
  return (
    (text.match(/^\s*/)?.[0] || "") +
    format(dictionary[key], params) +
    (text.match(/\s*$/)?.[0] || "")
  );
}
export const createTranslator =
  (language: Language) => (text: string, params?: Record<string, unknown>) =>
    translate(language, text, params);
export const useT = () => {
  const language = useContext(LocaleContext);
  return useMemo(() => createTranslator(language), [language]);
};
const patterns = Object.entries(dictionary)
  .filter(([key]) => /\{\d+\}/.test(key))
  .map(([key, value]) => {
    const parts = key.split(/(\{\d+\})/g);
    const names: string[] = [];
    const expression = parts
      .map((p) => {
        if (/^\{\d+\}$/.test(p)) {
          names.push(p.slice(1, -1));
          return "(.*?)";
        }
        return p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("");
    return { regex: new RegExp("^" + expression + "$"), value, names };
  });
const prefixes = Object.entries(dictionary)
  .filter(([key]) => key.length > 8 && !key.includes("{"))
  .sort((a, b) => b[0].length - a[0].length);
export function translateMessage(language: Language, text: string): string {
  if (language === "ru" || !/[А-Яа-яЁё]/.test(text)) return text;
  const direct = translate(language, text);
  if (direct !== text) return direct;
  for (const p of patterns) {
    const match = p.regex.exec(text);
    if (match) {
      const params: Record<string, unknown> = {};
      p.names.forEach((name, i) => (params[name] = match[i + 1]));
      return format(p.value, params);
    }
  }
  for (const [key, value] of prefixes)
    if (text.startsWith(key) && /^[:\s\d]/.test(text.slice(key.length)))
      return value + text.slice(key.length);
  const colon = text.indexOf(": ");
  if (colon > 0)
    return (
      text.slice(0, colon + 2) +
      translateMessage(language, text.slice(colon + 2))
    );
  return text;
}
