import type { Settings } from "./storage";
export const fonts = [
  "Literata",
  "Lora",
  "Merriweather",
  "PT Serif",
  "Source Serif 4",
  "Noto Serif",
  "Inter",
  "PT Sans",
  "Golos Text",
  "System",
];
export const themes = [
  {
    id: "night",
    name: "Night",
    paper: "#080909",
    ink: "#e8e8e6",
    hint: "#5dc9b9",
  },
  {
    id: "dusk",
    name: "Dusk",
    paper: "#28272d",
    ink: "#f2e9df",
    hint: "#c4abe9",
  },
  { id: "ink", name: "Ink", paper: "#000000", ink: "#ffffff", hint: "#ffe06a" },
  {
    id: "forest",
    name: "Forest",
    paper: "#122820",
    ink: "#e8efe6",
    hint: "#9cdbb4",
  },
  {
    id: "sepia",
    name: "Sepia",
    paper: "#ead9b9",
    ink: "#3f3025",
    hint: "#7b4837",
  },
  {
    id: "sand",
    name: "Sand",
    paper: "#f1e8d5",
    ink: "#433b30",
    hint: "#786332",
  },
  {
    id: "paper",
    name: "Paper",
    paper: "#fffef9",
    ink: "#252524",
    hint: "#26766b",
  },
  {
    id: "mist",
    name: "Mist",
    paper: "#e2e8ec",
    ink: "#243440",
    hint: "#46658e",
  },
];
export const hintColors = [
  "#5dc9b9",
  "#ffe06a",
  "#f0ad87",
  "#bcadf7",
  "#aeb9c5",
];
export const themeDefaults = {
  font: "Literata",
  bold: false,
  hintColor: "",
  hintSize: 0.86,
  hintItalic: false,
  customLayout: false,
  lineSpacing: 1.65,
  letterSpacing: 0,
  wordSpacing: 0,
  margins: 6,
  columns: "auto",
  justify: true,
} as const;
export function appearanceStyle(s: Settings) {
  const theme = themes.find((t) => t.id === s.readingTheme) || themes[0];
  const selected = s.followSystem
    ? matchMedia("(prefers-color-scheme: light)").matches
      ? themes[6]
      : themes[0]
    : theme;
  return {
    "--ui-scale": (s.readingUiScale / 100) * 1.08,
    "--reading-ui-scale": (s.readingUiScale / 100) * 1.08,
    "--folio-paper": selected.paper,
    "--folio-ink": selected.ink,
    "--folio-muted": selected.ink + "a8",
    "--folio-hint": s.hintColor || selected.hint,
    "--reading":
      s.font === "System"
        ? "system-ui, sans-serif"
        : `"${s.font}", ${["Inter", "PT Sans", "Golos Text"].includes(s.font) ? "sans-serif" : "serif"}`,
    "--size": s.fontSize + "px",
    "--line": s.customLayout ? s.lineSpacing : 1.65,
    "--letters": (s.customLayout ? s.letterSpacing : 0) + "em",
    "--words": (s.customLayout ? s.wordSpacing : 0) + "em",
    "--margins": (s.customLayout ? s.margins : 6) + "vw",
    "--hint-size": s.hintSize + "em",
    "--hint-style": s.hintItalic ? "italic" : "normal",
    "--weight": s.bold || selected.id === "ink" ? 650 : 400,
    "--justify": s.justify ? "justify" : "start",
  };
}

// Shared by the live reader and library page-index cache. Visual preferences
// such as colors, control size and Slide/Curl do not change text geometry.
export function typesettingKey(settings: Settings, mode: string) {
  const appearance = appearanceStyle(settings);
  return JSON.stringify([
    mode,
    settings.columns,
    settings.pageTurn === "scroll",
    ...[
      "--reading",
      "--size",
      "--line",
      "--letters",
      "--words",
      "--margins",
      "--hint-size",
      "--hint-style",
      "--weight",
      "--justify",
    ].map((key) => appearance[key]),
  ]);
}
