import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";

export function SettingsGroup({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ComponentChildren;
  className?: string;
}) {
  const id = useId();
  return (
    <section
      class="settings-group theme-setting-group"
      role="group"
      aria-labelledby={id}
    >
      <h3 id={id} class="group-label">
        {title}
      </h3>
      <div class={"group " + className}>{children}</div>
    </section>
  );
}
