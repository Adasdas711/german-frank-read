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
const lightHintColors = ["#17695e", "#795800", "#984327", "#6d459c", "#405f7b"];
const rgb = (hex: string) =>
  [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
const luminance = (hex: string) => {
  const channels = rgb(hex).map((value) => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
export function contrastRatio(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function readingTheme(s: Settings) {
  const selected = s.followSystem
    ? matchMedia("(prefers-color-scheme: light)").matches
      ? themes[6]
      : themes[0]
    : themes.find((theme) => theme.id === s.readingTheme) || themes[0];
  return { ...selected, light: luminance(selected.paper) > 0.5 };
}
// Preserve the chosen hue while making old/custom colors readable too.
function readableHint(color: string, paper: string) {
  if (contrastRatio(color, paper) >= 4.5) return color;
  const from = rgb(color),
    target = luminance(paper) > 0.5 ? 0 : 255;
  const mix = (amount: number) =>
    "#" +
    from
      .map((value) =>
        Math.round(value + (target - value) * amount)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
  let low = 0,
    high = 1;
  for (let i = 0; i < 16; i++) {
    const middle = (low + high) / 2;
    if (contrastRatio(mix(middle), paper) >= 4.5) high = middle;
    else low = middle;
  }
  return mix(high);
}
export function hintPalette(s: Settings) {
  const theme = readingTheme(s);
  return hintColors.map((value, i) => ({
    value,
    color: readableHint(theme.light ? lightHintColors[i] : value, theme.paper),
  }));
}
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
  const selected = readingTheme(s);
  const chosen = hintColors.indexOf(s.hintColor.toLowerCase());
  const hint =
    chosen >= 0 && selected.light
      ? lightHintColors[chosen]
      : s.hintColor || selected.hint;
  return {
    "color-scheme": selected.light ? "light" : "dark",
    "--ui-scale": (s.readingUiScale / 100) * 1.08,
    "--reading-ui-scale": (s.readingUiScale / 100) * 1.08,
    "--folio-paper": selected.paper,
    "--folio-ink": selected.ink,
    "--folio-muted": selected.ink + "a8",
    "--folio-hint": readableHint(hint, selected.paper),
    "--reader-accent": selected.light
      ? readableHint("#17695e", selected.paper)
      : selected.hint,
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
