"use client";

import { inkySvg, type InkyState } from "../lib/inky";

export function InkyMascot({ state, size }: { state: InkyState; size: number }) {
  return (
    <inky-mascot
      data-state={state}
      data-size={String(size)}
      dangerouslySetInnerHTML={{ __html: inkySvg(state, size) }}
    />
  );
}
