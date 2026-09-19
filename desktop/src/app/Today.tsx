import { useEffect, useRef, useState } from "react";
import { assignmentWorkEligibility } from "../../shared/index.js";
import type {
  Assignment,
  LibraryState,
  LifecycleState,
  ProductSettingsState,
  SchoolOnboardingState,
} from "../../shared/index.js";
import { Inky } from "./Inky.js";
import { ChatMarkdown } from "./ChatMarkdown.js";
import { HomeworkRules } from "./HomeworkRules.js";
import {
  courseTone,
  courseLabel,
  taskStatusCopy,
} from "./assignmentPresentation.js";
import { calendarWeek, localDateKey } from "./weekCalendar.js";
import { todayGroups, type TodayItem } from "./todayGroups.js";
import { readDevPreviewConfig } from "./devPreview.js";

export const RULE_LABELS = {
  do_not_attempt: "Don't start",
  attempt: "Do it, I submit",
  auto_submit: "Do it and submit",
} as const;

export function Today({
  onboarding,
  lifecycle,
  library,
  settings,
  onOpen,
  onStart,
  onAsk,
  onSchool,
  onRefresh,
  onSettings,
}: {
  onboarding: SchoolOnboardingState;
  lifecycle: LifecycleState;
  library: LibraryState | null;
  settings: ProductSettingsState | null;
  onOpen: (id: string) => void;
  onStart: (id: string) => void;
  onAsk: (assignment: Assignment) => void;
  onSchool: () => void;
  onRefresh: () => Promise<void>;
  onSettings: () => void;
}) {
  const preview = readDevPreviewConfig()?.id;
  const [view, setView] = useState<"list" | "week" | "all">(
    preview === "week" ? "week" : "list",
  );
  const [open, setOpen] = useState<string | null>(null);
  const [shelf, setShelf] = useState<"later" | "undated" | null>(
    preview === "week-undated" ? "undated" : null,
  );
  const [filter, setFilter] = useState("All");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(() => new Date());
  const [weekOffset, setWeekOffset] = useState(0);
  const [flash, setFlash] = useState<string[]>([]);
  const previous = useRef<Map<string, string> | null>(null);
  const groups = todayGroups(
    onboarding.assignments,
    library?.tasks ?? [],
    lifecycle,
    clock,
  );
  const scanNeeds = onboarding.scan?.state === "needs_user";
  const count = groups.needs.length + Number(scanNeeds);
  const working = groups.working[0];
  const scanning = onboarding.scan?.state === "running";
  const week = calendarWeek(clock, weekOffset);
  const all = [
    ...groups.needs,
    ...groups.working,
    ...groups.next,
    ...groups.later,
    ...groups.undated,
    ...groups.done,
  ];
  const label = (id: string) => courseLabel(id, onboarding.courses);
  const generalRule =
    settings?.permissionRules.find((rule) => rule.scope === "global")?.mode ??
    onboarding.profile?.defaultPermission ??
    "do_not_attempt";
  const queueSignature = JSON.stringify(
    lifecycle.manager.entries.map((entry) => [
      entry.assignmentId,
      entry.priority,
      library?.tasks.find(
        (item) => item.assignment.assignmentId === entry.assignmentId,
      )?.task.state,
      onboarding.assignments.find(
        (item) => item.assignmentId === entry.assignmentId,
      )?.owner ?? "inky",
    ]),
  );
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const next = new Map<string, string>(
      (JSON.parse(queueSignature) as unknown[][]).map(([id, ...state]) => [
        String(id),
        JSON.stringify(state),
      ]),
    );
    if (previous.current !== null)
      setFlash(
        [...next]
          .filter(([id, state]) => previous.current!.get(id) !== state)
          .map(([id]) => id),
      );
    previous.current = next;
    const timer = setTimeout(() => setFlash([]), 1600);
    return () => clearTimeout(timer);
  }, [queueSignature]);
  const run = async (operation: () => Promise<unknown>) => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await operation();
      await onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };
  const plan = (item: TodayItem) => {
    const entry = lifecycle.manager.entries.find(
      (entry) => entry.assignmentId === item.assignment.assignmentId,
    );
    if (entry?.startRequestedAt) return working || scanning ? "Inky starts next" : "Starting shortly";
    if (entry?.scheduledStartAt)
      return `Inky starts ${new Date(entry.scheduledStartAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
    if (item.assignment.owner === "student") return "Yours";
    if (entry) return working ? "Inky starts next" : "Queued";
    return item.task?.permission.mode === "do_not_attempt"
      ? "Waiting for you"
      : "Starts when you ask";
  };
  const renderRow = (item: TodayItem, first = false) => (
    <TodayRow
      key={item.assignment.assignmentId}
      item={item}
      course={label(item.assignment.courseId)}
      now={clock}
      open={open === item.assignment.assignmentId}
      flash={flash.includes(item.assignment.assignmentId)}
      plan={plan(item)}
      first={first}
      busy={pending}
      working={Boolean(working || scanning)}
      onToggle={() =>
        setOpen((current) =>
          current === item.assignment.assignmentId
            ? null
            : item.assignment.assignmentId,
        )
      }
      onOpen={() => onOpen(item.assignment.assignmentId)}
      onAsk={() => onAsk(item.assignment)}
      onSettings={onSettings}
      onStart={() =>
        item.task
          ? onStart(item.task.task.taskId)
          : onOpen(item.assignment.assignmentId)
      }
      onAction={(operation) => void run(operation)}
    />
  );
  const section = (title: string, items: TodayItem[]) =>
    items.length > 0 && (
      <section className="today-group">
        <h2 className="rd-label">
          {title}
          <em>{items.length}</em>
        </h2>
        {items.map((item) => renderRow(item))}
      </section>
    );
  const heading =
    view === "all"
      ? "Everything I know about."
      : scanNeeds
        ? "Your school needs you."
        : count
          ? `${count === 1 ? "One thing needs" : `${count} things need`} you.`
          : working
            ? `I'm on ${working.assignment.title}.`
            : scanning
              ? "Checking school."
              : "Nothing needs you.";
  const sub =
    view === "all"
      ? "Open anything that looks wrong."
      : count
        ? "Take a look at these. I'll keep the rest here for you."
        : working
          ? "You can watch the school page while I work."
          : scanning
            ? "Looking through your classes for new or changed work."
            : groups.next.length
              ? `${groups.next[0]!.assignment.title} is up next. ${plan(groups.next[0]!)}.`
              : "Your work is here whenever you need it.";
  return (
    <div
      className={`rd-column today-column ${view === "week" ? "rd-wide" : ""}`}
    >
      <header className="rd-hello">
        <Inky
          state={
            count
              ? "waiting"
              : working
                ? "working"
                : scanning
                  ? "scanning"
                  : "sleep"
          }
          size={64}
          label="Inky"
        />
        <div>
          <h1>{heading}</h1>
          <p>{sub}</p>
        </div>
        <div className="rd-segment" aria-label="Assignment view">
          {(view === "all" ? ["All", "To do", "Done"] : ["List", "Week"]).map(
            (name) => (
              <button
                key={name}
                aria-pressed={
                  view === "all" ? filter === name : view === name.toLowerCase()
                }
                onClick={() =>
                  view === "all"
                    ? setFilter(name)
                    : setView(name.toLowerCase() as "list" | "week")
                }
              >
                {name}
              </button>
            ),
          )}
        </div>
      </header>
      {error && (
        <p className="rd-error" role="alert">
          {error}
        </p>
      )}
      {onboarding.courseConflicts?.map((conflict) => (
        <p role="status" key={conflict.courseIds.join()}>
          {conflict.reason}{" "}
          <button className="rd-quiet" onClick={onSettings}>
            Review rules
          </button>
        </p>
      ))}
      {onboarding.assignmentConflicts?.map((conflict) => (
        <p role="status" key={conflict.assignmentIds.join()}>
          {conflict.reason}
        </p>
      ))}
      {view === "all" ? (
        [...new Set(all.map((item) => item.assignment.courseId))].map(
          (courseId) => (
            <section className="today-group" key={courseId}>
              <h2 className="rd-label">{label(courseId)}</h2>
              {all
                .filter(
                  (item) =>
                    item.assignment.courseId === courseId &&
                    (filter === "All" ||
                      (filter === "Done") === groups.done.includes(item)),
                )
                .map((item) => renderRow(item))}
            </section>
          ),
        )
      ) : (
        <>
          {count > 0 && (
            <section className="today-group">
              <h2 className="rd-label">
                Needs you<em>{count}</em>
              </h2>
              {scanNeeds && (
                <div className="today-scan-row">
                  <div>
                    <strong>School sign-in</strong>
                    <p>
                      {onboarding.scan?.handoff?.reason ??
                        "The school check needs you."}
                    </p>
                  </div>
                  <button className="rd-button rd-primary" onClick={onSchool}>
                    Sign in
                  </button>
                </div>
              )}
              {groups.needs.map((item) => renderRow(item))}
            </section>
          )}
          {section("Inky now", groups.working)}
          {view === "week" ? (
            <section className="today-group" data-studi-week-board="true">
              <div className="rd-section">
                <h2 className="rd-label">This week</h2>
                <div className="rd-week-nav">
                  <button
                    className="rd-quiet"
                    aria-label="Previous week"
                    onClick={() => setWeekOffset((n) => n - 1)}
                  >
                    ‹
                  </button>
                  <span>{week.range}</span>
                  <button
                    className="rd-quiet"
                    aria-label="Next week"
                    onClick={() => setWeekOffset((n) => n + 1)}
                  >
                    ›
                  </button>
                </div>
              </div>
              <div className="rd-week">
                {week.days.map((day) => (
                  <section
                    className={`rd-day ${day.isToday ? "is-today" : ""}`}
                    key={day.key}
                  >
                    <header>
                      {day.label}
                      <span>{day.date}</span>
                    </header>
                    {all
                      .filter(
                        (item) =>
                          !groups.done.includes(item) &&
                          item.due !== null &&
                          localDateKey(new Date(item.due)) === day.key,
                      )
                      .map((item) => (
                        <button
                          className={`rd-week-card course-accent-${courseTone(label(item.assignment.courseId))}`}
                          key={item.assignment.assignmentId}
                          onClick={() => {
                            setView("list");
                            setOpen(item.assignment.assignmentId);
                          }}
                        >
                          <strong>{item.assignment.title}</strong>
                          <span>{label(item.assignment.courseId)}</span>
                          <span
                            className={
                              item.due! < clock.getTime() ? "rd-late" : ""
                            }
                          >
                            {item.due! < clock.getTime() ? "Overdue · " : ""}
                            {taskStatusCopy(item.phase).label}
                          </span>
                        </button>
                      ))}
                    {!all.some(
                      (item) =>
                        !groups.done.includes(item) &&
                        item.due !== null &&
                        localDateKey(new Date(item.due)) === day.key,
                    ) && <p>Nothing due</p>}
                  </section>
                ))}
              </div>
            </section>
          ) : (
            <section className="today-group">
              <div className="rd-section">
                <h2 className="rd-label">Up next</h2>
                <div className="rd-ruleline">
                  Inky's rule: <b>{RULE_LABELS[generalRule]}</b>
                  <span>
                    ·{" "}
                    {settings?.permissionRules.filter(
                      (rule) => rule.scope !== "global",
                    ).length ?? 0}{" "}
                    more specific
                  </span>
                  <button
                    className="rd-quiet"
                    aria-expanded={rulesOpen}
                    onClick={() => setRulesOpen(!rulesOpen)}
                  >
                    Change <span aria-hidden="true">⌄</span>
                  </button>
                </div>
              </div>
              {rulesOpen && (
                <HomeworkRules
                  rules={settings?.permissionRules ?? []}
                  onboarding={onboarding}
                  busy={pending}
                  onSaveRule={(input) =>
                    void run(() => window.studi!.savePermissionRule(input))
                  }
                  onDeleteRule={(ruleId) =>
                    void run(() =>
                      window.studi!.deletePermissionRule({ ruleId }),
                    )
                  }
                />
              )}
              {groups.next.map((item, index) =>
                renderRow(item, index === 0 && !working && !scanning),
              )}
              {!groups.next.length && (
                <p className="rd-muted">
                  Nothing else due in the next seven days.
                </p>
              )}
            </section>
          )}
        </>
      )}
      <div className="rd-shelf">
        {view !== "all" && (
          <>
            {(["later", "undated"] as const).map((key) => (
              <button
                className="rd-disclosure"
                key={key}
                aria-expanded={shelf === key}
                onClick={() => setShelf(shelf === key ? null : key)}
              >
                {key === "later" ? "Later" : "No due date"}{" "}
                <em>{groups[key].length}</em> ⌄
              </button>
            ))}
          </>
        )}
        <button
          className="rd-quiet"
          aria-expanded={adding}
          onClick={() => setAdding(!adding)}
        >
          + Add homework
        </button>
        <button
          className="rd-link"
          onClick={() => setView(view === "all" ? "list" : "all")}
        >
          {view === "all" ? "← Back to today" : "All work →"}
        </button>
      </div>
      {adding && (
        <form
          className="rd-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim())
              void run(async () => {
                await window.studi!.addAssignment({ text: title.trim() });
                setTitle("");
                setAdding(false);
              });
          }}
        >
          <input
            autoFocus
            aria-label="Homework link or title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Paste a link from your school, or type a title"
            required
            maxLength={2048}
          />
          <button className="rd-button" disabled={pending}>
            Add
          </button>
          <button
            className="rd-quiet"
            type="button"
            onClick={() => setAdding(false)}
          >
            Cancel
          </button>
        </form>
      )}
      {view !== "all" && shelf && groups[shelf].map((item) => renderRow(item))}
      {view !== "all" &&
        count === 0 &&
        section("Handed in this week", groups.submitted)}
    </div>
  );
}

function TodayRow({
  item,
  course,
  now,
  open,
  flash,
  plan,
  first,
  busy,
  working,
  onToggle,
  onOpen,
  onAsk,
  onStart,
  onSettings,
  onAction,
}: {
  item: TodayItem;
  course: string;
  now: Date;
  open: boolean;
  flash: boolean;
  plan: string;
  first: boolean;
  busy: boolean;
  working: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onAsk: () => void;
  onStart: () => void;
  onSettings: () => void;
  onAction: (action: () => Promise<unknown>) => void;
}) {
  const [wrong, setWrong] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [date, setDate] = useState("");
  const a = item.assignment;
  const done =
    ["submitted", "graded"].includes(a.schoolStatus?.state ?? "") ||
    item.phase === "submitted" ||
    item.task?.task.state === "ignored";
  const needs = item.phase === "needs_user" || item.phase === "ready_review";
  const live = ["working", "submitting"].includes(item.phase);
  const execution = item.task?.execution;
  const need = execution?.returnPredicate ?? execution?.lastError ?? "";
  const starting = first && !done && !needs && !live;
  const startBlocked = starting && (working || !item.task?.permission.mayAttempt || !assignmentWorkEligibility(a, now.toISOString()).eligible);
  const actionLabel =
    item.phase === "ready_review"
      ? "Review"
      : needs
        ? /file|upload|csv|pdf/i.test(need)
          ? "Add files"
          : /sign.?in|log.?in/i.test(need)
            ? "Sign in"
            : "Continue"
        : live
          ? "Watch"
          : done
            ? "Receipt"
            : first
              ? "Start"
              : null;
  return (
    <article
      className={`today-card course-accent-${courseTone(course)} ${open ? "is-open" : ""} ${flash ? "is-flashing" : ""}`}
    >
      <div className={`today-item ${!needs && !live ? "is-calm" : ""}`}>
        <button
          className="today-item-main"
          aria-expanded={open}
          aria-controls={`details-${a.assignmentId}`}
          onClick={onToggle}
        >
          <span className="today-course-edge" />
          <span>
            <strong>{a.title}</strong>
            <span className="today-meta">
              {course} ·{" "}
              {item.due !== null ? (
                <span
                  className={!done && item.due < now.getTime() ? "rd-late" : ""}
                >
                  {!done && item.due < now.getTime() ? "Overdue · " : "Due "}
                  {new Date(item.due).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              ) : (
                "No due date"
              )}
              {needs ? ` · ${need || taskStatusCopy(item.phase).label}` : ""}
              {a.dueDateOverride ? " · date set by you" : ""}
            </span>
          </span>
        </button>
        {actionLabel ? (
          <button
            className={`rd-button ${item.phase === "ready_review" ? "rd-primary" : ""}`}
            disabled={busy || startBlocked}
            onClick={first && !done && !needs && !live ? onStart : onOpen}
          >
            {actionLabel}
          </button>
        ) : (
          <span className="today-when">{plan}</span>
        )}
        <button
          className="rd-caret"
          aria-label={`${open ? "Close" : "Open"} ${a.title} details`}
          aria-expanded={open}
          onClick={onToggle}
        >
          ⌄
        </button>
      </div>
      {open && (
        <div className="today-more" id={`details-${a.assignmentId}`}>
          <dl>
            <dt>What it asks</dt>
            <dd>
              <ChatMarkdown
                text={
                  a.instructions ??
                  a.requirementEvidence
                    ?.map((item) => item.text)
                    .join("\n\n") ??
                  "Open the school page to see the full instructions."
                }
              />
            </dd>
            <dt>Found on</dt>
            <dd>
              {a.sourceTarget ? (
                <button className="rd-link" onClick={onOpen}>
                  School page ↗
                </button>
              ) : (
                "Added by you"
              )}
            </dd>
            <dt>Inky's plan</dt>
            <dd>
              {plan}.{" "}
              {item.task
                ? RULE_LABELS[item.task.permission.mode]
                : "Check the details before starting."}
            </dd>
          </dl>
          <div className="today-actions">
            {!done &&
              !needs &&
              !live &&
              item.task && (!working || ["discovered", "queued", "failed", "cancelled"].includes(item.task.task.state)) && (
                <button
                  className="rd-button"
                  disabled={busy || !item.task.permission.mayAttempt || !assignmentWorkEligibility(a, now.toISOString()).eligible}
                  onClick={() =>
                    working && item.task
                      ? onAction(() => window.studi!.queueAssignmentNext({ taskId: item.task!.task.taskId }))
                      : onStart()
                  }
                >
                  {working ? "Do this next" : "Start now"}
                </button>
              )}
            {!done && (
              <button
                className="rd-quiet"
                disabled={busy}
                onClick={() =>
                  onAction(() =>
                    window.studi!.setAssignmentOwner({
                      assignmentId: a.assignmentId,
                      owner: a.owner === "student" ? "inky" : "student",
                    }),
                  )
                }
              >
                {a.owner === "student"
                  ? "Give it back to Inky"
                  : "I'll do it myself"}
              </button>
            )}
            <button className="rd-ask" onClick={onAsk}>
              <Inky state="hello" size={22} />
              Ask Inky about it
            </button>
            <button
              className="rd-wrong"
              aria-expanded={wrong}
              onClick={() => setWrong(!wrong)}
            >
              Something wrong?
            </button>
          </div>
          <button className="rd-link rd-small" onClick={onSettings}>
            Rule for this assignment →
          </button>
          {wrong && (
            <div className="today-wrong">
              <span className="rd-muted">What's wrong with it?</span>
              <div className="rd-chips">
                <button
                  className="rd-quiet"
                  onClick={() => setDateOpen(!dateOpen)}
                >
                  Wrong due date
                </button>
                <button
                  className="rd-quiet"
                  disabled={busy}
                  onClick={() =>
                    onAction(() =>
                      window.studi!.correctAssignment({
                        assignmentId: a.assignmentId,
                        correction: "not_homework",
                      }),
                    )
                  }
                >
                  This isn't homework
                </button>
                <button
                  className="rd-quiet"
                  disabled={busy || !a.sourceTarget}
                  onClick={() =>
                    onAction(() =>
                      window.studi!.startSchoolScan({
                        assignmentId: a.assignmentId,
                      }),
                    )
                  }
                >
                  Details look wrong
                </button>
                <button
                  className="rd-quiet"
                  disabled={busy}
                  onClick={() =>
                    onAction(() =>
                      window.studi!.correctAssignment({
                        assignmentId: a.assignmentId,
                        correction: "already_done",
                      }),
                    )
                  }
                >
                  I already did it
                </button>
              </div>
              {dateOpen && (
                <form
                  className="rd-inline-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (date)
                      onAction(() =>
                        window.studi!.correctAssignment({
                          assignmentId: a.assignmentId,
                          correction: "due_date",
                          dueAt: new Date(date).toISOString(),
                        }),
                      );
                  }}
                >
                  <label>
                    Correct due date
                    <input
                      type="datetime-local"
                      value={date}
                      onChange={(event) => setDate(event.target.value)}
                      required
                    />
                  </label>
                  <button className="rd-button" disabled={busy}>
                    Save date
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
