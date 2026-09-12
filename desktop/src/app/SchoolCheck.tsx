import { useEffect, useRef } from "react";
import type { LifecycleState, SchoolOnboardingState } from "../../shared/index.js";
import { ScanStatus } from "./ScanStatus.js";
import { scanBrowserOwner } from "./scanBrowserOwner.js";
import { Inky } from "./Inky.js";
import { Icon } from "./Icon.js";
import { formatDateTime } from "./Ui.js";
import { scanChangeDate, scanChangeLabel, schoolScanPresentation } from "./schoolScanPresentation.js";
import "./school-check.css";

export function SchoolCheck({ state, lifecycle, onStopAndScan, onWait, onOpenWork, onAssignment, onCheck, onPause, onBrowser, busy, detailsOpen, onDetails }: {
  state: SchoolOnboardingState;
  lifecycle: LifecycleState;
  onStopAndScan: (taskId: string) => void;
  onWait: () => void;
  onOpenWork: () => void;
  browserOpen: boolean;
  onAssignment: (id: string) => void;
  onCheck: () => void;
  onPause: () => void;
  onBrowser: () => void;
  busy: string | null;
  detailsOpen: boolean;
  onDetails: (open: boolean) => void;
}) {
  const scan = state.scan;
  const view = schoolScanPresentation(state);
  const owner = scanBrowserOwner(state, lifecycle);
  const root = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const detailsButton = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  const timestamp = scan?.completedAt ?? scan?.startedAt;
  const reportLabel = view.active ? "Current scan" : "Latest scan";
  const disabled = busy !== null;
  const busyStarting = busy === "scan" || busy === "resume" || busy === "replay";
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    root.current?.closest(".conversation-log")?.scrollTo({ top: 0 });
    if (detailsOpen) heading.current?.focus();
    else detailsButton.current?.focus();
  }, [detailsOpen]);

  if (detailsOpen && scan) return <section ref={root} className="school-check scan-report scan-details-page" aria-label="Scan details">
    <button className="scan-text-button" onClick={() => onDetails(false)}><Icon name="left" size={17} />Scan result</button>
    <header className="scan-details-heading"><h2 ref={heading} tabIndex={-1}>{reportLabel} details</h2><time dateTime={timestamp}>{formatDateTime(timestamp!)}</time></header>
    {view.courses.length > 0 && <>
      <h3>{view.directoryKnown ? "Classes" : "Previously known classes"}</h3>
      <ul className="scan-class-list">{view.courses.map(course => {
        const checked = view.checkedIds.has(course.courseId);
        return <li key={course.courseId}><span className={`scan-class-mark ${checked ? "is-checked" : ""}`} aria-hidden="true">{checked ? <Icon name="check" size={15} /> : "·"}</span><span>{course.label}</span><small>{checked ? "Checked" : view.active ? "Not checked yet" : "Not verified in this scan"}</small></li>;
      })}</ul>
    </>}
    {scan.coverage.length > 0 && <section className="scan-detail-note"><h3>Sources checked</h3>{scan.coverage.map((item, index) => <p key={index}><strong>{item.target}</strong> · {item.status === "verified" ? "Checked" : item.failure ?? "Needs another look"}</p>)}</section>}
    {scan.failures.length > 0 && <section className="scan-detail-note"><h3>Inky’s notes</h3>{scan.failures.map((note, index) => <p key={index}>{note}</p>)}</section>}
    <section className="scan-detail-activity"><h3>What happened</h3>
      <p><time dateTime={scan.startedAt}>{formatDateTime(scan.startedAt)}</time><span>Started this scan.</span></p>
      {scan.messages.map(message => <p key={message.messageId}><time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time><span><strong>{message.role === "user" ? "You" : "Inky"}</strong><br />{message.text}</span></p>)}
      {scan.handoff && <p><time dateTime={scan.handoff.requestedAt}>{formatDateTime(scan.handoff.requestedAt)}</time><span>{scan.handoff.reason}</span></p>}
      {scan.completedAt && <p><time dateTime={scan.completedAt}>{formatDateTime(scan.completedAt)}</time><span>{scan.state === "succeeded" ? "Finished checking." : scan.state === "partial" ? "Saved a partial result." : "Scan stopped."}</span></p>}
    </section>
    <button className="scan-text-button" onClick={onBrowser}><Icon name="browser" size={16} />Open school browser</button>
  </section>;

  return <section ref={root} className="school-check scan-report" aria-label="School scan results">
    {scan && <div className="scan-report-date"><strong>{reportLabel}</strong><time dateTime={timestamp}>{formatDateTime(timestamp!)}</time>{view.running && <span className="scan-live-label"><i />In progress</span>}</div>}
    {owner && <ScanStatus state={state} lifecycle={lifecycle} busy={busy} onCheck={onCheck} onStopAndScan={onStopAndScan} onWait={onWait} onOpenWork={onOpenWork} />}
    <div className={`scan-result-hero ${!scan ? "is-first" : ""}`}>
      <Inky state={view.mood} size={90} />
      <div className="scan-result-copy" role="status" aria-live="polite"><h2>{view.title}</h2><p>{view.description}</p>
        {view.running && view.directoryKnown && <small className="scan-count">{view.checkedLabel}</small>}
        {scan && !view.active && scan.changes.length > 0 && <span className="scan-saved"><Icon name="check" size={14} />Saved to your week</span>}
      </div>
      {!owner && <div className="scan-hero-action">
        {view.running ? <button className="button button--paper" disabled={disabled} onClick={onPause}>Pause scan</button>
          : view.signIn ? <button className="button button--yellow" disabled={disabled} onClick={onBrowser}>Open sign-in<Icon name="browser" size={17} /></button>
          : <button className="button button--yellow" disabled={disabled} onClick={onCheck}>{busyStarting ? "Starting scan…" : view.paused ? "Continue scan" : scan?.state === "failed" ? "Restart scan" : scan ? "Scan again" : "Scan for homework"}<Icon name={view.paused ? "right" : "search"} size={17} /></button>}
      </div>}
    </div>
    {view.paused && <p className="scan-recovery-note">{view.signIn ? "Sign in on your school page, then continue this scan." : "Your place is saved. Continue when you’re ready."}</p>}
    {scan?.state === "failed" && <p className="scan-recovery-note">Restart checks your classes again. Your saved homework stays.</p>}
    {scan?.state === "partial" && <p className="scan-missing-source"><Icon name="warning" size={17} /><span>{view.incompleteLabel}</span></p>}
    {view.changes.length > 0 && <section className="scan-change-list" aria-label="Changes from this scan">
      <h3>{view.active || scan?.state === "failed" ? "Found so far" : "Added & updated in this scan"}</h3>
      {view.changes.map(({ change, assignment }) => <button key={change.assignmentId} className="check-result scan-change" onClick={() => onAssignment(assignment.assignmentId)}>
        <span className={`scan-change-symbol ${change.kind === "updated" ? "is-updated" : ""}`}><Icon name={change.kind === "updated" ? "calendar" : "note"} size={22} /></span>
        <span className="scan-change-copy"><strong>{assignment.title}<small className="scan-change-tag">{scanChangeLabel(change)}</small></strong><small>{state.courses.find(course => course.courseId === assignment.courseId)?.label}</small></span>
        <span className="scan-change-date">{scanChangeDate(change, assignment)}</span><Icon name="right" size={16} />
      </button>)}
    </section>}
    {scan && <footer className="scan-result-footer">{!view.active && <span>{view.checkedLabel}</span>}<button ref={detailsButton} className="scan-text-button" onClick={() => onDetails(true)}><Icon name="note" size={16} />Scan details<Icon name="right" size={15} /></button></footer>}
  </section>;
}
