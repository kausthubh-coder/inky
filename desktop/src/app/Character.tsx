import { memo, useEffect, useLayoutEffect, useRef } from "react";

import { characterSvg, type CharacterKind } from "../../shared/characters/rig.js";
import type { ChalkyState, DotState } from "../../shared/characters/states.js";
import { CharacterMotion } from "./characterMotion.js";

type CharacterProps = { size?: number; label?: string } & (
  | { kind?: "dot"; state?: DotState }
  | { kind: "chalky"; state?: ChalkyState }
);

/** Dot or Chalky. The drawing is built once; a state change only tells the motion controller. */
export const Character = memo(function Character({ kind = "dot", state = "idle", size = 96, label }: CharacterProps) {
  const element = useRef<HTMLSpanElement>(null);
  const motion = useRef<CharacterMotion | null>(null);
  const latest = useRef(state);
  latest.current = state;

  useLayoutEffect(() => {
    const host = element.current!;
    host.innerHTML = characterSvg(kind as CharacterKind);
    motion.current = new CharacterMotion(host, latest.current);
    return () => motion.current?.dispose();
  }, [kind]);

  useEffect(() => {
    motion.current?.request(state);
  }, [state]);

  return (
    <span
      ref={element}
      className={`character ${kind}`}
      style={{ width: size, height: size }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
});
