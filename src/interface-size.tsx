import type { Settings } from "./storage";
import { defaults } from "./storage";
import { useT } from "./i18n";
import { useLayoutEffect, useState } from "preact/hooks";
import { FilledSlider } from "./filled-slider";

export function InterfaceSize({
  settings,
  onChange,
  readingOnly = false,
}: {
  settings: Settings;
  onChange(p: Partial<Settings>): void;
  readingOnly?: boolean;
}) {
  const t = useT();
  const [draft, setDraft] = useState({
    uiScale: settings.uiScale,
    readingUiScale: settings.readingUiScale,
  });
  useLayoutEffect(
    () =>
      setDraft({
        uiScale: settings.uiScale,
        readingUiScale: settings.readingUiScale,
      }),
    [settings.uiScale, settings.readingUiScale],
  );
  const keys = readingOnly
    ? (["readingUiScale"] as const)
    : (["uiScale", "readingUiScale"] as const);
  return (
    <section
      class={"interface-size" + (readingOnly ? " filled-interface-size" : "")}
    >
      {!readingOnly && <h3 class="group-label">{t("Interface size")}</h3>}
      <div class="group">
        {readingOnly ? (
          <FilledSlider
            label={t("Reading controls")}
            min={80}
            max={160}
            value={settings.readingUiScale}
            valueText={`${settings.readingUiScale}%`}
            onInput={(readingUiScale) => onChange({ readingUiScale })}
          >
            <span>{t("Reading controls")}</span>
            <output>{settings.readingUiScale}%</output>
          </FilledSlider>
        ) : (
          keys.map((key) => (
            <label class="range-row" key={key}>
              <span>
                {t(key === "uiScale" ? "App interface" : "Reading controls")}
              </span>
              <output>{draft[key]}%</output>
              <input
                type="range"
                min="80"
                max="160"
                step="1"
                value={draft[key]}
                aria-label={t(
                  key === "uiScale" ? "App interface" : "Reading controls",
                )}
                aria-valuetext={`${draft[key]}%`}
                // Keep the slider still under the finger. Resize and repaginate
                // once on release, rather than moving the controls during a drag.
                onInput={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    [key]: +e.currentTarget.value,
                  }))
                }
                onChange={(e) => onChange({ [key]: +e.currentTarget.value })}
              />
            </label>
          ))
        )}
        <button
          class="setting-row interface-size-reset"
          onClick={() =>
            onChange(
              readingOnly
                ? { readingUiScale: defaults.readingUiScale }
                : {
                    uiScale: defaults.uiScale,
                    readingUiScale: defaults.readingUiScale,
                  },
            )
          }
        >
          {t("Reset interface size")}
        </button>
      </div>
    </section>
  );
}
