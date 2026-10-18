import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appearanceStyle,
  contrastRatio,
  hintColors,
  hintPalette,
  readingTheme,
  themes,
  typesettingKey,
} from "../src/appearance";
import { defaults } from "../src/storage";

describe("reading contrast", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(themes)("keeps all hint choices readable on $name", (theme) => {
    const settings = { ...defaults, readingTheme: theme.id };
    const palette = hintPalette(settings);
    expect(palette.map((choice) => choice.value)).toEqual(hintColors);
    expect(new Set(palette.map((choice) => choice.color)).size).toBe(5);
    for (const { value, color } of palette) {
      expect(contrastRatio(color, theme.paper)).toBeGreaterThanOrEqual(4.5);
      const style = appearanceStyle({ ...settings, hintColor: value });
      expect(style["--folio-hint"]).toBe(color);
      expect(style["--reader-accent"]).toBe(
        appearanceStyle(settings)["--reader-accent"],
      );
    }
    expect(
      contrastRatio(appearanceStyle(settings)["--folio-hint"], theme.paper),
    ).toBeGreaterThanOrEqual(4.5);
  });
  it("adapts legacy custom colors without changing the saved choice", () => {
    for (const hintColor of ["#fffffe", "#010101", "#e5e5ef", "#00ff99"])
      for (const { id: readingTheme, paper } of themes) {
        const settings = { ...defaults, readingTheme, hintColor };
        expect(
          contrastRatio(appearanceStyle(settings)["--folio-hint"], paper),
        ).toBeGreaterThanOrEqual(4.5);
        expect(settings.hintColor).toBe(hintColor);
      }
  });
  it("uses the effective system theme for both the palette and control colors", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const settings = {
      ...defaults,
      followSystem: true,
      hintColor: hintColors[1],
    };
    expect(readingTheme(settings).light).toBe(true);
    expect(appearanceStyle(settings)["color-scheme"]).toBe("light");
    expect(hintPalette(settings)).toEqual(
      hintPalette({ ...settings, followSystem: false, readingTheme: "paper" }),
    );
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(readingTheme(settings).light).toBe(false);
    expect(appearanceStyle(settings)["--folio-hint"]).toBe(hintColors[1]);
  });
});

describe("reader pagination cache", () => {
  it("reuses pages across colors, control sizes and page animations", () => {
    const original = typesettingKey(defaults, "frank");
    for (const readingTheme of ["night", "dusk", "forest", "paper"])
      for (const pageTurn of ["slide", "curl", "fade"] as const)
        expect(
          typesettingKey(
            {
              ...defaults,
              readingTheme,
              pageTurn,
              readingUiScale: 160,
              hintColor: "#ffe06a",
            },
            "frank",
          ),
        ).toBe(original);
  });
  it("invalidates pages when a theme changes text weight or text metrics change", () => {
    const original = typesettingKey(defaults, "frank");
    for (const change of [
      { readingTheme: "ink" },
      { bold: true },
      { fontSize: 24 },
      { font: "System" },
      { pageTurn: "scroll" as const },
      { hintSize: 1.1 },
    ])
      expect(typesettingKey({ ...defaults, ...change }, "frank")).not.toBe(
        original,
      );
    expect(typesettingKey(defaults, "parallel")).not.toBe(original);
  });
  it("ignores inactive custom-layout values until the layout is enabled", () => {
    const changed = { ...defaults, lineSpacing: 2, margins: 10 };
    expect(typesettingKey(changed, "frank")).toBe(
      typesettingKey(defaults, "frank"),
    );
    expect(
      typesettingKey({ ...changed, customLayout: true }, "frank"),
    ).not.toBe(typesettingKey(defaults, "frank"));
  });
});
