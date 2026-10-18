import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Settings } from "./storage";
import {
  themes,
  fonts,
  hintColors,
  appearanceStyle,
  themeDefaults,
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
  const [draft, setDraft] = useState(settings);
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
  const update = (p: Partial<Settings>) => setDraft((s) => ({ ...s, ...p }));
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
        onInput={(e) => update({ [key]: +e.currentTarget.value })}
      />
    </label>
  );
  return (
    <div class="themes-panel" ref={panel}>
      <div class="sheet-heading">
        <button
          class="round"
          aria-label={t(
            view === "font" ? "Back" : view === "themes" ? "Close" : "Cancel",
          )}
          onClick={() =>
            view === "font"
              ? setView("custom")
              : view === "custom"
                ? setView("themes")
                : onClose()
          }
        >
          <Icon name={view === "font" ? "back" : "close"} />
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
              onChange(draft);
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
          <InterfaceSize settings={settings} onChange={onChange} readingOnly />
          <div class="theme-grid">
            {themes.map((theme) => (
              <button
                class="theme-tile"
                aria-label={theme.name}
                aria-pressed={
                  settings.readingTheme === theme.id && !settings.followSystem
                }
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
              setDraft(settings);
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
              <h3 class="group-label">{t("Text")}</h3>
              <div class="group">
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
              </div>
              <h3 class="group-label">{t("Hints")}</h3>
              <div class="group">
                <div class="setting-row">
                  <span>{t("Hint colour")}</span>
                  <div class="swatches">
                    {hintColors.map((color, i) => (
                      <button
                        aria-label={t("Hint colour {0}", { 0: i + 1 })}
                        aria-pressed={draft.hintColor === color}
                        style={{ background: color }}
                        onClick={() => update({ hintColor: color })}
                      />
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
              </div>
              <h3 class="group-label">{t("Accessibility & Layout")}</h3>
              <div class="group">
                <Toggle
                  checked={draft.customLayout}
                  onChange={(customLayout) => update({ customLayout })}
                >
                  {t("Customize")}
                </Toggle>
                <div
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
                </div>
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
              </div>
              <button
                class="wide quiet"
                onClick={() => update({ ...themeDefaults })}
              >
                {t("Reset Theme")}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
