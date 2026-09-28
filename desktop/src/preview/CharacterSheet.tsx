import { useState } from "react";

import { Character } from "../app/Character.js";
import { CHALKY_STATES, DOT_STATES, type ChalkyState, type DotState } from "../../shared/characters/states.js";
import iconUrl from "../../../assets/studi-icon.svg";

// Every state for both characters at the sizes the app uses, plus a live one to switch mid-animation.
export function CharacterSheet() {
  const [dot, setDot] = useState<DotState>("idle");
  const [chalky, setChalky] = useState<ChalkyState>("idle");
  const flip = () => {
    setDot("thinking");
    setTimeout(() => setDot("working"), 100);
    setTimeout(() => setDot("thinking"), 200);
  };
  return (
    <main className="character-sheet">
      <h1>Dot, Chalky and the icon</h1>
      <section className="character-sheet-icons">
        {[128, 48, 32, 16].map((size) => <img key={size} src={iconUrl} width={size} height={size} alt="" />)}
      </section>
      <section className="character-sheet-live">
        <div>
          <Character kind="dot" state={dot} size={200} label={`Dot is ${dot}`} />
          <p>{DOT_STATES.map((state) => <button key={state} aria-pressed={dot === state} onClick={() => setDot(state)}>{state}</button>)}</p>
          <p><button onClick={flip}>Flip thinking, working, thinking in 200ms</button></p>
        </div>
        <div>
          <Character kind="chalky" state={chalky} size={200} label={`Chalky is ${chalky}`} />
          <p>{CHALKY_STATES.map((state) => <button key={state} aria-pressed={chalky === state} onClick={() => setChalky(state)}>{state}</button>)}</p>
        </div>
      </section>
      {(["dot", "chalky"] as const).map((kind) => (
        <section key={kind} className="character-sheet-grid" data-kind={kind}>
          {(kind === "dot" ? DOT_STATES : CHALKY_STATES).map((state) => (
            <figure key={state} data-state={state}>
              {[28, 56, 120].map((size) =>
                kind === "dot"
                  ? <Character key={size} kind="dot" state={state as DotState} size={size} />
                  : <Character key={size} kind="chalky" state={state as ChalkyState} size={size} />,
              )}
              <figcaption>{state}</figcaption>
            </figure>
          ))}
        </section>
      ))}
    </main>
  );
}
