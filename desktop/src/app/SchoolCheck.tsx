import type { LifecycleState, SchoolOnboardingState } from "../../shared/index.js";
import { ScanStatus } from "./ScanStatus.js";
import { scanBrowserOwner } from "./scanBrowserOwner.js";
import { Icon } from "./Icon.js";

export function SchoolCheck({ state, lifecycle, onStopAndScan, onWait, onOpenWork, browserOpen, onAssignment, onCheck, onPause, onBrowser, busy }: {
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
  busy: boolean;
}) {
  const scan = state.scan;
  const checking = scan?.state === "running";
  const owner = scanBrowserOwner(state, lifecycle);
  const changes = scan?.changes ?? [];
  const directory = scan?.inventories.find(item => item.kind === "courses");
  const courses = directory ? state.courses.filter(course => directory.itemIds.includes(course.courseId)) : state.courses;
  const checked = courses.filter(course => scan?.inventories.some(item => item.kind === "assignments" && item.courseId === course.courseId));
  return <div className="school-check">
    <ScanStatus state={state} lifecycle={lifecycle} busy={busy} onCheck={onCheck} onStopAndScan={onStopAndScan} onWait={onWait} onOpenWork={onOpenWork} />
    <div className="chat-card-actions">
      <button className={`button button--${scan?.state === "needs_user" ? "yellow" : "paper"}`} aria-expanded={browserOpen} onClick={onBrowser}><Icon name="browser" />{browserOpen ? "Close school browser" : "Open school browser"}</button>
      {!owner && (checking ? <button className="quiet-button" disabled={busy} onClick={onPause}>Pause scan</button> : scan?.state === "needs_user" && <button className="button button--paper" onClick={onCheck} disabled={busy}>I’m done · continue scan</button>)}
    </div>
    {courses.length > 0 && <details className="check-coverage"><summary>{checked.length} of {courses.length} classes checked</summary><ul>{courses.map(course => <li key={course.courseId}><span>{course.label}</span><small>{checked.includes(course) ? "Checked" : course.lastVerifiedScanId === scan?.scanId ? "Checking homework" : "Not checked yet"}</small></li>)}</ul></details>}
    {changes.length > 0 && <section className="check-results" aria-label="New and updated homework"><h3>{changes.filter(change => change.kind === "new").length} new · {changes.filter(change => change.kind === "updated").length} updated</h3>{changes.map(change => {
      const assignment = state.assignments.find(item => item.assignmentId === change.assignmentId);
      if (!assignment) return null;
      return <button key={change.assignmentId} className="check-result" onClick={() => onAssignment(assignment.assignmentId)}><span><small>{change.kind === "new" ? "New homework" : "Updated"}</small><strong>{assignment.title}</strong><small>{change.kind === "updated" ? change.fields.map(field => ({dueAt:"Due date",dueText:"Due date",instructions:"Instructions",title:"Title"})[field] ?? field).filter((field,index,all) => all.indexOf(field) === index).join(" · ") : state.courses.find(course => course.courseId === assignment.courseId)?.label}</small></span><span aria-hidden="true">›</span></button>;
    })}</section>}
    {scan?.state === "succeeded" && changes.length === 0 && <p>No new or changed homework found.</p>}
    {scan && ["partial", "failed"].includes(scan.state) && <div className="check-incomplete" role="status"><strong>Saved what I found.</strong><p>{scan.failures[0] ?? "Some school pages still need checking."}</p></div>}
  </div>;
}
