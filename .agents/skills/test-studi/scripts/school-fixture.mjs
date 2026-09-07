import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const escape = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
export function schoolFixture() {
  let answer = "";
  let submitted = false;
  const due = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const page = body => `<!doctype html><html lang="en"><meta charset="utf-8"><title>Studi QA School</title><style>body{max-width:760px;margin:48px auto;padding:24px;font:18px/1.6 system-ui}nav{display:flex;gap:24px}textarea{display:block;width:100%;height:160px}button{padding:12px;margin-top:12px}</style><header><p>Simulated school · local QA fixture · no real student data</p><nav><a href="/">Dashboard</a><a href="/courses/writing">Writing 101</a></nav></header>${body}</html>`;
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.url === "/health") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ fixture: "studi-qa-school", answerSaved: Boolean(answer), submitted })); return; }
    if (req.method === "POST" && req.url === "/assignments/observation") {
      let body = "";
      for await (const chunk of req) { body += chunk; if (body.length > 16384) { res.writeHead(413).end(); return; } }
      const form = new URLSearchParams(body);
      answer = form.get("answer") ?? "";
      submitted = form.get("action") === "submit";
      res.writeHead(303, { Location: "/assignments/observation" }).end(); return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (req.method !== "GET") { res.writeHead(405).end(); return; }
    if (req.url === "/") res.end(page(`<h1>Welcome, QA Student</h1><h2>Your courses</h2><a href="/courses/writing">Writing 101</a><h2>Upcoming assignments</h2><a href="/assignments/observation">Observation paragraph</a><p>Due ${due} at 11:59 PM. Not started.</p><p>All courses and assignments are listed here. No additional pages.</p>`));
    else if (req.url === "/courses/writing") res.end(page(`<h1>Writing 101</h1><p>Instructor: QA Teacher</p><h2>Assignments</h2><a href="/assignments/observation">Observation paragraph</a><p>Due ${due} at 11:59 PM · 10 points · Not started</p><p>1 of 1 assignments. No additional pages.</p>`));
    else if (req.url === "/assignments/observation") res.end(page(`<h1>Observation paragraph</h1><p>Course: Writing 101 · Due ${due} at 11:59 PM · 10 points</p><p>Write three original sentences describing a rainy afternoon. Include one sound and one color. No outside research or attachments are needed.</p><p role="status">${submitted ? "Submitted (local simulation)" : answer ? "Draft saved" : "Not started"}</p><form method="post"><label for="answer">Your response</label><textarea id="answer" name="answer">${escape(answer)}</textarea><button name="action" value="save">Save draft</button> <button name="action" value="submit">Submit assignment (local simulation)</button></form>`));
    else res.writeHead(404).end(page("<h1>Page not found</h1>"));
  });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { port: { type: "string", default: "0" } } });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid port");
  const server = schoolFixture();
  server.listen(port, "127.0.0.1", () => console.log(JSON.stringify({ schoolUrl: `http://127.0.0.1:${server.address().port}`, processId: process.pid, simulated: true })));
}
