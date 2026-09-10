import type { SchoolOnboardingState } from "../../shared/index.js";

export function SchoolCheck({ state, onAssignment, onCheck, onPause, onBrowser, busy }: {
  state: SchoolOnboardingState;
  onAssignment: (id: string) => void;
  onCheck: () => void;
  onPause: () => void;
  onBrowser: () => void;
  busy: boolean;
}) {
  const scan = state.scan;
  const checking = scan?.state === "running";
  const changes = scan?.changes ?? [];
  const directory = scan?.inventories.find(item => item.kind === "courses");
  const courses = directory ? state.courses.filter(course => directory.itemIds.includes(course.courseId)) : state.courses;
  const checked = courses.filter(course => scan?.inventories.some(item => item.kind === "assignments" && item.courseId === course.courseId));
  return <div className="school-check">
    <p className="check-purpose">Finding new homework and updating what changed.</p>
    <div className="check-current" role="status"><span className={checking ? "check-pulse" : "check-dot"} /><span>{scan?.currentStep ?? "Ready to check your school."}</span></div>
    {scan?.handoff && scan.handoff.reason !== scan.currentStep && <p>{scan.handoff.reason}</p>}
    <div className="chat-card-actions">
      <button className="button button--paper" onClick={onBrowser}>View school browser</button>
      {checking ? <button className="quiet-button" onClick={onPause}>Pause</button> : <button className="button button--yellow" onClick={onCheck} disabled={busy}>{scan?.state === "needs_user" ? "Continue check" : "Check school"}</button>}
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
