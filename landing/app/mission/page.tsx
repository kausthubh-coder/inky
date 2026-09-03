import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mission · Studi",
  description: "Homework help you can see. A last click that stays yours.",
};

export default function MissionPage() {
  return (
    <>
      <header className="site-nav">
        <a className="wordmark" href="/">
          studi <span className="pencil">✎</span>
        </a>
        <nav className="links" aria-label="Page">
          <a href="/#what">Inky</a>
          <a href="/#trust">Trust</a>
          <a href="/mission">Mission</a>
          <a href="/#faq">FAQ</a>
        </nav>
        <a className="cta" href="/#wait">
          Get a seat
        </a>
      </header>

      <main className="inner">
        <p className="kicker">Mission</p>
        <h1>Homework help you can see. A last click that stays yours.</h1>
        <p className="lead">
          Studi exists so a student can finish the work on the school page,
          watch every step, and still be the one who submits.
        </p>

        <h2>Less hiding. More agency.</h2>
        <p>
          AI homework tools usually ask you to paste schoolwork into a mystery
          box. Studi keeps the page in front of you. You see what Inky sees,
          watch what Inky writes, and can take the page back whenever you want.
        </p>

        <h2>The student stays responsible.</h2>
        <p>
          Inky does not take quizzes, tests, or exams. Inky does not know your
          school password. Inky writes and stops before Submit, so you can read
          the work and decide what carries your name.
        </p>

        <h2>Your schoolwork stays with you.</h2>
        <p>
          Classes, drafts, and school pages live on your computer. The cloud
          holds the account, beta access, and the email you use to join the
          waitlist—not your essay or school session.
        </p>

        <h2>Your syllabus still wins.</h2>
        <p>
          If a class bans this kind of help, don’t run Inky there. Studi should
          make the work visible and controllable, not give anyone a reason to
          pretend the rules disappeared.
        </p>

        <a className="btn primary" href="/#wait">
          Get a seat
        </a>
      </main>
    </>
  );
}
