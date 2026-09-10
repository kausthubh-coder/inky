import { scanBrowserOwner } from "./scanBrowserOwner.js";
import type { LifecycleState, SchoolOnboardingState } from "../../shared/index.js";
import { Icon } from "./Icon.js";
import { Inky } from "./Inky.js";

export function ScanStatus({ state, lifecycle, busy, onCheck, onDetails, onStopAndScan, onWait, onOpenWork }: {
  state: SchoolOnboardingState;
  lifecycle: LifecycleState;
  busy: boolean;
  onCheck: () => void;
  onDetails?: () => void;
  onStopAndScan: (taskId: string) => void;
  onWait: () => void;
  onOpenWork: () => void;
}) {
  const scan = state.scan;
  const owner = scanBrowserOwner(state, lifecycle);
  const ownerPaused = owner?.phase === "needs_user" || owner?.phase === "ready_review" || owner?.phase === "starting";
  const running = scan?.state === "running";
  const needs = scan?.state === "needs_user";
  const incomplete = scan?.state === "failed" || scan?.state === "partial";
  const complete = scan?.state === "succeeded";
  const tone = owner ? "busy" : needs ? "needs" : running ? "running" : incomplete ? "incomplete" : complete ? "complete" : "idle";
  const title = owner ? ownerPaused ? "Your assignment needs attention first" : "I’m using the school browser" : needs ? "I need your help to keep looking" : running ? "I’m checking for homework" : incomplete ? "I couldn’t finish checking" : complete ? "Your school check is complete" : "Let’s find your homework";
  const description = owner ? ownerPaused ? `“${owner.title}” has the school browser. Open the assignment to review or continue it before scanning.` : `I’m on “${owner.title}”. You can wait, then start a scan when I’m done.` : needs ? scan?.handoff?.reason || scan?.currentStep || "Open your school page so I can keep going." : running ? scan?.currentStep || "Looking through your school pages for new and changed work." : incomplete ? scan?.failures[0] || "Some school pages still need another look. Your saved work is here." : complete ? "Check again whenever you want to look for new or changed work." : "I’ll look through your school pages for assignments and due dates.";
  return <section className={`scan-status scan-status--${tone}`} aria-label="School scan">
    <Inky state={owner ? "working" : needs || incomplete ? "needs" : running ? "scanning" : complete ? "done" : "hello"} size={68} />
    <div className="scan-status__copy" role="status" aria-live="polite" aria-atomic="true">
      <span className="scan-status__label"><Icon name={owner ? "browser" : needs ? "hand" : running ? "search" : incomplete ? "warning" : complete ? "check" : "search"} size={14} />{owner ? "Browser in use" : needs ? "Waiting for you · scan paused" : running ? "Scanning school" : incomplete ? "Scan incomplete" : complete ? "Scan finished" : "School scan"}</span>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
    <div className="scan-status__actions">
      {owner ? <><button className="button button--paper" onClick={onOpenWork}>Open assignment<Icon name="right" size={16} /></button><button className="quiet-button" onClick={onWait}>{ownerPaused ? "Back to my week" : "I’ll wait"}</button>{owner.canStop && <button className="quiet-button" disabled={busy} onClick={() => onStopAndScan(owner.taskId)}>{busy ? "Stopping work…" : "Stop assignment & scan"}</button>}<small>Saved work stays available.</small></> : <>
        {running || needs ? onDetails && <button className={`button button--${needs ? "yellow" : "paper"}`} onClick={onDetails}>{needs ? "Help Inky" : "View scan"}<Icon name="right" size={16} /></button> : <button className="button button--yellow" onClick={onCheck} disabled={busy}>{busy ? "Starting scan…" : incomplete ? "Try scan again" : "Scan for homework"}<Icon name="search" size={16} /></button>}
        {onDetails && !running && !needs && <button className="quiet-button" onClick={onDetails}>Scan details</button>}
      </>}
    </div>
  </section>;
}
