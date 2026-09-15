import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

// Subprocess entry point: the same observations invoke each build's real recording
// tools, storage and manager. No rewritten "old scanner" or fake eligibility code.
const config = JSON.parse(await readFile(process.argv[2], "utf8"));
const moduleAt = (path) => import(pathToFileURL(join(config.buildRoot, path)).href);
const { SchoolScanCoordinator } = await moduleAt("electron/scan/coordinator.js");
const { ManagerCoordinator } = await moduleAt("electron/manager/coordinator.js");
const { openLocalStore } = await moduleAt("electron/storage/index.js");
const { ProductPreferencesSchema } = await moduleAt("shared/index.js");
const fixture = config.fixture;
const origin = "http://127.0.0.1:43119/";
let calls = 0;
const errors = [],
  trace = [];
class ObservedBrowser {
  url = origin;
  text = "";
  elements = [];
  revision = 0;
  async navigate(url) {
    this.url = url;
    return this.snapshot();
  }
  async snapshot() {
    return {
      url: this.url,
      title: "Synthetic school observations",
      revision: ++this.revision,
      text: this.text,
      elements: this.elements,
      truncated: false,
    };
  }
  async link(ref) {
    const link = this.elements.find((item) => item.ref === ref);
    if (!link?.href) throw new Error("Missing observed link");
    return link.href;
  }
}
const browser = new ObservedBrowser();
const store = await openLocalStore(config.storeRoot);
if ("workStartMode" in ProductPreferencesSchema.shape) {
  await store.productPreferences.put({
    ...(await store.productPreferences.get()),
    workStartMode: "automatic",
  });
}
const runtime = {
  async createScanSession(tools) {
    const invoke = async (name, input) => {
      calls++;
      if (calls > config.maxToolCalls) throw new Error("Tool-call budget exceeded");
      const tool = tools.find((tool) => tool.name === name);
      // Record only fields the selected production build exposes. The page facts
      // remain identical; unsupported facts cannot magically appear in old storage.
      const properties = tool.parameters.properties ?? {};
      const args = Object.fromEntries(Object.entries(input).filter(([key]) => key in properties));
      try {
        const value = await tool.execute(`replay-${calls}`, args);
        trace.push({ name, args, outcome: "ok" });
        return value.details;
      } catch (error) {
        trace.push({ name, args, outcome: "error", error: error.message });
        throw error;
      }
    };
    return {
      sessionId: "observation-replay",
      sessionPath: null,
      toolNames: tools.map((tool) => tool.name),
      subscribe: () => () => {},
      abort: async () => {},
      dispose() {},
      prompt: async () => {
        const courses = [];
        for (const course of fixture.courses) {
          browser.url = origin;
          browser.text = `All courses: ${fixture.courses.map((item) => item.title).join(", ")}`;
          browser.elements = fixture.courses.map((item) => ({
            ref: item.id,
            role: "link",
            name: item.title,
            href: `${origin}course/view.php?id=${item.id}`,
          }));
          const recorded = await invoke("scan_record_course", {
            label: course.title,
            courseKey: course.id,
            observationRef: course.id,
          });
          courses.push(recorded);
          const ids = [];
          for (const assignment of fixture.assignments.filter((item) => item.course === course.id)) {
            browser.url = `${origin}mod/assign/view.php?id=${assignment.id}`;
            browser.elements = [];
            browser.text = `${assignment.title}\n${assignment.statusText}\nDue: ${assignment.due}\n${assignment.lateText ?? ""}\n${assignment.requirements.join("\nRubric section\n")}\n${(assignment.missing ?? []).join("\n")}`;
            const input = {
              courseId: recorded.courseId,
              title: assignment.title,
              assignmentKey: assignment.id,
              dueText: assignment.due,
              ...(!assignment.dateOnly ? { dueAt: assignment.due } : {}),
              schoolStatus: { state: assignment.status, text: assignment.statusText },
              ...(assignment.late
                ? {
                    latePolicy: {
                      state: assignment.late,
                      text: assignment.lateText,
                      ...(assignment.until ? { until: assignment.until, untilText: assignment.until } : {}),
                    },
                  }
                : {}),
              requirementExcerpts: assignment.requirements.map((text) => ({ text })),
              requirementsComplete: !assignment.missing,
              missingRequirements: assignment.missing ?? [],
            };
            // Give the old contract the full continuous observed passage; do not
            // handicap it by deliberately dropping supported requirement text.
            const recordTool = tools.find((tool) => tool.name === "scan_record_assignment");
            if (!("requirementExcerpts" in recordTool.parameters.properties))
              input.instructions = assignment.requirements.join("\nRubric section\n");
            try {
              const result = await invoke("scan_record_assignment", input);
              ids.push(result.assignmentId);
            } catch (error) {
              errors.push({ assignment: assignment.id, error: error.message });
            }
          }
          browser.url = recorded.sourceTarget;
          browser.text = `${course.title}\nAll assignments: ${fixture.assignments
            .filter((item) => item.course === course.id)
            .map((item) => item.title)
            .join(", ")}`;
          await invoke("scan_record_inventory", {
            kind: "assignments",
            courseId: recorded.courseId,
            state: "complete",
            itemIds: ids,
            evidenceText: "All assignments",
          });
        }
        browser.url = origin;
        browser.text = `All courses: ${fixture.courses.map((item) => item.title).join(", ")}`;
        await invoke("scan_record_inventory", {
          kind: "courses",
          state: "complete",
          itemIds: courses.map((item) => item.courseId),
          evidenceText: "All courses",
        });
        await invoke("scan_finish", {
          coverage: courses.map((course) => ({ target: `Course: ${course.label}`, status: "verified" })),
          navigationHints: [],
        });
      },
    };
  },
};
const manager = await ManagerCoordinator.create(store, runtime, { now: () => fixture.clock });
const coordinator = new SchoolScanCoordinator(store, runtime, browser, { manager, now: () => fixture.clock });
const started = performance.now();
try {
  await coordinator.saveProfile({
    studentName: "Synthetic student",
    schoolRoot: origin,
    defaultPermission: "attempt",
    scanCadence: "manual",
  });
  const state = await coordinator.startScan();
  const result = {
    status: "completed",
    scanState: state.scan.state,
    assignments: state.assignments,
    courses: state.courses,
    queue: manager
      .state()
      .entries.map((entry) => ({
        ...entry,
        assignmentId: store.tasks.get(entry.taskId)?.assignmentId,
        state: store.tasks.get(entry.taskId)?.state,
      })),
    errors,
    metrics: { durationMs: performance.now() - started, toolCalls: calls, modelCalls: null, usage: null },
    trace,
  };
  await mkdir(config.runRoot, { recursive: true });
  await writeFile(join(config.runRoot, "replay-result.json"), JSON.stringify(result, null, 2));
} finally {
  coordinator.dispose();
  manager.dispose();
  store.close();
}
