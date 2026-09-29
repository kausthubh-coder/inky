import "./homework.css";
import { useEffect, useState } from "react";
import { scanWaitingFor, type Assignment, type LibraryState, type LifecycleState, type ProductSettingsState, type SchoolOnboardingState } from "../../shared/index.js";
import { Character } from "./Character.js";
import type { DotState } from "../../shared/characters/states.js";
import { Icon } from "./Icon.js";
import { HomeworkMenu } from "./HomeworkMenu.js";
import { courseLabel, courseTone } from "./assignmentPresentation.js";
import { readDevPreviewConfig } from "./devPreview.js";
import { dueLine, homeworkAction, homeworkFix, homeworkItems, homeworkLine, isDone, needsYou, shortCourse, type HomeworkItem } from "./homeworkItems.js";
import { calendarWeek, localDateKey } from "./weekCalendar.js";

export const RULE_LABELS = {
  do_not_attempt: "Leave it to me",
  attempt: "Do it, I'll hand it in",
  auto_submit: "Do it and hand it in",
} as const;

type View = "week" | "list" | "all";

export function HomeworkHome({ onboarding, lifecycle, library, settings, onOpen, onStart, onAsk, onSchool, onRefresh, onSettings }: {
  onboarding: SchoolOnboardingState;
  lifecycle: LifecycleState;
  library: LibraryState | null;
  settings: ProductSettingsState | null;
  onOpen: (assignmentId: string) => void;
  onStart: (taskId: string) => void;
  onAsk: (assignment: Assignment) => void;
  onSchool: () => void;
  onRefresh: () => Promise<void>;
  onSettings: () => void;
}) {
  const preview = readDevPreviewConfig()?.id;
  const [view, setView] = useState<View>(preview?.startsWith("today") ? "list" : "week");
  const [weekOffset, setWeekOffset] = useState(0);
  const [clock, setClock] = useState(() => new Date());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const items = homeworkItems(onboarding, library?.tasks ?? [], lifecycle);
  const needs = items.filter(needsYou);
  const working = items.find((item) => item.record.state === "working" || item.record.state === "handing_in");
  const scan = onboarding.scan?.state;
  const busy = Boolean(working) || scan === "running";
  const course = (courseId: string) => courseLabel(courseId, onboarding.courses);
  const tone = (courseId: string) => courseTone(course(courseId), onboarding.courses);
  const globalRule = settings?.permissionRules.find((rule) => rule.scope === "global")?.mode ?? "do_not_attempt";

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
  const act = (item: HomeworkItem) => {
    const action = homeworkAction(item);
    if (action.start && item.task && item.task.permission.mayAttempt && !busy) onStart(item.task.task.taskId);
    else onOpen(item.assignment.assignmentId);
  };

  const headline = homeHeadline({ needs, working, scan, waiting: scanWaitingFor(onboarding.scan), next: items.find((item) => item.record.state === "not_started" || item.record.state === "scheduled"), busy });
  const primary = headline.button
    ? <button className="rd-button rd-primary hw-fix" onClick={() => (needs[0] ? onOpen(needs[0].assignment.assignmentId) : onSchool())}>{headline.button}</button>
    : null;

  const row = (item: HomeworkItem, lead = false) => (
    <HomeworkRow key={item.assignment.assignmentId} item={item} course={shortCourse(course(item.assignment.courseId))} tone={tone(item.assignment.courseId)}
      now={clock} line={homeworkLine(item, busy)} lead={lead} busy={pending}
      onOpen={() => onOpen(item.assignment.assignmentId)} onAct={() => act(item)} onAsk={() => onAsk(item.assignment)} onChange={(operation) => void run(operation)} />
  );

  return (
    <div className={`rd-column hw-home ${view === "week" ? "rd-wide" : ""}`}>
      <header className={`hw-hello ${view === "all" ? "is-plain" : ""}`}>
        {view !== "all" && <Character state={headline.dot} size={64} label="Dot" />}
        <div className="hw-hello-copy">
          <h1>{view === "all" ? "Everything Dot found" : headline.title}</h1>
          <p>{view === "all" ? "By class. Open anything that looks wrong." : headline.sub}</p>
        </div>
        <div className="hw-hello-actions">
          {view !== "all" && primary}
          <div className="rd-segment hw-views" role="group" aria-label="Homework view">
            {(["week", "list", "all"] as const).map((name) => (
              <button key={name} aria-pressed={view === name} onClick={() => setView(name)}>{name === "week" ? "Week" : name === "list" ? "List" : "All"}</button>
            ))}
          </div>
        </div>
      </header>
      {error && <p className="rd-error" role="alert">{error}</p>}
      {onboarding.courseConflicts?.map((conflict) => (
        <p className="hw-conflict" role="status" key={conflict.courseIds.join()}>{conflict.reason} <button className="rd-link" onClick={onSettings}>See the rules</button></p>
      ))}
      {onboarding.assignmentConflicts?.map((conflict) => <p className="hw-conflict" role="status" key={conflict.assignmentIds.join()}>{conflict.reason}</p>)}
      {view === "week" && <WeekBoard items={items} clock={clock} offset={weekOffset} onOffset={setWeekOffset} course={(id) => shortCourse(course(id))} tone={tone} busy={busy} pending={pending}
        onOpen={onOpen} onAsk={onAsk} onChange={(operation) => void run(operation)} />}
      {view === "list" && <>
        <Group title="Needs you" items={needs} row={(item) => row(item)} />
        <Group title="This week" items={items.filter((item) => !needsYou(item) && !isDone(item) && item.due !== null && item.due <= endOfWeek(clock))} row={(item, index) => row(item, !primary && !needs.length && index === 0)} />
        <Group title="Later" items={items.filter((item) => !needsYou(item) && !isDone(item) && (item.due === null || item.due > endOfWeek(clock)))} row={(item) => row(item)} />
        <Group title="Done this week" items={items.filter((item) => isDone(item) && item.due !== null && item.due > clock.getTime() - WEEK && item.due <= endOfWeek(clock))} row={(item) => row(item)} />
        {items.every(isDone) && <p className="hw-empty">Nothing left to do. Dot will add new homework when it finds it.</p>}
        <p className="hw-ruleline">Dot's rule for all homework: {RULE_LABELS[globalRule].charAt(0).toLowerCase() + RULE_LABELS[globalRule].slice(1)} · <button className="rd-link" onClick={onSettings}>Change</button></p>
      </>}
      {view === "all" && <AllHomework items={items} courses={onboarding.courses} course={course} row={(item) => row(item)} />}
    </div>
  );
}

function homeHeadline({ needs, working, scan, waiting, next, busy }: {
  needs: HomeworkItem[]; working: HomeworkItem | undefined; scan: string | undefined; waiting: ReturnType<typeof scanWaitingFor>; next: HomeworkItem | undefined; busy: boolean;
}): { dot: DotState; title: string; sub: string; button?: string } {
  const first = needs[0];
  if (first) {
    const fix = homeworkFix(first);
    return { dot: "needs", title: fix.headline, sub: needs.length > 1 ? `Then ${needs.length - 1} more. Everything else is on track.` : "Everything else is on track.", button: fix.button };
  }
  if (waiting === "sign_in") return { dot: "needs", title: "Your school needs you to sign in.", sub: "Dot was reading your classes and got signed out.", button: "Sign in" };
  if (waiting === "takeover") return { dot: "waiting", title: "The school check is paused.", sub: "You have the page. Dot carries on when you say so.", button: "Continue check" };
  if (working) return { dot: "working", title: `Dot is on ${working.assignment.title}.`, sub: "Open it to watch, or get on with your day." };
  if (scan === "running") return { dot: "scanning", title: "Dot is reading your school.", sub: "Looking through your classes for new or changed work." };
  if (next) return { dot: "idle", title: "Nothing needs you.", sub: `${next.assignment.title} is next. ${homeworkLine(next, busy)}.` };
  return { dot: "sleep", title: "Nothing needs you.", sub: "Your week is clear." };
}

const WEEK = 7 * 24 * 60 * 60 * 1000;

function endOfWeek(now: Date): number {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  end.setDate(end.getDate() + (7 - end.getDay()) % 7);
  return end.getTime();
}

function Group({ title, items, row }: { title: string; items: HomeworkItem[]; row: (item: HomeworkItem, index: number) => React.ReactNode }) {
  if (!items.length) return null;
  return (
    <section className="hw-group">
      <h2>{title} <span>{items.length}</span></h2>
      {items.map(row)}
    </section>
  );
}

function WeekBoard({ items, clock, offset, onOffset, course, tone, busy, pending, onOpen, onAsk, onChange }: {
  items: HomeworkItem[]; clock: Date; offset: number; onOffset: (update: (offset: number) => number) => void;
  course: (courseId: string) => string; tone: (courseId: string) => number; busy: boolean; pending: boolean;
  onOpen: (assignmentId: string) => void; onAsk: (assignment: Assignment) => void; onChange: (operation: () => Promise<unknown>) => void;
}) {
  const week = calendarWeek(clock, offset);
  const dayKeys = new Set(week.days.map((day) => day.key));
  const first = week.days[0]!.key;
  const card = (item: HomeworkItem, extra = "") => {
    const need = needsYou(item) && item.record.state !== "ready";
    const late = item.due !== null && item.due < clock.getTime() && !isDone(item);
    return (
      <div key={item.assignment.assignmentId} className="hw-card-wrap">
        <button className={`hw-card course-accent-${tone(item.assignment.courseId)} ${need ? "is-needs" : ""}`} onClick={() => onOpen(item.assignment.assignmentId)}>
          <strong>{item.assignment.title}</strong>
          <small>{course(item.assignment.courseId)}{extra}</small>
          <small className={need || late ? "hw-need" : ""}>{late && !need ? "Overdue · " : ""}{homeworkLine(item, busy)}</small>
        </button>
        {menu(item)}
      </div>
    );
  };
  const menu = (item: HomeworkItem) => (
    <HomeworkMenu assignment={item.assignment} done={isDone(item)} busy={pending} onAsk={() => onAsk(item.assignment)} onChange={onChange} />
  );
  // Open work outside this week: overdue from before it, after it, and work with no date.
  const elsewhere = offset === 0
    ? items.filter((item) => !isDone(item) && (item.due === null || !dayKeys.has(localDateKey(new Date(item.due)))))
    : [];
  return (
    <>
      <div className="hw-bar" data-studi-week-board="true">
        <h2>{week.title}</h2>
        <div className="hw-week-nav">
          <button className="rd-quiet" aria-label="Previous week" onClick={() => onOffset((n) => n - 1)}><Icon name="left" size={16} /></button>
          <span>{week.range}</span>
          <button className="rd-quiet" aria-label="Next week" onClick={() => onOffset((n) => n + 1)}><Icon name="right" size={16} /></button>
        </div>
      </div>
      <div className="hw-days">
        {week.days.map((day) => {
          const due = items.filter((item) => item.due !== null && localDateKey(new Date(item.due)) === day.key);
          return (
            <section className={`hw-day ${day.isToday ? "is-today" : ""}`} key={day.key} aria-label={`${day.label} ${day.date}`}>
              <header><span>{day.label}</span>{day.isToday ? <b>{day.date}</b> : <span>{day.date}</span>}</header>
              {due.filter((item) => !isDone(item)).map((item) => card(item))}
              {due.filter(isDone).map((item) => (
                <div key={item.assignment.assignmentId} className={`hw-card-wrap hw-done course-accent-${tone(item.assignment.courseId)}`}>
                  <button className="hw-done-line" title={`${item.assignment.title} · ${course(item.assignment.courseId)} · ${homeworkLine(item, busy)}`} onClick={() => onOpen(item.assignment.assignmentId)}>
                    <Icon name="check" size={13} /><span>{item.assignment.title}</span>
                  </button>
                  {menu(item)}
                </div>
              ))}
              {!due.length && <p className="hw-none">Nothing due</p>}
            </section>
          );
        })}
      </div>
      {elsewhere.length > 0 && (
        <>
          <div className="hw-bar"><h2>Coming up</h2></div>
          <div className="hw-soon">
            {elsewhere.map((item) => card(item, ` · ${item.due === null ? "Whenever" : item.due < Date.parse(first) ? "Overdue" : new Date(item.due).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`))}
          </div>
        </>
      )}
    </>
  );
}

function AllHomework({ items, courses, course, row }: {
  items: HomeworkItem[]; courses: SchoolOnboardingState["courses"]; course: (courseId: string) => string; row: (item: HomeworkItem) => React.ReactNode;
}) {
  const [filter, setFilter] = useState<"todo" | "done" | "all">("todo");
  const [query, setQuery] = useState("");
  const words = query.trim().toLocaleLowerCase();
  const shown = items.filter((item) => (filter === "all" || (filter === "done") === isDone(item))
    && (!words || `${item.assignment.title} ${course(item.assignment.courseId)}`.toLocaleLowerCase().includes(words)));
  const order = [...courses.map((item) => item.courseId), ...new Set(items.map((item) => item.assignment.courseId))];
  const courseIds = [...new Set(order)].filter((id) => shown.some((item) => item.assignment.courseId === id));
  return (
    <>
      <div className="hw-search">
        <Icon name="search" size={16} />
        <input aria-label="Search homework" placeholder="Search homework" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="rd-segment" role="group" aria-label="Show">
          {(["todo", "done", "all"] as const).map((name) => (
            <button key={name} aria-pressed={filter === name} onClick={() => setFilter(name)}>{{ todo: "To do", done: "Done", all: "All" }[name]}</button>
          ))}
        </div>
      </div>
      {courseIds.map((id) => <Group key={id} title={course(id)} items={shown.filter((item) => item.assignment.courseId === id)} row={row} />)}
      {!courseIds.length && <p className="hw-empty">Nothing here.</p>}
    </>
  );
}

function HomeworkRow({ item, course, tone, now, line, lead, busy, onOpen, onAct, onAsk, onChange }: {
  item: HomeworkItem; course: string; tone: number; now: Date; line: string; lead: boolean; busy: boolean;
  onOpen: () => void; onAct: () => void; onAsk: () => void; onChange: (operation: () => Promise<unknown>) => void;
}) {
  const a = item.assignment;
  const late = item.due !== null && item.due < now.getTime() && !isDone(item);
  return (
    <article className="hw-row">
      <button className="hw-row-main" onClick={onOpen}>
        <span className={`hw-tone course-accent-${tone}`} />
        <span>
          <strong>{a.title}</strong>
          <small>{course} · <span className={late ? "hw-need" : ""}>{dueLine(item, now)}</span> · <span className={needsYou(item) ? "hw-need" : ""}>{line}</span></small>
        </span>
      </button>
      <button className={`rd-button ${lead ? "rd-primary" : ""}`} disabled={busy} onClick={onAct}>{homeworkAction(item).label}</button>
      <HomeworkMenu assignment={a} done={isDone(item)} busy={busy} onAsk={onAsk} onChange={onChange} />
    </article>
  );
}
