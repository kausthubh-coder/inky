import { scanBrowserOwner } from "./scanBrowserOwner.js";
import { ChatMarkdown } from "./ChatMarkdown.js";
import { canStopAssignmentForScan } from "./stopAssignmentForScan.js";
import type { LifecycleState, SchoolOnboardingState } from "../../shared/index.js";
import { Icon } from "./Icon.js";
import { Character } from "./Character.js";

export function ScanStatus({ state, lifecycle, busy, onCheck, onDetails, onStopAndScan, onWait, onOpenWork }: {
  state: SchoolOnboardingState;
  lifecycle: LifecycleState;
  busy: string | null;
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
  const title = owner ? ownerPaused ? "This assignment needs you first." : "I’m using the school page." : needs ? "I need your help to keep looking" : running ? "I’m checking for homework" : incomplete ? "I couldn’t finish checking" : complete ? "Your school check is complete" : "Let’s find your homework";
  const description = owner ? ownerPaused ? `Open “${owner.title}” to review or continue it before checking school.` : `I’m working on “${owner.title}”. You can go back to your week while I finish.` : needs ? scan?.handoff?.reason || scan?.currentStep || "Open your school page so I can keep going." : running ? scan?.currentStep || "Looking through your school pages for new and changed work." : incomplete ? scan?.failures[0] || "Some school pages still need another look. Your saved work is here." : complete ? "Check again whenever you want to look for new or changed work." : "I’ll look through your school pages for assignments and due dates.";
  return <section className={`scan-status scan-status--${tone}`} aria-label="School scan">
    <Character state={owner ? "working" : needs || incomplete ? "needs" : running ? "scanning" : complete ? "done" : "hello"} size={68} />
    <div className="scan-status__copy" role="status" aria-live="polite" aria-atomic="true">
      <span className="scan-status__label"><Icon name={owner ? "browser" : needs ? "hand" : running ? "search" : incomplete ? "warning" : complete ? "check" : "search"} size={14} />{owner ? "School page in use" : needs ? "Waiting for you · scan paused" : running ? "Scanning school" : incomplete ? "Scan incomplete" : complete ? "Scan finished" : "School scan"}</span>
      <h2>{scan?.targetAssignmentId && !owner ? running ? "I’m checking this assignment" : complete ? "Assignment details checked" : title : title}</h2>
      <ChatMarkdown text={scan?.targetAssignmentId && !owner && complete ? scan.currentStep : description} />
    </div>
    <div className="scan-status__actions">
      {owner ? <><button className="button button--yellow" onClick={onOpenWork}>Open assignment<Icon name="right" size={16} /></button><button className="rd-quiet" onClick={onWait}>{ownerPaused ? "Back to my week" : "Keep working in background"}</button>{owner.canStop && <button className="rd-quiet" disabled={!canStopAssignmentForScan(busy)} onClick={() => onStopAndScan(owner.taskId)}>{busy === "cancel" ? "Stopping assignment…" : "Stop assignment and scan"}</button>}<small>Saved work stays available.</small></> : <>
        {running || needs ? onDetails && <button className={`button button--${needs ? "yellow" : "paper"}`} onClick={onDetails}>{needs ? "Help Dot" : "View scan"}<Icon name="right" size={16} /></button> : <button className="button button--yellow" onClick={onCheck} disabled={busy !== null}>{busy === "scan" || busy === "resume" || busy === "replay" ? "Starting scan…" : incomplete ? "Try scan again" : "Scan for homework"}<Icon name="search" size={16} /></button>}
        {onDetails && !running && !needs && <button className="rd-quiet" onClick={onDetails}>Scan details</button>}
      </>}
    </div>
  </section>;
}
