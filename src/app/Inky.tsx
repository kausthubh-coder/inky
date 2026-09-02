import { inkySvg, type InkyState } from "../../shared/inky.js";

export type { InkyState };

export function Inky({ state = "idle", size = 96, label }: { state?: InkyState; size?: number; label?: string }) {
  return (
    <span
      className="inky-mascot"
      data-state={state}
      style={{ width: size, height: size }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      dangerouslySetInnerHTML={{ __html: inkySvg(state) }}
    />
  );
}
