export function PreviewSchoolPage({ mode }: { mode: "classes" | "assignment" }) {
  return (
    <div className="preview-school-page" aria-label="Mock school page for browser preview">
      <header><strong>Northstar University</strong><span>Student dashboard</span><i aria-hidden="true">K</i></header>
      <nav><b>Home</b><span>Courses</span><span>Calendar</span><span>Grades</span></nav>
      {mode === "classes" ? (
        <main>
          <p>Fall 2026</p><h2>Your courses</h2>
          <div className="preview-course-list"><article><small>CSC 316</small><strong>Data Structures</strong><span>3 assignments due</span></article><article><small>ST 370</small><strong>Probability & Statistics</strong><span>1 assignment due</span></article></div>
        </main>
      ) : (
        <main>
          <p>CSC 316 · Homework</p><h2>IBM Sorting Machine</h2><small>Due today at 7:59 PM</small>
          <div className="preview-question"><strong>Question 4</strong><p>Explain the running time and support your answer.</p><textarea aria-label="Mock answer" value="The algorithm performs one comparison per pass…" readOnly /></div>
        </main>
      )}
    </div>
  );
}
