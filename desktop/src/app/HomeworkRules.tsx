import { useEffect, useState } from "react";
import type {
  PermissionMode,
  PermissionRule,
  SchoolOnboardingState,
  StudiRendererApi,
} from "../../shared/index.js";
import { permissionRuleTargetKey } from "../../shared/index.js";
import { courseLabel } from "./assignmentPresentation.js";
import "./homework-rules.css";

type RuleInput = Parameters<StudiRendererApi["savePermissionRule"]>[0];
const modes = [
  { id: "do_not_attempt", label: "Don’t start" },
  { id: "attempt", label: "Do it, I submit" },
  { id: "auto_submit", label: "Do it and submit" },
] as const;
const kinds = [
  ["quiz", "Quizzes"],
  ["problem_set", "Problem sets"],
  ["essay", "Essays"],
  ["code", "Coding"],
  ["discussion", "Discussions"],
  ["reading", "Reading"],
  ["group_work", "Group work"],
] as const;
export function HomeworkRules({
  rules,
  onboarding,
  busy,
  onSaveRule,
  onDeleteRule,
}: {
  rules: readonly PermissionRule[];
  onboarding: SchoolOnboardingState;
  busy: boolean;
  onSaveRule: (input: RuleInput) => void;
  onDeleteRule: (id: string) => void;
}) {
  const [scope, setScope] = useState<
    "global" | "course" | "pattern" | "assignment"
  >("global");
  const [courseId, setCourse] = useState(onboarding.courses[0]?.courseId ?? ""),
    [kind, setKind] = useState("quiz"),
    [assignmentId, setAssignment] = useState(
      onboarding.assignments[0]?.assignmentId ?? "",
    );
  const [mode, setMode] = useState<PermissionMode>("attempt"),
    [checker, setChecker] = useState(""),
    [checking, setChecking] = useState(false),
    [verdict, setVerdict] = useState("");
  const input =
    scope === "global"
      ? { scope, mode }
      : scope === "assignment"
        ? { scope, assignmentId, mode }
        : scope === "pattern"
          ? { scope, courseId, patternId: kind, mode }
          : { scope, courseId, mode };
  const existing = rules.find(
    (rule) => permissionRuleTargetKey(rule) === permissionRuleTargetKey(input),
  );
  const targetKey = permissionRuleTargetKey(input);
  useEffect(() => {
    setMode(existing?.mode ?? "attempt");
  }, [targetKey, existing?.mode]);
  const valid =
    scope === "global" ||
    (scope === "assignment" ? !!assignmentId : !!courseId);
  const check = async (id: string) => {
    setChecker(id);
    setVerdict("");
    if (!id) return;
    setChecking(true);
    try {
      const library = await window.studi!.getLibraryState();
      const task = library.tasks.find(
        (item) => item.assignment.assignmentId === id,
      );
      setVerdict(
        task
          ? modes.find((mode) => mode.id === task.permission.mode)!.label +
              ". " +
              (task.permission.matchedRuleId
                ? targetLabel(
                    rules.find(
                      (rule) => rule.ruleId === task.permission.matchedRuleId,
                    ),
                    onboarding,
                  )
                : "No matching rule.")
          : "Check school to load the rules for this assignment.",
      );
    } catch (cause) {
      setVerdict(String(cause));
    } finally {
      setChecking(false);
    }
  };
  return (
    <section className="settings-card homework-rules rd-rules">
      <h2>Homework rules</h2>
      <p>You decide what I may start, and what I may hand in.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !busy) onSaveRule(input);
        }}
      >
        <div className="rd-rule-target">
          <label>
            For
            <select
              aria-label="Apply this rule to"
              disabled={busy}
              value={scope}
              onChange={(event) => setScope(event.target.value as typeof scope)}
            >
              <option value="global">All homework</option>
              <option value="course">One class</option>
              <option value="pattern">A kind in a class</option>
              <option value="assignment">One assignment</option>
            </select>
          </label>
          {(scope === "course" || scope === "pattern") && (
            <label>
              Class
              <select
                aria-label="Which class?"
                disabled={busy}
                value={courseId}
                onChange={(event) => setCourse(event.target.value)}
              >
                {onboarding.courses.map((course) => (
                  <option key={course.courseId} value={course.courseId}>
                    {course.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {scope === "pattern" && (
            <label>
              Kind
              <select
                aria-label="Which kind?"
                disabled={busy}
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                {kinds.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {scope === "assignment" && (
            <label>
              Assignment
              <select
                aria-label="Which assignment?"
                disabled={busy}
                value={assignmentId}
                onChange={(event) => setAssignment(event.target.value)}
              >
                {onboarding.assignments.map((item) => (
                  <option key={item.assignmentId} value={item.assignmentId}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <fieldset className="rd-rule-modes" disabled={busy}>
          <legend>Inky can</legend>
          {modes.map((item) => (
            <label key={item.id} className={mode === item.id ? "selected" : ""}>
              <input
                type="radio"
                name="permission-mode"
                checked={mode === item.id}
                onChange={() => setMode(item.id)}
              />
              <span>{item.label}</span>
            </label>
          ))}
        </fieldset>
        <p className="rd-rule-explanation">
          {mode === "auto_submit"
            ? "I can do the work and submit it after your review time."
            : mode === "attempt"
              ? "I’ll do the work, then stop for you to submit."
              : "I’ll leave this homework to you."}
          {scope === "pattern" &&
            " This only applies when the assignment kind is confirmed."}
        </p>
        <button
          className="rd-button primary"
          disabled={busy || !valid || existing?.mode === mode}
        >
          {existing?.mode === mode
            ? "Saved"
            : existing
              ? "Update rule"
              : "Save rule"}
        </button>
      </form>
      <div className="rd-rule-list">
        {rules.map((rule) => (
          <div key={rule.ruleId}>
            <span>{targetLabel(rule, onboarding)}</span>
            <b>{modes.find((item) => item.id === rule.mode)?.label}</b>
            <button
              className="rd-link"
              disabled={busy}
              aria-label={"Remove rule for " + targetLabel(rule, onboarding)}
              onClick={() => onDeleteRule(rule.ruleId)}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <p className="rd-rule-footnote">
        A rule for one assignment comes first, then its kind, then its class,
        then all homework. With no rule, I won’t start.
      </p>
      <details className="rd-rule-checker">
        <summary>Which rule applies?</summary>
        <label>
          Check an assignment
          <select
            value={checker}
            disabled={checking}
            onChange={(event) => void check(event.target.value)}
          >
            <option value="">Choose an assignment…</option>
            {onboarding.assignments.map((item) => (
              <option key={item.assignmentId} value={item.assignmentId}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        {(checking || verdict) && (
          <p role="status">{checking ? "Checking its saved rule…" : verdict}</p>
        )}
      </details>
    </section>
  );
}
function targetLabel(
  rule: PermissionRule | undefined,
  onboarding: SchoolOnboardingState,
): string {
  if (!rule) return "The saved rule applies.";
  if (rule.scope === "global") return "All homework";
  if (rule.scope === "assignment")
    return (
      onboarding.assignments.find(
        (item) => item.assignmentId === rule.assignmentId,
      )?.title ?? "One assignment"
    );
  const course =
    courseLabel(rule.courseId, onboarding.courses);
  return rule.scope === "pattern"
    ? course +
        " · " +
        (kinds.find(([id]) => id === rule.patternId)?.[1] ?? rule.patternId)
    : course;
}
