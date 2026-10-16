import { createContext } from "preact";
import { useContext, useMemo } from "preact/hooks";
import german from "./de.json";
import english from "./en.json";
import { bookLocales } from "./books-locales";
export type Language = "en" | "ru" | "de";
export const LocaleContext = createContext<Language>("en");
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
  const dictionary: Record<string, string> =
    language === "en" ? english : german;
  const key = text.replace(/\s+/g, " ").trim();
  if (bookLocales[key]) return format(bookLocales[key][language], params);
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
const messagePatterns = (dictionary: Record<string, string>) =>
  Object.entries(dictionary)
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
const messagePrefixes = (dictionary: Record<string, string>) =>
  Object.entries(dictionary)
    .filter(([key]) => key.length > 8 && !key.includes("{"))
    .sort((a, b) => b[0].length - a[0].length);
export function translateMessage(language: Language, text: string): string {
  const direct = translate(language, text);
  if (direct !== text) return direct;
  if (language === "ru" || !/[А-Яа-яЁё]/.test(text)) return text;
  for (const p of messagePatterns(language === "en" ? english : german)) {
    const match = p.regex.exec(text);
    if (match) {
      const params: Record<string, unknown> = {};
      p.names.forEach((name, i) => (params[name] = match[i + 1]));
      return format(p.value, params);
    }
  }
  for (const [key, value] of messagePrefixes(
    language === "en" ? english : german,
  ))
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
