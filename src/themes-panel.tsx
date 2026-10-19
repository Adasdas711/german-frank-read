import { SettingsGroup } from "./settings-group";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Settings } from "./storage";
import {
  themes,
  fonts,
  hintPalette,
  contrastRatio,
  appearanceStyle,
  themeDefaults,
  readingTheme,
} from "./appearance";
import { useT } from "./i18n";
import { Icon, Toggle } from "./ui";
import { ReaderPresence } from "./reader-presence";
import { InterfaceSize } from "./interface-size";

export function ThemesPanel({
  settings,
  onChange,
  onClose,
}: {
  settings: Settings;
  onChange: (p: Partial<Settings>) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [view, setView] = useState<"themes" | "custom" | "font">("themes");
  const draft = settings;
  const activeTheme = readingTheme(settings);
  const [turnOpen, setTurnOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const firstView = useRef(true);
  useLayoutEffect(() => {
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    if (!panel.current?.closest(".books-reader")) return;
    const animation = panel.current?.animate(
      [{ opacity: 0.35 }, { opacity: 1 }],
      { duration: 180, easing: "ease-out" },
    );
    return () => animation?.cancel();
  }, [view]);
  const turnControl = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!turnOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!turnControl.current?.contains(event.target as Node))
        setTurnOpen(false);
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
    };
  }, [turnOpen]);
  const update = onChange;
  const range = (
    label: string,
    key: keyof Settings,
    min: number,
    max: number,
    step: number,
  ) => (
    <label class="range-row">
      {t(label)}
      <span>{draft[key]}</span>
      <input
        aria-label={t(label)}
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft[key] as number}
        style={{
          "--range-fill": `${((Number(draft[key]) - min) / (max - min)) * 100}%`,
        }}
        onInput={(e) => update({ [key]: +e.currentTarget.value })}
      />
    </label>
  );
  return (
    <div class="themes-panel" ref={panel}>
      <div class="sheet-heading">
        <button
          class="round"
          aria-label={t(view === "themes" ? "Close" : "Back")}
          onClick={() =>
            view === "font"
              ? setView("custom")
              : view === "custom"
                ? setView("themes")
                : onClose()
          }
        >
          <Icon name={view === "themes" ? "close" : "back"} />
        </button>
        <strong>
          {t(
            view === "themes"
              ? "Themes"
              : view === "font"
                ? "Font"
                : "Customize Theme",
          )}
        </strong>
        {view !== "themes" ? (
          <button
            class="round done"
            aria-label={t("Done")}
            onClick={() => {
              setView("themes");
            }}
          >
            <Icon name="check" />
          </button>
        ) : (
          <span />
        )}
      </div>
      {view === "themes" ? (
        <>
          <div class="appearance-tools glass-group">
            <button
              aria-label={t("Smaller")}
              disabled={settings.fontSize <= 14}
              onClick={() =>
                onChange({ fontSize: Math.max(14, settings.fontSize - 1) })
              }
            >
              A
            </button>
            <button
              aria-label={t("Larger")}
              onClick={() =>
                onChange({ fontSize: Math.min(36, settings.fontSize + 1) })
              }
              style={{ fontSize: "calc(22px * var(--ui-scale))" }}
            >
              A
            </button>
            <div
              class="page-turn-control"
              ref={turnControl}
              onKeyDown={(event) => {
                if (event.key === "Escape" && turnOpen) {
                  event.stopPropagation();
                  setTurnOpen(false);
                  turnControl.current
                    ?.querySelector<HTMLButtonElement>("button")
                    ?.focus({ preventScroll: true });
                }
              }}
            >
              <button
                aria-label={t("Page turning")}
                aria-haspopup="menu"
                aria-expanded={turnOpen}
                onClick={() => setTurnOpen(!turnOpen)}
              >
                <Icon
                  name={settings.pageTurn === "scroll" ? "scroll" : "pages"}
                />
              </button>
              <ReaderPresence>
                {turnOpen && (
                  <div
                    class="turn-menu glass"
                    role="menu"
                    aria-label={t("Page turning")}
                  >
                    {[
                      ["slide", "Slide", "slide"],
                      ["curl", "Curl", "pages"],
                      ["fade", "Fast Fade", "fade"],
                      ["scroll", "Scroll", "scroll"],
                    ].map(([id, label, icon]) => (
                      <button
                        role="menuitemradio"
                        aria-checked={settings.pageTurn === id}
                        onClick={() => {
                          setTurnOpen(false);
                          onChange({ pageTurn: id as Settings["pageTurn"] });
                          turnControl.current
                            ?.querySelector<HTMLButtonElement>("button")
                            ?.focus({ preventScroll: true });
                        }}
                      >
                        <Icon name={icon} />
                        <span>{t(label)}</span>
                        {settings.pageTurn === id && <Icon name="check" />}
                      </button>
                    ))}
                  </div>
                )}
              </ReaderPresence>
            </div>
            <button
              aria-label={t("Follow system appearance")}
              aria-pressed={settings.followSystem}
              onClick={() => onChange({ followSystem: !settings.followSystem })}
            >
              <Icon name="moon" />
            </button>
          </div>
          <div class="theme-grid">
            {themes.map((theme) => (
              <button
                class="theme-tile"
                aria-label={theme.name}
                aria-pressed={activeTheme.id === theme.id}
                onClick={() =>
                  onChange({
                    readingTheme: theme.id,
                    followSystem: false,
                    hintColor: "",
                  })
                }
                style={{
                  background: theme.paper,
                  color: theme.ink,
                  "--choice-paper": theme.paper,
                  "--choice-ink": theme.ink,
                }}
              >
                <span>Aa</span>
                <i style={{ color: theme.hint }}>•••</i>
                <small>{theme.name}</small>
              </button>
            ))}
          </div>
          <button
            class="wide glass-group"
            onClick={() => {
              setView("custom");
            }}
          >
            <Icon name="sliders" />
            {t("Customize")}
          </button>
        </>
      ) : (
        <>
          <div
            class="theme-preview"
            aria-label={t("Theme preview")}
            style={appearanceStyle(draft)}
          >
            <b>Aa</b>
            <p>
              Es hatte ein Mann einen Esel{" "}
              <span class="hint">(был у одного человека осёл)</span>, der schon
              lange Jahre die Säcke unverdrossen{" "}
              <span class="hint">(без устали)</span> zur Mühle getragen hatte.
            </p>
          </div>
          {view === "font" ? (
            <div class="group font-list">
              {fonts.map((font) => (
                <button
                  style={{
                    fontFamily: font === "System" ? "system-ui" : `"${font}"`,
                  }}
                  aria-pressed={draft.font === font}
                  onClick={() => update({ font })}
                >
                  <span>
                    {font}
                    {font === "Literata" ? " · " + t("Original") : ""}
                  </span>
                  {draft.font === font && <Icon name="check" />}
                </button>
              ))}
            </div>
          ) : (
            <>
              <SettingsGroup title={t("Text")}>
                <button class="setting-row" onClick={() => setView("font")}>
                  <span>{t("Font")}</span>
                  <span class="muted">
                    {draft.font} <Icon name="next" size={14} />
                  </span>
                </button>
                <Toggle
                  checked={draft.bold}
                  onChange={(bold) => update({ bold })}
                >
                  {t("Bold Text")}
                </Toggle>
              </SettingsGroup>
              <SettingsGroup title={t("Hints")}>
                <div class="setting-row">
                  <span>{t("Hint colour")}</span>
                  <div class="swatches">
                    {hintPalette(draft).map(({ value, color }, i) => (
                      <button
                        aria-label={t("Hint colour {0}", { 0: i + 1 })}
                        aria-pressed={draft.hintColor.toLowerCase() === value}
                        style={{
                          "--swatch": color,
                          "--swatch-ink":
                            contrastRatio("#ffffff", color) >= 4.5
                              ? "#ffffff"
                              : "#080909",
                        }}
                        onClick={() => update({ hintColor: value })}
                      >
                        {draft.hintColor.toLowerCase() === value && (
                          <Icon name="check" size={14} />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
                {range("Hint size", "hintSize", 0.65, 1.2, 0.01)}
                <Toggle
                  checked={draft.hintItalic}
                  onChange={(hintItalic) => update({ hintItalic })}
                >
                  {t("Hints in italics")}
                </Toggle>
              </SettingsGroup>
              <SettingsGroup title={t("Accessibility & Layout")}>
                <Toggle
                  checked={draft.customLayout}
                  onChange={(customLayout) => update({ customLayout })}
                >
                  {t("Customize")}
                </Toggle>
                <fieldset
                  disabled={!draft.customLayout}
                  class={
                    !draft.customLayout
                      ? "layout-controls disabled-layout"
                      : "layout-controls"
                  }
                >
                  {range("Line spacing", "lineSpacing", 1.15, 2.3, 0.05)}
                  {range("Character spacing", "letterSpacing", 0, 0.12, 0.01)}
                  {range("Word spacing", "wordSpacing", 0, 0.6, 0.02)}
                  {range("Margins", "margins", 3, 14, 1)}
                </fieldset>
                <label class="setting-row">
                  {t("Columns")}
                  <select
                    aria-label={t("Columns")}
                    value={draft.columns}
                    onChange={(e) => update({ columns: e.currentTarget.value })}
                  >
                    <option value="auto">{t("Auto")}</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                  </select>
                </label>
                <Toggle
                  checked={draft.justify}
                  onChange={(justify) => update({ justify })}
                >
                  {t("Justify Text")}
                </Toggle>
              </SettingsGroup>
              <button
                class="wide primary theme-reset"
                onClick={() => update({ ...themeDefaults })}
              >
                {t("Reset Theme")}
              </button>
            </>
          )}
        </>
      )}
      <InterfaceSize settings={settings} onChange={onChange} readingOnly />
    </div>
  );
}
