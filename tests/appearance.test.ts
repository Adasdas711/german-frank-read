import { describe, expect, it } from "vitest";
import { typesettingKey } from "../src/appearance";
import { defaults } from "../src/storage";

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
