import type { Settings } from "./storage";
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
      class={
        "interface-size" +
        (readingOnly ? " filled-interface-size" : " settings-group")
      }
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
            <FilledSlider
              key={key}
              label={t(
                key === "uiScale" ? "App interface" : "Reading controls",
              )}
              min={80}
              max={160}
              value={draft[key]}
              valueText={`${draft[key]}%`}
              onInput={(value) =>
                setDraft((prev) => ({ ...prev, [key]: value }))
              }
              onCommit={(value) => onChange({ [key]: value })}
              onCancel={() =>
                setDraft({
                  uiScale: settings.uiScale,
                  readingUiScale: settings.readingUiScale,
                })
              }
            >
              <span>
                {t(key === "uiScale" ? "App interface" : "Reading controls")}
              </span>
              <output>{draft[key]}%</output>
            </FilledSlider>
          ))
        )}
      </div>
    </section>
  );
}
