import { useEffect, useRef } from "react";
import { ChatMarkdown } from "./ChatMarkdown.js";
import type { LifecycleState, SchoolOnboardingState } from "../../shared/index.js";
import { ScanStatus } from "./ScanStatus.js";
import { scanBrowserOwner } from "./scanBrowserOwner.js";
import { Character } from "./Character.js";
import { Icon } from "./Icon.js";
import { formatDateTime } from "./Ui.js";
import { courseTone } from "./assignmentPresentation.js";
import { scanChangeDate, scanChangeLabel, schoolScanPresentation } from "./schoolScanPresentation.js";
import "./school-check.css";

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
  const heroDescription = view.running
    ? "Read-only. About 2 minutes. Keep using Studi."
    : view.signIn
      ? "Sign in below. I’ll keep everything I already found."
      : scan?.state === "failed" && scan.failures.length
        ? "What I found is saved. You can retry the unfinished parts."
        : view.description ?? "";
  const completedCourseIds = new Set(scan?.inventories.filter(item => item.kind === "assignments" && item.state === "complete").map(item => item.courseId).filter(Boolean));
  const observedAssignmentIds = new Set(scan?.observedAssignmentIds ?? []);
  const normalizedStep = scan?.currentStep.toLocaleLowerCase() ?? "";
  const activeCourseId = view.running
    ? view.courses.find(course => normalizedStep.includes(course.label.toLocaleLowerCase()) || normalizedStep.includes(course.courseId.toLocaleLowerCase()))?.courseId
      ?? view.courses.find(course => !completedCourseIds.has(course.courseId))?.courseId
    : undefined;
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
    {scan && <div className="scan-report-date"><strong>{reportLabel}</strong><time dateTime={timestamp}>{formatDateTime(timestamp!)}</time>{view.running && <span className="scan-live-label"><i />In progress</span>}</div>}
    {owner ? <ScanStatus state={state} lifecycle={lifecycle} busy={busy} onCheck={onCheck} onStopAndScan={onStopAndScan} onWait={onWait} onOpenWork={onOpenWork} /> : <>
      <div className={`scan-result-hero ${!scan ? "is-first" : ""}`}>
        <Character state={view.mood} size={82} />
        <div className="scan-result-copy" role="status" aria-live="polite">
          <h2>{view.running ? "Checking your classes." : view.title}</h2>
          <ChatMarkdown text={heroDescription} />
          {scan && !view.active && scan.changes.length > 0 && <span className="scan-saved"><Icon name="check" size={14} />Saved to your week</span>}
        </div>
        {!view.active && <div className="scan-hero-action">
          <button className="button button--yellow" disabled={disabled} onClick={onCheck}>{busyStarting ? "Starting scan…" : scan?.targetAssignmentId && (scan.state === "partial" || scan.state === "failed") ? "Continue checking assignment" : scan?.state === "failed" ? "Restart scan" : scan ? "Scan again" : "Scan for homework"}<Icon name="search" size={17} /></button>
        </div>}
      </div>

      {scan && !scan.targetAssignmentId && systemRows.length > 0 && <section className="scan-progress-section" aria-labelledby="scan-systems-heading">
        <h3 id="scan-systems-heading">Signed in</h3>
        <div className="scan-progress-list">{systemRows.map(system => <div className={`scan-progress-row is-${system.state}`} key={system.id}>
          <ProgressMark state={system.state} />
          <span className="scan-progress-copy"><strong>{system.label}</strong><small>{system.detail}</small></span>
          {system.state === "needs_user" && <button className="button button--paper scan-sign-in" aria-label={`Sign in to ${system.label}`} disabled={disabled} onClick={onBrowser}>Sign in</button>}
        </div>)}</div>
      </section>}

      {scan && !scan.targetAssignmentId && view.courses.length > 0 && <section className="scan-progress-section" aria-labelledby="scan-classes-heading">
        <h3 id="scan-classes-heading">Classes</h3>
        <div className="scan-progress-list">{view.courses.map(course => {
          const assignments = state.assignments.filter(item => item.courseId === course.courseId && observedAssignmentIds.has(item.assignmentId));
          const newCount = view.changes.filter(({ change, assignment }) => change.kind === "new" && assignment.courseId === course.courseId).length;
          const checked = completedCourseIds.has(course.courseId) || scan.coverage.some(item => item.status === "verified" && (item.target === course.courseId || item.target.toLocaleLowerCase() === course.label.toLocaleLowerCase()));
          const progress: ProgressState = checked ? "checked" : course.courseId === activeCourseId ? "reading" : "waiting";
          const dueCount = assignments.filter(item => item.dueAt || item.dueText).length;
          const found = dueCount || newCount ? `${dueCount} due${newCount ? `, ${newCount} new` : ""}` : "";
          const detail = checked ? found || "checked" : progress === "reading" ? found ? `${found} · still reading` : "reading the course page" : found || "waiting";
          return <div className={`scan-progress-row scan-course-row course-accent-${courseTone(course.label, state.courses)} is-${progress}`} key={course.courseId}>
            <ProgressMark state={progress} />
            <span className="scan-progress-copy"><strong>{course.label}</strong><small>{detail}</small></span>
          </div>;
        })}</div>
      </section>}

      {scan?.failures.length ? <section className="scan-failures" aria-labelledby="scan-failures-heading">
        <h3 id="scan-failures-heading">What I couldn’t check</h3>
        {scan.failures.map((failure, index) => <div className="scan-failure" key={`${failure}-${index}`}><Icon name="warning" size={16} /><ChatMarkdown text={failure} /></div>)}
      </section> : null}

      {/* The scan's own request stays busy until it ends, so stopping can't wait on it. */}
      {view.running && <button className="scan-finish-button" onClick={onPause}>Stop and keep what Dot found</button>}
      {/* The one decision while the check waits, like the assignment page: sign in or hand the page back. */}
      {view.paused && <section className="ag-move scan-move" aria-label="Your move">
        <h2>{view.signIn ? "Sign in on the school page." : "You have the page."}</h2>
        <p>{view.signIn ? "It's open on the right. Tick “remember this device” if it asks." : "Dot kept its place and carries on from where it stopped."}</p>
        <div className="ag-acts"><button className="rd-button rd-primary" disabled={disabled} onClick={onCheck}>{busyStarting ? "Continuing…" : view.signIn ? "I've signed in, continue" : "Continue scan"}</button></div>
      </section>}
    </>}
    {scan?.targetAssignmentId && !view.active && <button className="button button--paper" onClick={() => onAssignment(scan.targetAssignmentId!)}>Back to assignment<Icon name="right" size={17} /></button>}
    {scan?.state === "partial" && scan.failures.length === 0 && <p className="scan-missing-source"><Icon name="warning" size={17} /><span>{view.incompleteLabel}</span></p>}
    {view.changes.length > 0 && <section className="scan-change-list" aria-label="Changes from this scan">
      <h3>{view.active || scan?.state === "failed" ? "Found so far" : view.changes.some(({change}) => change.kind === "removed") ? "School changes" : "Added & updated in this scan"}</h3>
      {view.changes.map(({ change, assignment }) => <button key={change.assignmentId} className="check-result scan-change" onClick={() => onAssignment(assignment.assignmentId)}>
        <span className={`scan-change-symbol ${change.kind === "updated" ? "is-updated" : ""}`}><Icon name={change.kind === "removed" ? "warning" : change.kind === "updated" ? "calendar" : "note"} size={22} /></span>
        <span className="scan-change-copy"><strong>{assignment.title}<small className="scan-change-tag">{scanChangeLabel(change)}</small></strong><small>{state.courses.find(course => course.courseId === assignment.courseId)?.label}</small></span>
        <span className="scan-change-date">{scanChangeDate(change, assignment)}</span><Icon name="right" size={16} />
      </button>)}
    </section>}
    {scan && <footer className="scan-result-footer">{!view.active && <span>{view.checkedLabel}</span>}<button ref={detailsButton} className="scan-text-button" onClick={() => onDetails(true)}><Icon name="note" size={16} />Scan details<Icon name="right" size={15} /></button></footer>}
  </section>;
}
