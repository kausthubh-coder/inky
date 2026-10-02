import { useEffect, useState } from "react";

const ANSWER = "1, 2, 5, 7, 9. I used insertion sort: take each number and slide it left until it fits.";

/** The practice homework's school page, drawn where the live page would be. Dot types the answer. */
export function PracticeSchoolPage({ mode }: { mode: "classes" | "assignment" }) {
  const [typed, setTyped] = useState(0);
  useEffect(() => {
    if (mode !== "assignment") return undefined;
    const timer = window.setInterval(() => setTyped(count => Math.min(ANSWER.length, count + 2)), 60);
    return () => window.clearInterval(timer);
  }, [mode]);
  return (
    <div className="practice-page" aria-label="Practice school page">
      <header><strong>Studi 101</strong><span>Practice class</span></header>
      <main>
        <p>Studi 101 · Practice homework</p>
        <h2>Sort five numbers</h2>
        <small>Due tonight</small>
        <div className="practice-question">
          <strong>Question 1</strong>
          <p>Put these in order, smallest first: 5, 2, 9, 1, 7. Then say which way of sorting you used.</p>
          <textarea aria-label="Practice answer" value={ANSWER.slice(0, typed)} readOnly />
        </div>
      </main>
    </div>
  );
}
