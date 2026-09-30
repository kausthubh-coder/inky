import { useEffect, useRef } from "react";
import { ChatMarkdown } from "./ChatMarkdown.js";
import { scanWaitingFor, type LifecycleState, type SchoolOnboardingState } from "../../shared/index.js";
import { ScanStatus } from "./ScanStatus.js";
import { scanBrowserOwner } from "./scanBrowserOwner.js";
import { Character } from "./Character.js";
import { Icon } from "./Icon.js";
import { formatDateTime } from "./Ui.js";
import { courseTone } from "./assignmentPresentation.js";
import { scanChangeDate, scanChangeLabel, schoolScanPresentation } from "./schoolScanPresentation.js";
import "./school-check.css";
import { plainError, schoolScanFailure } from "./homeworkText.js";

type ProgressState = "checked" | "reading" | "waiting" | "needs_user";

function hostLabel(target: string | undefined): string {
  if (!target) return "School site";
  try { return new URL(target).hostname.replace(/^www\./, ""); }
  catch { return "School site"; }
}

function handoffLabel(reason: string): string {
  return reason.match(/^(.+?)\s+needs\b/i)?.[1]?.trim() || "School sign-in";
}

function ProgressMark({ state }: { state: ProgressState }) {
  return <span className={`scan-progress-mark is-${state}`} aria-hidden="true">
    {state === "checked" ? <Icon name="check" size={15} /> : state === "needs_user" ? <Icon name="warning" size={14} /> : state === "reading" ? <span className="scan-reading-dots">•••</span> : "·"}
  </span>;
}

export function SchoolCheck({ state, lifecycle, onStopAndScan, onWait, onOpenWork, onAssignment, onCheck, onPause, onBrowser, onOpenSchoolPage, busy, detailsOpen, onDetails, onSchedule }: {
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
  onOpenSchoolPage: () => void;
  busy: string | null;
  detailsOpen: boolean;
  onDetails: (open: boolean) => void;
  onSchedule: () => void;
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
  const waiting = scanWaitingFor(scan);
  const schedule = lifecycle.schedule;
  const failure = schoolScanFailure(scan?.failures[0]);
  const signInSite = state.linkedSystems.find(site => site.linkedSystemId === scan?.handoff?.linkedSystemId)?.label
    ?? (scan?.handoff?.reason ? handoffLabel(scan.handoff.reason) : "Your school");
  const title = view.running ? scan?.targetAssignmentId ? "Reading this assignment" : "Reading your classes" : waiting === "sign_in" ? `${signInSite} signed you out`
    : view.paused ? "The school page is yours" : !scan ? "Dot hasn't read your school yet"
    : scan.state === "succeeded" ? scan.targetAssignmentId ? "Assignment checked" : "Your week is up to date" : scan.state === "failed" ? failure.title : "Some pages still need a check";
  const description = view.running ? scan?.currentStep || scan?.messages.filter(message => message.role === "assistant").at(-1)?.text
    : waiting === "sign_in" ? "Sign in on the right. Dot kept its place."
    : view.paused ? scan?.handoff?.reason || "Give Dot the page back when you're ready."
    : !scan ? "Find your assignments and due dates in one check."
    : scan.state === "succeeded" ? `Last checked ${formatDateTime(timestamp!)}${!scan.targetAssignmentId && schedule?.nextRunAt && schedule.cadence !== "manual" && schedule.state !== "paused" ? `. Next check ${formatDateTime(schedule.nextRunAt)}.` : "."}`
    : scan.state === "failed" ? failure.description : plainError(scan.failures[0]) || view.incompleteLabel;
  const action = waiting === "sign_in" ? "I've signed in" : view.paused ? "Continue check"
    : scan && scan.state !== "succeeded" ? "Check again" : "Check now";
  const localTime = schedule?.localTime ? new Date(`2000-01-01T${schedule.localTime}`).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
  const rule = !schedule || schedule.cadence === "manual" ? "Dot checks your school only when you ask."
    : schedule.state === "paused" ? "Automatic school checks are paused."
    : schedule.cadence === "daily" ? `Dot checks your school every ${Number(schedule.localTime.split(":")[0]) < 12 ? "morning" : "day"} at ${localTime}.`
    : `Dot checks your school every ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][schedule.weekday ?? 1]} at ${localTime}.`;
  const systemRows = (() => {
    if (!scan) return [];
    const handoff = scan.handoff;
    const schoolNeedsUser = handoff?.kind === "school_sign_in";
    const rows: { id: string; label: string; detail: string; state: ProgressState }[] = state.profile ? [{
      id: "school-root",
      label: hostLabel(state.profile.schoolRoot),
      detail: schoolNeedsUser ? handoff.reason : scan.observedCourseIds.length || scan.coverage.length ? "dashboard read" : view.running ? "checking dashboard" : "not checked in this scan",
      state: schoolNeedsUser ? "needs_user" : scan.observedCourseIds.length || scan.coverage.length ? "checked" : view.running ? "reading" : "waiting",
    }] : [];
    for (const system of state.linkedSystems) {
      const needsUser = system.state === "needs_user" || handoff?.linkedSystemId === system.linkedSystemId;
      const observedNow = system.lastObservedScanId === scan.scanId || scan.observedLinkedSystemIds.includes(system.linkedSystemId);
      rows.push({
        id: system.linkedSystemId,
        label: system.label,
        detail: needsUser ? handoff?.linkedSystemId === system.linkedSystemId ? handoff.reason : "Needs you to sign in" : observedNow ? "checked" : "signed in at last check",
        state: needsUser ? "needs_user" : observedNow ? "checked" : "waiting",
      });
    }
    if (handoff?.kind === "linked_system_sign_in" && !rows.some(row => row.id === handoff.linkedSystemId || row.label.toLocaleLowerCase() === handoffLabel(handoff.reason).toLocaleLowerCase())) {
      rows.push({ id: handoff.linkedSystemId ?? "linked-system-handoff", label: handoffLabel(handoff.reason), detail: handoff.reason, state: "needs_user" });
    }
    return rows;
  })();
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    root.current?.closest(".conversation-log")?.scrollTo({ top: 0 });
    if (detailsOpen) heading.current?.focus();
    else detailsButton.current?.focus();
  }, [detailsOpen]);
  useEffect(() => {
    if (!detailsOpen && (scan?.state === "failed" || scan?.state === "needs_user")) {
      root.current?.closest(".conversation-log")?.scrollTo({ top: 0 });
    }
  }, [scan?.state, scan?.failures[0], detailsOpen]);

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
    {scan.failures.length > 0 && <section className="scan-detail-note"><h3>Dot’s notes</h3>{scan.failures.map((note, index) => <ChatMarkdown key={index} text={note} />)}</section>}
    <section className="scan-detail-activity"><h3>What happened</h3>
      <p><time dateTime={scan.startedAt}>{formatDateTime(scan.startedAt)}</time><span>Started this scan.</span></p>
      {scan.messages.map(message => <div className="scan-activity-entry" key={message.messageId}>
        <time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time>
        <div><strong>{message.role === "user" ? "You" : "Dot"}</strong>
          {message.role === "user" ? <p className="scan-student-message">{message.text}</p> : <ChatMarkdown text={message.text} />}
        </div>
      </div>)}
      {scan.handoff && <div className="scan-activity-entry"><time dateTime={scan.handoff.requestedAt}>{formatDateTime(scan.handoff.requestedAt)}</time><ChatMarkdown text={scan.handoff.reason} /></div>}
      {scan.completedAt && <p><time dateTime={scan.completedAt}>{formatDateTime(scan.completedAt)}</time><span>{scan.state === "succeeded" ? "Finished checking." : scan.state === "partial" ? "Saved a partial result." : "Scan stopped."}</span></p>}
    </section>
    <button className="scan-text-button" onClick={onBrowser}><Icon name="browser" size={16} />Open school browser</button>
  </section>;

  return <section ref={root} className="school-check scan-report" aria-label="School scan results">
    {owner ? <ScanStatus state={state} lifecycle={lifecycle} busy={busy} onCheck={onCheck} onStopAndScan={onStopAndScan} onWait={onWait} onOpenWork={onOpenWork} /> : <header className="scan-state">
      <Character state={view.mood} size={64} />
      <div role="status" aria-live="polite">
        <h2>{title}</h2>
        <p className="scan-state-description">{description}</p>
      </div>
      <div className="scan-state-actions">
        {view.running ? <button className="rd-button" onClick={onPause}>Stop and keep what Dot found</button>
          : <button className="rd-button rd-primary" disabled={disabled} onClick={onCheck}>{busyStarting ? "Starting\u2026" : action}</button>}
        {scan?.state === "failed" && failure.pageUnavailable && <button className="rd-quiet" disabled={disabled} onClick={onOpenSchoolPage}>{busy === "school-page" ? "Opening\u2026" : "Open school page"}<Icon name="external" size={14} /></button>}
      </div>
    </header>}
    <div className="scan-schedule"><p>{rule}</p><button className="rd-quiet scan-change-rule" onClick={onSchedule}>Change</button></div>
    {scan && <section className="scan-change-list" aria-label="Changes from this scan">
      <h3>{view.active ? "Found so far" : "What changed"}</h3>
      {view.changes.length === 0 ? <p className="scan-empty">{view.active ? "New finds will appear here." : scan.state === "failed" ? "No changes were verified. Your saved homework stays in your week." : "Nothing new."}</p>
        : view.changes.map(({ change, assignment }) => <button key={change.assignmentId} className={`scan-change course-accent-${courseTone(state.courses.find(course => course.courseId === assignment.courseId)?.label ?? "", state.courses)}`} onClick={() => onAssignment(assignment.assignmentId)}>
          <span className="scan-change-copy"><strong>{assignment.title}</strong><small>{state.courses.find(course => course.courseId === assignment.courseId)?.label} · {scanChangeDate(change, assignment)}</small><span className="scan-change-label">{assignment.schoolStatus?.state === "submitted" || assignment.schoolStatus?.state === "graded" ? "Handed in" : scanChangeLabel(change)}</span></span>
          <Icon name="right" size={16} />
        </button>)}
    </section>}
    <details className="scan-where">
      <summary>Where Dot looks <span>{view.courses.length} classes</span><Icon name="down" size={16} /></summary>
      {systemRows.length > 0 && <section><h3>School sites</h3>{systemRows.map(system => <div className="scan-progress-row" key={system.id}><ProgressMark state={system.state} /><span className="scan-progress-copy"><strong>{system.label}</strong><small>{system.detail}</small></span></div>)}</section>}
      {view.courses.length > 0 && <section><h3>Classes</h3>{view.courses.map(course => <div className="scan-progress-row" key={course.courseId}><ProgressMark state={scan?.inventories.some(item => item.kind === "assignments" && item.courseId === course.courseId && item.state === "complete") ? "checked" : "waiting"} /><span className="scan-progress-copy"><strong>{course.label}</strong></span></div>)}</section>}
    </details>
    {scan?.targetAssignmentId && !view.active && <button className="scan-text-button" onClick={() => onAssignment(scan.targetAssignmentId!)}>Back to assignment<Icon name="right" size={16} /></button>}
    {scan && <footer className="scan-result-footer"><button ref={detailsButton} className="scan-text-button" onClick={() => onDetails(true)}>Scan details<Icon name="right" size={15} /></button></footer>}
  </section>;
}
