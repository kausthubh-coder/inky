import { useEffect, useRef, useState } from "react";
import type { Assignment } from "../../shared/index.js";
import { Icon } from "./Icon.js";

/** Every correction for one assignment, behind "···". Used on rows and on the assignment page. */
export function HomeworkMenu({ assignment, done, busy, onAsk, onChange }: {
  assignment: Assignment;
  done: boolean;
  busy: boolean;
  onAsk?: () => void;
  onChange: (operation: () => Promise<unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [date, setDate] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const a = assignment;
  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !ref.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", close); };
  }, [open]);
  const pick = (operation: () => Promise<unknown>) => { setOpen(false); onChange(operation); };
  const correct = (correction: "not_homework" | "already_done") => pick(() => window.studi!.correctAssignment({ assignmentId: a.assignmentId, correction }));
  return (
    <div className="hw-more" ref={ref}>
      <button className="hw-more-button" aria-label={`More for ${a.title}`} aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="more" /></button>
      {open && (
        <div className="hw-menu" role="menu">
          {onAsk && <button role="menuitem" onClick={() => { setOpen(false); onAsk(); }}>Ask Dot about it</button>}
          <p>Something wrong?</p>
          <button role="menuitem" onClick={() => setDateOpen(!dateOpen)}>Wrong due date</button>
          {dateOpen && (
            <form className="hw-menu-date" onSubmit={(event) => {
              event.preventDefault();
              if (date) pick(() => window.studi!.correctAssignment({ assignmentId: a.assignmentId, correction: "due_date", dueAt: new Date(date).toISOString() }));
            }}>
              <input type="datetime-local" aria-label="Correct due date" value={date} onChange={(event) => setDate(event.target.value)} required />
              <button className="rd-button" disabled={busy}>Save</button>
            </form>
          )}
          <button role="menuitem" onClick={() => correct("not_homework")}>This isn't homework</button>
          {!done && <button role="menuitem" onClick={() => correct("already_done")}>I already handed it in</button>}
          <button role="menuitem" disabled={!a.sourceTarget} onClick={() => pick(() => window.studi!.startSchoolScan({ assignmentId: a.assignmentId }))}>Details look wrong</button>
          {!done && <>
            <hr />
            <button role="menuitem" onClick={() => pick(() => window.studi!.setAssignmentOwner({ assignmentId: a.assignmentId, owner: a.owner === "student" ? "inky" : "student" }))}>
              {a.owner === "student" ? "Give it to Dot" : "I'll do it myself"}
            </button>
          </>}
        </div>
      )}
    </div>
  );
}
