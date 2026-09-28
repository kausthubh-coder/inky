import { useEffect, useState } from "react";
import type { PermissionMode, PermissionRule, SchoolOnboardingState, StudiRendererApi, TaskSummary } from "../../shared/index.js";
import { currentPermissionRules, permissionRuleTargetKey } from "../../shared/index.js";
import { Icon } from "./Icon.js";
import { SettingsGroup } from "./SettingsPrimitives.js";
import { courseTone } from "./assignmentPresentation.js";
type RuleInput = Parameters<StudiRendererApi["savePermissionRule"]>[0];
const modes = [
  { id: "do_not_attempt", label: "Leave it" },
  { id: "attempt", label: "Do it, I submit" },
  { id: "auto_submit", label: "Do it and submit" },
] as const;
const kinds = [["quiz","Quizzes"],["problem_set","Problem sets"],["essay","Essays"],["code","Coding"],["discussion","Discussions"],["reading","Reading"],["group_work","Group work"]] as const;
export function HomeworkRules({ rules, onboarding, busy, onSaveRule, onDeleteRule, onGiveBack }: {
  rules: readonly PermissionRule[]; onboarding: SchoolOnboardingState; busy: boolean;
  onSaveRule: (input: RuleInput) => void; onDeleteRule: (id: string) => void;
  onGiveBack: (assignmentId: string) => void;
}) {
  const [adding, setAdding] = useState(false), [checking, setChecking] = useState(false);
  const [scope, setScope] = useState<"course" | "pattern" | "assignment">("course");
  const [courseId, setCourse] = useState(onboarding.courses[0]?.courseId ?? "");
  const [kind, setKind] = useState("quiz"), [assignmentId, setAssignment] = useState(onboarding.assignments[0]?.assignmentId ?? "");
  const [checker, setChecker] = useState(""), [task, setTask] = useState<TaskSummary | null>(null);
  const [notice, setNotice] = useState("");
  // "I'll do it myself" is stored as an assignment rule, but it isn't one the student edits here.
  const current = currentPermissionRules(rules).filter(rule => !rule.ruleId.startsWith("owner-"));
  const yours = onboarding.assignments.filter(item => item.owner === "student");
  const global = current.find(rule => rule.scope === "global");
  const mode = global?.mode ?? "do_not_attempt";
  const target = scope === "assignment" ? { scope, assignmentId } : scope === "pattern" ? { scope, courseId, patternId: kind } : { scope, courseId };
  const existing = current.find(rule => permissionRuleTargetKey(rule) === permissionRuleTargetKey(target));
  // The library is projected by ManagerCoordinator.resolvePermission, including its
  // confirmed-pattern and uncertain-kind restrictions. Never reconstruct weaker permissions in UI.
  useEffect(() => {
    if (!checking || !checker) { setTask(null); setNotice(""); return; }
    let alive = true;
    setTask(null); setNotice("Checking its saved rule…");
    void window.studi!.getLibraryState().then(library => {
      if (!alive) return;
      const found = library.tasks.find(item => item.assignment.assignmentId === checker);
      setTask(found ?? null); setNotice(found ? "" : "This assignment hasn't been loaded into your library yet.");
    }).catch(cause => { if (alive) setNotice(String(cause)); });
    return () => { alive = false; };
  }, [checker, checking, rules]);
  return <>
    <SettingsGroup title="When Inky finds homework">
      <div className="st-global-rule st-highlight">
        <div className="st-copy"><strong>All homework</strong><small>{mode === "attempt" ? "Inky does the work, then waits for you to submit." : mode === "auto_submit" ? "Inky does the work and submits after your review time." : "Inky leaves this homework to you."}</small></div>
        <div className="st-rule-modes" role="group" aria-label="All homework">
          {modes.map(item => <button key={item.id} aria-pressed={mode === item.id} disabled={busy}
            onClick={() => onSaveRule({ scope: "global", mode: item.id })}>{item.label}</button>)}
        </div>
      </div>
    </SettingsGroup>
    <SettingsGroup title="Exceptions">
      <p className="st-muted">An assignment rule wins, then its kind, then its class, then all homework.</p>
      {current.filter(rule => rule.scope !== "global").map(rule => <div className={`st-exception ${exceptionAccent(rule, onboarding)}`} key={rule.ruleId}>
        <div className="st-copy"><strong>{targetLabel(rule, onboarding)}</strong><small>{rule.scope === "pattern" ? "A confirmed kind in this class" : rule.scope === "assignment" ? "Just this assignment" : "Everything in this class"}</small></div>
        <select aria-label={`Rule for ${targetLabel(rule, onboarding)}`} disabled={busy} value={rule.mode}
          onChange={event => { const { schemaVersion: _version, updatedAt: _time, ...input } = rule; onSaveRule({ ...input, mode: event.target.value as PermissionMode }); }}>
          {modes.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <button className="st-text" disabled={busy} aria-label={`Remove rule for ${targetLabel(rule, onboarding)}`} onClick={() => onDeleteRule(rule.ruleId)}><Icon name="close" size={14} /></button>
      </div>)}
      <div className="st-rule-actions">
        <button className="st-add" aria-expanded={adding} onClick={() => setAdding(!adding)}>+ Add an exception</button>
        <button className="st-quiet" aria-expanded={checking} onClick={() => setChecking(!checking)}>Check an assignment</button>
      </div>
      {adding && <div className="st-form">
        <label>Apply this rule to<select aria-label="Apply this rule to" value={scope} disabled={busy} onChange={event => setScope(event.target.value as typeof scope)}>
          <option value="course">One class</option><option value="pattern">A kind in a class</option><option value="assignment">One assignment</option></select></label>
        {scope !== "assignment" && <label>Which class?<select aria-label="Which class?" value={courseId} disabled={busy} onChange={event => setCourse(event.target.value)}>{onboarding.courses.map(course => <option key={course.courseId} value={course.courseId}>{course.label}</option>)}</select></label>}
        {scope === "pattern" && <label>Which kind?<select aria-label="Which kind?" value={kind} disabled={busy} onChange={event => setKind(event.target.value)}>{kinds.map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label>}
        {scope === "assignment" && <label>Which assignment?<select aria-label="Which assignment?" value={assignmentId} disabled={busy} onChange={event => setAssignment(event.target.value)}>{onboarding.assignments.map(item => <option key={item.assignmentId} value={item.assignmentId}>{item.title}</option>)}</select></label>}
        <label>Inky can<select aria-label="Exception action" value={existing?.mode ?? ""} disabled={busy || !(scope === "assignment" ? assignmentId : courseId)}
          onChange={event => { if (event.target.value) onSaveRule({ ...target, mode: event.target.value as PermissionMode }); }}>
          <option value="" disabled>Choose what Inky may do…</option>{modes.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      </div>}
      {yours.length > 0 && <>
        <p className="st-muted">You're doing these. Inky won't touch them, and rules don't apply.</p>
        {yours.map(item => <div className={`st-exception ${exceptionAccent({ schemaVersion: 1, ruleId: "", scope: "assignment", assignmentId: item.assignmentId, mode: "do_not_attempt", updatedAt: "" }, onboarding)}`} key={item.assignmentId}>
          <div className="st-copy"><strong>{item.title}</strong><small>You're doing this one</small></div>
          <button className="st-quiet" disabled={busy} onClick={() => onGiveBack(item.assignmentId)}>Give it back</button>
        </div>)}
      </>}
      {checking && <div className="st-form"><label>Check an assignment<select aria-label="Check an assignment" value={checker} onChange={event => setChecker(event.target.value)}>
        <option value="">Choose an assignment…</option>{onboarding.assignments.map(item => <option key={item.assignmentId} value={item.assignmentId}>{item.title}</option>)}</select></label>
        <p role="status">{task ? `${modes.find(item => item.id === task.permission.mode)?.label}. ${task.permission.matchedRuleId ? targetLabel(rules.find(rule => rule.ruleId === task.permission.matchedRuleId), onboarding) + ". " : ""}${task.permission.rationale}` : notice}</p>
      </div>}
    </SettingsGroup>
  </>;
}
function exceptionAccent(rule: PermissionRule, onboarding: SchoolOnboardingState): string {
  if (rule.scope === "global") return "";
  const courseId = rule.scope === "assignment"
    ? onboarding.assignments.find(item => item.assignmentId === rule.assignmentId)?.courseId
    : rule.courseId;
  const course = onboarding.courses.find(item => item.courseId === courseId);
  return course ? `course-accent-${courseTone(course.label)}` : "";
}
function targetLabel(rule: PermissionRule | undefined, onboarding: SchoolOnboardingState): string {
  if (!rule) return "No matching rule";
  if (rule.scope === "global") return "All homework";
  if (rule.scope === "assignment") return onboarding.assignments.find(item => item.assignmentId === rule.assignmentId)?.title ?? "One assignment";
  const course = onboarding.courses.find(item => item.courseId === rule.courseId)?.label ?? rule.courseId;
  return rule.scope === "pattern" ? course + " · " + (kinds.find(([id]) => id === rule.patternId)?.[1] ?? rule.patternId) : course;
}
