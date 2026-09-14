import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import {
  activityById,
  unavailableReason,
  type Activity,
  type SchoolState,
  type Service,
} from "./domain.js";

export type Origins = Record<Service, string>;
const labels: Record<Service, string> = {
  school: "Cedar Learning",
  statistics: "Statistics Homework",
  builds: "Course Builds",
  feedback: "Feedback & Grades",
};
export function activityUrl(activity: Activity, origins: Origins): string {
  return `${origins[activity.service]}/assignments/${encodeURIComponent(activity.id)}`;
}
const css = `*{box-sizing:border-box}body{margin:0;background:#f5f6f8;color:#243041;font:16px/1.6 system-ui,Segoe UI,sans-serif}a{color:#155aa4;text-underline-offset:3px}a:hover{text-decoration-thickness:2px}header{background:#243c5c;color:white;padding:20px 32px;display:flex;align-items:center;justify-content:space-between;gap:24px}header strong{font-size:20px}header a{color:white}.shell{display:grid;grid-template-columns:220px 1fr;min-height:90vh}nav{padding:30px 22px;background:white;border-right:1px solid #dfe4eb}nav a{display:block;padding:9px 0;color:#3e526d}main{max-width:1100px;padding:36px 48px 70px;min-width:0}h1{font-size:32px;line-height:1.25;margin:8px 0 20px}h2{font-size:22px;margin:28px 0 14px}h3{font-size:18px;margin:18px 0 8px}.muted,small{color:#5d6979}.eyebrow{font-size:13px;color:#556c88}.notice{padding:16px 20px;background:#edf4fc;border-left:4px solid #487aaf;margin:18px 0}.warning{background:#fff4df;border-color:#a76911}.success{background:#e9f5ec;border-color:#378052}.course-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.course-card{background:white;border:1px solid #dfe4eb;border-radius:5px;padding:20px}.course-card h2{font-size:20px;margin:3px 0 10px}.list{padding:0;list-style:none}.list>li{padding:18px 0;border-bottom:1px solid #dfe4eb}.list a{font-weight:600}.status{display:inline-block;font-size:12px;border-radius:3px;background:#e8edf3;padding:2px 7px;margin-left:8px}table{border-collapse:collapse;width:100%;background:white}th,td{text-align:left;padding:12px;border:1px solid #dde3eb}th{background:#eaf0f6}label{font-weight:600;display:block;margin:16px 0 7px}textarea{width:100%;min-height:180px;padding:12px;border:1px solid #8b9bb0;border-radius:4px;font:inherit}input{max-width:100%}button,.button{display:inline-block;background:#235f9e;border:1px solid #235f9e;border-radius:4px;color:white;padding:10px 18px;font:600 15px system-ui;cursor:pointer;text-decoration:none}button.secondary{background:white;color:#235f9e}button:disabled{background:#e2e6eb;color:#66788d;border-color:#bdc6d2;cursor:default}.actions{display:flex;gap:12px;margin:20px 0;flex-wrap:wrap}code{overflow-wrap:anywhere}details{margin:14px 0}summary{cursor:pointer;font-weight:600}.table-wrap{overflow:auto}.skip{position:absolute;left:-9999px}.skip:focus{left:15px;top:15px;background:white;color:#243041;padding:10px;z-index:5}:focus-visible{outline:3px solid #d39224;outline-offset:3px}.footer{font-size:12px;color:#667488;margin-top:36px}@media(max-width:720px){header{padding:16px;flex-wrap:wrap}.shell{display:block}nav{padding:10px 16px;display:flex;gap:20px;flex-wrap:wrap}main{padding:25px 18px}.course-grid{grid-template-columns:1fr}h1{font-size:27px}}`;
export function page(
  state: SchoolState,
  origins: Origins,
  service: Service,
  title: string,
  content: ReactNode,
): string {
  return (
    "<!doctype html>" +
    renderToStaticMarkup(
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <title>{`${title} | ${labels[service]}`}</title>
          <style>{css}</style>
        </head>
        <body data-studi-fixture="school">
          <a className="skip" href="#main">
            Skip to content
          </a>
          <header>
            <strong>{labels[service]}</strong>
            <span>
              Alex Morgan · Student &nbsp;{" "}
              <a href={`${origins[service]}/account`}>Account</a>
            </span>
          </header>
          <div className="shell">
            <nav aria-label="School navigation">
              <a href={`${origins.school}/`}>Dashboard</a>
              <a href={`${origins.school}/courses`}>My courses</a>
              <a href={`${origins.school}/calendar`}>Calendar</a>
              <a href={`${origins.school}/announcements`}>Announcements</a>
              <a href={`${origins.school}/grades`}>Grades</a>
              <a href={`${origins.statistics}/`}>Statistics homework</a>
              <a href={`${origins.builds}/`}>Build reports</a>
              <a href={`${origins.feedback}/`}>Feedback</a>
            </nav>
            <main id="main">
              <div className="eyebrow">
                Fall 2026 · School time {state.clock.slice(0, 10)} ·{" "}
                {state.timezone}
              </div>
              <h1>{title}</h1>
              {content}
              <p className="footer">
                Cedar Learning is a local simulated school. All actions affect
                this local school only.
              </p>
            </main>
          </div>
        </body>
      </html>,
    )
  );
}
function status(state: SchoolState, item: Activity): string {
  if (item.status === "unknown")
    return "Submission status unknown; verify the linked system";
  if (item.prerequisites.some((id) => !state.completed.includes(id)))
    return "Locked: prerequisites incomplete";
  if (item.status === "graded")
    return item.gradeVisible
      ? `Graded: ${item.grade ?? "not released"}`
      : "Submitted; grade hidden";
  if (item.status === "submitted") return "Submitted; not yet graded";
  if (state.drafts[item.id]) return "Draft saved; not submitted";
  return "Not submitted";
}
function rows(
  state: SchoolState,
  origins: Origins,
  activities: Activity[],
  dashboard = false,
): ReactNode {
  return (
    <ul className="list">
      {activities.map((item) => (
        <li key={item.id}>
          <a href={activityUrl(item, origins)}>{item.title}</a>
          <span className="status">{status(state, item)}</span>
          <div>
            {dashboard ? (item.dashboardDueText ?? item.dueText) : item.dueText}
          </div>
          <small>
            {state.courses.find((course) => course.id === item.courseId)?.title}{" "}
            · {item.module}
          </small>
        </li>
      ))}
    </ul>
  );
}
export function renderPublic(
  state: SchoolState,
  origins: Origins,
  service: Service,
  url: URL,
  csrf: string,
  message?: string,
): string {
  const path = url.pathname;
  const render = (title: string, content: ReactNode) =>
    page(
      state,
      origins,
      service,
      title,
      <>
        {message && (
          <p role="status" className="notice success">
            {message}
          </p>
        )}
        {content}
      </>,
    );
  if (path === "/login")
    return render(
      "Sign in to your course site",
      <>
        <p>This course site has its own sign-in session.</p>
        <form method="post" action="/login">
          <input type="hidden" name="csrf" value={csrf} />
          <button>Continue as Alex Morgan</button>
        </form>
      </>,
    );
  if (path === "/account")
    return render(
      "Your account",
      <>
        <p>Alex Morgan · Student</p>
        <form method="post" action="/logout">
          <input type="hidden" name="csrf" value={csrf} />
          <button className="secondary">Sign out of this site</button>
        </form>
      </>,
    );
  if (path === "/" && service === "builds")
    return render(
      "Build reports",
      <>
        <p>
          Each report applies to the revision shown. The most recent revision is
          rev-current.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Revision</th>
                <th>Result</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {state.builds.map((build) => (
                <tr key={build.revision}>
                  <td>{build.revision}</td>
                  <td>{build.state}</td>
                  <td>{build.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>,
    );
  if (path === "/" && service !== "school") {
    const vendorActivities = state.activities.filter(
      (item) => item.service === service,
    );
    return render(
      labels[service],
      <section aria-labelledby="assignment-list-heading" data-assignment-list>
        <h2 id="assignment-list-heading">Assignments</h2>
        {vendorActivities.length > 0 ? (
          rows(state, origins, vendorActivities)
        ) : (
          <p>No assignments are published on this site.</p>
        )}
      </section>,
    );
  }
  if (path === "/" || path === "/courses")
    return render(
      path === "/" ? "Dashboard" : "My courses",
      <>
        {path === "/" && (
          <>
            <p className="notice">
              Find course activities below. The timeline is a summary; check
              activity pages for detailed requirements, submission status, and
              extensions.
            </p>
            <h2>Upcoming and recent work</h2>
            {rows(
              state,
              origins,
              state.activities
                .filter((item) => !item.id.includes("-reading-"))
                .slice(0, 5),
              true,
            )}
            <a href="/calendar">View the full calendar</a>
          </>
        )}
        <h2>Course directory</h2>
        {state.courses.length === 0 && <p>No courses found.</p>}
        <div className="course-grid">
          {state.courses.map((course) => (
            <article className="course-card" key={course.id}>
              <small>{course.code}</small>
              <h2>
                <a href={`/courses/${course.id}`}>{course.title}</a>
              </h2>
              <p>
                {
                  state.activities.filter((item) => item.courseId === course.id)
                    .length
                }{" "}
                activities
              </p>
              {course.aliases.map((alias) => (
                <div key={alias}>
                  <a href={`/course/view.php?id=${course.id}`}>{alias}</a>{" "}
                  <small>same course</small>
                </div>
              ))}
            </article>
          ))}
        </div>
      </>,
    );
  const courseMatch = /^\/courses\/([^/]+)$/.exec(path);
  if (courseMatch) {
    const course = state.courses.find(
      (item) => item.id === decodeURIComponent(courseMatch[1]!),
    );
    if (!course)
      return render("Course not found", <p>Return to the course directory.</p>);
    const all = state.activities.filter((item) => item.courseId === course.id),
      pageNumber = Math.max(1, Number(url.searchParams.get("page")) || 1),
      size = 5;
    const entries = all.slice((pageNumber - 1) * size, pageNumber * size);
    return render(
      course.title,
      <>
        <p>
          {course.code} · Activities{" "}
          {Math.min((pageNumber - 1) * size + 1, all.length)}–
          {Math.min(pageNumber * size, all.length)} of {all.length}
        </p>
        <h2>Assignments and modules</h2>
        {entries.length ? (
          rows(state, origins, entries)
        ) : (
          <p>No activities found.</p>
        )}
        <div className="actions">
          {pageNumber > 1 && (
            <a href={`?page=${pageNumber - 1}`}>Previous page</a>
          )}
          {pageNumber * size < all.length && (
            <a href={`?page=${pageNumber + 1}`}>Next page</a>
          )}
        </div>
        <details>
          <summary>Week 6 · No work posted</summary>
          <p>No assignments are published in this section.</p>
        </details>
      </>,
    );
  }
  if (path === "/calendar")
    return render(
      "Course calendar",
      <>
        <p>
          Some activities have date-only or unresolved deadlines. Check each
          detail page before acting.
        </p>
        {rows(
          state,
          origins,
          state.activities.filter((item) => !item.id.includes("-reading-")),
          true,
        )}
      </>,
    );
  if (path === "/announcements") {
    const hasPartnerBoard = state.activities.some(
      (item) => item.id === "partners",
    );
    return render(
      "Announcements and notices",
      <>
        <ul className="list">
          {state.activities
            .filter((item) => item.announcement)
            .map((item) => (
              <li key={item.id}>
                <h2>
                  <a href={activityUrl(item, origins)}>{item.title}</a>
                </h2>
                <p>{item.announcement}</p>
              </li>
            ))}
        </ul>
        {hasPartnerBoard && (
          <>
            <h2>Project partner board</h2>
            <p>
              Students are looking for project partners. Maximum group size is
              three. This notice does not assign discussion replies or
              establish whether solo work is permitted.
            </p>
            <a href="/assignments/partners">Open the partner board</a>
          </>
        )}
      </>,
    );
  }
  if (path === "/grades")
    return render(
      "Gradebook",
      <>
        <p>
          A blank or hidden grade is different from a score of zero. Submission
          status is recorded separately.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Activity</th>
                <th>Submission status</th>
                <th>Grade</th>
              </tr>
            </thead>
            <tbody>
              {state.activities
                .filter(
                  (item) =>
                    ["submitted", "graded"].includes(item.status) &&
                    !item.id.includes("-reading-"),
                )
                .map((item) => (
                  <tr key={item.id}>
                    <td>
                      <a href={activityUrl(item, origins)}>{item.title}</a>
                    </td>
                    <td>{status(state, item)}</td>
                    <td>
                      {!item.gradeVisible
                        ? "Hidden"
                        : item.grade === null
                          ? "— (not graded)"
                          : item.grade}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </>,
    );
  const match = /^\/assignments\/([^/]+)$/.exec(path);
  if (match) {
    const item = activityById(state, decodeURIComponent(match[1]!)),
      draft = state.drafts[item.id],
      reason = unavailableReason(state, item);
    const submissions = state.submissions.filter(
      (receipt) => receipt.activityId === item.id,
    );
    const localTime = (value: string) =>
      new Intl.DateTimeFormat("en-US", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: state.timezone,
      }).format(new Date(value));
    const lateText =
      item.closeAt && state.clock > item.closeAt
        ? "Late submissions are not accepted. This activity is closed."
        : item.dueAt && state.clock > item.dueAt
          ? item.closeAt
            ? `Late submissions are accepted until ${localTime(item.closeAt)} (${state.timezone}).`
            : "Whether late submissions are accepted is unknown."
          : item.closeAt
            ? `Submissions close at ${localTime(item.closeAt)} (${state.timezone}).`
            : "No closing time is published.";
    return render(
      item.title,
      <>
        <p>
          <a href={`${origins.school}/courses/${item.courseId}`}>
            {state.courses.find((course) => course.id === item.courseId)?.title}
          </a>{" "}
          · {item.module}
        </p>
        <p className="notice">
          <strong>Submission status:</strong> {status(state, item)}
        </p>
        <p>
          <strong>Due:</strong>{" "}
          {item.dueAt ? (
            <time dateTime={item.dueAt}>{item.dueText}</time>
          ) : (
            item.dueText
          )}
        </p>
        <p>
          <strong>Late policy:</strong> {lateText}
        </p>
        <p>
          <strong>Submit through:</strong>{" "}
          {
            {
              lms: "this course page",
              vendor: "this homework site",
              repository: "the course repository",
              in_person: "an in-person demonstration",
              none: "no submission required",
            }[item.submissionChannel]
          }
        </p>
        {item.announcement && (
          <p className="notice warning">{item.announcement}</p>
        )}
        <h2>Instructions</h2>
        <p>{item.instructions}</p>
        <h3>Required work</h3>
        {item.requirements.map((requirement, index) => (
          <p key={index}>
            {index + 1}. {requirement}
          </p>
        ))}
        {item.requiredFiles.length > 0 && (
          <p>Required file types: {item.requiredFiles.join(", ")}</p>
        )}
        {item.attachments.length > 0 && (
          <>
            <h3>Course files</h3>
            <ul>
              {item.attachments.map((id) => (
                <li key={id}>
                  <a href={`/files/${id}`}>
                    {state.assets.find((asset) => asset.id === id)?.name ?? id}
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
        {item.prerequisites.length > 0 && (
          <>
            <h3>Prerequisites</h3>
            <ul>
              {item.prerequisites.map((id) => (
                <li key={id}>
                  <a href={activityUrl(activityById(state, id), origins)}>
                    {activityById(state, id).title}
                  </a>{" "}
                  — {state.completed.includes(id) ? "Complete" : "Incomplete"}
                </li>
              ))}
            </ul>
          </>
        )}
        {reason && <p className="notice warning">{reason}</p>}
        {item.kind === "lesson" &&
        !state.completed.includes(item.id) &&
        !item.prerequisites.some((id) => !state.completed.includes(id)) ? (
          <form method="post" action={`/assignments/${item.id}/complete`}>
            <input type="hidden" name="csrf" value={csrf} />
            <button>Mark lesson complete</button>
          </form>
        ) : (
          !reason && (
            <form
              method="post"
              action={`/assignments/${item.id}`}
              encType="multipart/form-data"
            >
              <input type="hidden" name="csrf" value={csrf} />
              <input
                type="hidden"
                name="revision"
                value={draft?.revision ?? 0}
              />
              <input
                type="hidden"
                name="key"
                value={`${item.id}:${draft?.revision ?? 0}:${submissions.length}`}
              />
              <label htmlFor="answer">Your response</label>
              <textarea
                id="answer"
                name="answer"
                defaultValue={draft?.answer ?? ""}
              />
              <label htmlFor="files">Attach files</label>
              <input id="files" type="file" name="files" multiple />
              <p className="muted">
                Maximum 10 MB per file. Saving a draft does not submit your
                work.
              </p>
              <div className="actions">
                <button className="secondary" name="action" value="save">
                  Save draft
                </button>
                <button name="action" value="submit">
                  Submit assignment
                </button>
              </div>
            </form>
          )
        )}
        {draft?.files.length ? (
          <>
            <h3>Saved files</h3>
            <ul>
              {draft.files.map((file, index) => (
                <li key={`${file.hash}-${index}`}>
                  <a href={`/uploads/${item.id}/${file.hash}`}>{file.name}</a> ·{" "}
                  {file.bytes} bytes
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {submissions.length > 0 && (
          <>
            <h2>Submission history</h2>
            {submissions.map((receipt) => (
              <article className="notice success" key={receipt.id}>
                <strong>Submission received</strong>
                <p>
                  Receipt: <code>{receipt.id}</code>
                </p>
                <p>
                  Submitted at{" "}
                  <time dateTime={receipt.submittedAt}>
                    {localTime(receipt.submittedAt)}
                  </time>
                </p>
                <p>{receipt.files.length} files attached</p>
              </article>
            ))}
          </>
        )}
      </>,
    );
  }
  return render(
    "Page not found",
    <p>
      <a href={origins.school}>Return to the dashboard</a>
    </p>,
  );
}
