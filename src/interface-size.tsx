import type { Settings } from "./storage";
import { defaults } from "./storage";
import { useT } from "./i18n";

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
  const keys = readingOnly
    ? (["readingUiScale"] as const)
    : (["uiScale", "readingUiScale"] as const);
  return (
    <section class="interface-size">
      <h3 class="group-label">{t("Interface size")}</h3>
      <div class="group">
        {keys.map((key) => (
          <label class="range-row" key={key}>
            <span>
              {t(key === "uiScale" ? "App interface" : "Reading controls")}
            </span>
            <output>{settings[key]}%</output>
            <input
              type="range"
              min="80"
              max="160"
              step="1"
              value={settings[key]}
              aria-label={t(
                key === "uiScale" ? "App interface" : "Reading controls",
              )}
              aria-valuetext={`${settings[key]}%`}
              onInput={(e) => onChange({ [key]: +e.currentTarget.value })}
            />
          </label>
        ))}
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
