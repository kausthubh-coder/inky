import { useState } from "react";
import type { PermissionMode, PermissionRule, SchoolOnboardingState, StudiRendererApi } from "../../shared/index.js";
import { Field, PaperCard } from "./Ui.js";
import "./homework-rules.css";

type RuleInput = Parameters<StudiRendererApi["savePermissionRule"]>[0];
const actions: { mode: PermissionMode; title: string; detail: string }[] = [
  { mode: "do_not_attempt", title: "Leave it to me", detail: "Inky won’t start this homework." },
  { mode: "attempt", title: "Work on it, then stop", detail: "I can prepare answers, but I won’t submit them." },
  { mode: "auto_submit", title: "Work on it and submit", detail: "I may submit after the review period, without another approval." },
];

export function HomeworkRules({ rules, onboarding, busy, onSaveRule, onDeleteRule }: {
  rules: readonly PermissionRule[];
  onboarding: SchoolOnboardingState;
  busy: boolean;
  onSaveRule: (input: RuleInput) => void;
  onDeleteRule: (ruleId: string) => void;
}) {
  const [scope, setScope] = useState<PermissionRule["scope"]>("course");
  const [courseId, setCourseId] = useState("");
  const [assignmentId, setAssignmentId] = useState("");
  const [patternId, setPatternId] = useState("");
  const [mode, setMode] = useState<PermissionMode>("attempt");
  const course = onboarding.courses.find(item => item.courseId === courseId);
  const assignment = onboarding.assignments.find(item => item.assignmentId === assignmentId);
  const problem = scope === "global" ? null
    : scope === "assignment" ? assignment ? null : onboarding.assignments.length ? "Choose the assignment this rule applies to." : "I haven’t found any assignments yet. Check school from your week first."
    : !course ? onboarding.courses.length ? "Choose the class this rule applies to." : "I haven’t found any classes yet. Check school from your week first."
    : scope === "pattern" && !patternId.trim() ? "Enter the exact confirmed group ID."
    : null;
  const target = scope === "global" ? "all homework, including future classes"
    : scope === "assignment" ? assignment?.title
    : scope === "pattern" ? `confirmed group “${patternId.trim()}” in ${course?.label}`
    : `homework in ${course?.label}`;
  const save = () => {
    if (busy || problem) return;
    if (scope === "global") onSaveRule({ scope, mode });
    else if (scope === "assignment") onSaveRule({ scope, mode, assignmentId });
    else if (scope === "pattern") onSaveRule({ scope, mode, courseId, patternId: patternId.trim() });
    else onSaveRule({ scope, mode, courseId });
  };
  return <PaperCard className="settings-card homework-rules">
    <h2>What can I help with?</h2>
    <form onSubmit={event => { event.preventDefault(); save(); }}>
      <fieldset disabled={busy}>
        <legend>1. Choose the homework</legend>
        <Field label="Apply this rule to"><select value={scope === "pattern" ? "course" : scope} onChange={event => { setScope(event.target.value as typeof scope); setMode("attempt"); }}>
          <option value="course">One class</option><option value="assignment">One assignment</option><option value="global">All homework</option>
        </select></Field>
        {(scope === "course" || scope === "pattern") && <Field label="Which class?"><select value={course?.courseId ?? ""} onChange={event => setCourseId(event.target.value)}>
          <option value="">Choose a class…</option>{onboarding.courses.map(item => <option key={item.courseId} value={item.courseId}>{item.label}</option>)}
        </select></Field>}
        {scope === "assignment" && <Field label="Which assignment?"><select value={assignment?.assignmentId ?? ""} onChange={event => setAssignmentId(event.target.value)}>
          <option value="">Choose an assignment…</option>{onboarding.assignments.map(item => <option key={item.assignmentId} value={item.assignmentId}>{item.title} · {courseName(item.courseId, onboarding)}</option>)}
        </select></Field>}
        {(scope === "course" || scope === "pattern") && <details className="homework-rules__advanced"><summary>Advanced: a confirmed assignment group</summary>
          <label className="homework-rules__group"><input type="checkbox" checked={scope === "pattern"} onChange={event => { setScope(event.target.checked ? "pattern" : "course"); setMode("attempt"); }} />Limit this rule to a confirmed group</label>
          {scope === "pattern" && <Field label="Exact group ID" hint="For example: weekly-problem-set. This is a saved group ID, not words to match in a title. Only assignments confirmed in this group are included."><input value={patternId} maxLength={256} onChange={event => setPatternId(event.target.value)} /></Field>}
        </details>}
      </fieldset>
      <fieldset disabled={busy} className="homework-rules__actions"><legend>2. Choose what I may do</legend>
        {actions.map(action => <label key={action.mode} className={mode === action.mode ? "is-selected" : ""}>
          <input type="radio" name="homework-permission" value={action.mode} checked={mode === action.mode} onChange={() => setMode(action.mode)} />
          <span><strong>{action.title}</strong><small>{action.detail}</small></span>
        </label>)}
      </fieldset>
      <div className="homework-rules__summary" aria-live="polite" id="homework-rule-summary">
        {problem ?? <><strong>For {target}:</strong> {actions.find(action => action.mode === mode)?.detail}</>}
      </div>
      <button className="button button--coral" disabled={busy || Boolean(problem)} aria-describedby="homework-rule-summary">Save rule</button>
    </form>
    <div className="rules-list">
      <h3>Saved rules</h3>
      {rules.map(rule => <div key={rule.ruleId}><span><strong>{ruleTarget(rule, onboarding)}</strong><small>{actions.find(action => action.mode === rule.mode)?.title}</small></span><button type="button" className="quiet-button" disabled={busy} aria-label={`Remove rule for ${ruleTarget(rule, onboarding)}`} onClick={() => onDeleteRule(rule.ruleId)}>Remove</button></div>)}
      {rules.length === 0 && <p>No rules yet. I won’t start homework without one.</p>}
      <small>An assignment rule overrides a group rule, then a class rule, then an all-homework rule. At the same level, the newest matching rule wins. With no matching rule, I won’t start.</small>
    </div>
  </PaperCard>;
}

function courseName(id: string, onboarding: SchoolOnboardingState) {
  return onboarding.courses.find(course => course.courseId === id)?.label ?? `Unavailable class (${id})`;
}
function ruleTarget(rule: PermissionRule, onboarding: SchoolOnboardingState): string {
  if (rule.scope === "global") return "All homework";
  if (rule.scope === "course") return courseName(rule.courseId, onboarding);
  if (rule.scope === "pattern") return `${courseName(rule.courseId, onboarding)} · Group: ${rule.patternId}`;
  return onboarding.assignments.find(item => item.assignmentId === rule.assignmentId)?.title ?? `Unavailable assignment (${rule.assignmentId})`;
}
