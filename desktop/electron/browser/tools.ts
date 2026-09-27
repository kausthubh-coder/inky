import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { BROWSER_KEYS, formatSnapshot, type BrowserController } from "./controller.js";
import { createReadDocumentTool } from "./read-document.js";

export function createBrowserTools(
  controller: BrowserController,
  options: { readonly includeSubmit?: boolean; readonly readOnly?: boolean } = {},
): ToolDefinition[] {
  const snapshot = defineTool({
    name: "browser_snapshot",
    label: "Read visible school page",
    description: "Read the school page. Refs survive snapshots and ordinary DOM changes; a main-frame navigation resets them. Use ref or selector to narrow, and mode=diff for changes.",
    parameters: Type.Object({
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      search: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
      ref: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
      selector: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      depth: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
      mode: Type.Optional(Type.Union([Type.Literal("full"), Type.Literal("diff")])),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, input) => result(await controller.snapshot({ ...input, mode: input.mode ?? "auto" })),
  });
  const navigate = defineTool({
    name: "browser_navigate",
    label: "Open school page",
    description: "Navigate Studi's visible school browser to an HTTP or HTTPS URL. During a school check, use only a destination observed in a page or saved as the current page; do not guess routes.",
    parameters: Type.Object(
      { url: Type.String({ minLength: 1, maxLength: 2_048 }) },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId, input) => {
      if (options.readOnly && !controller.canNavigateObserved(input.url)) {
        throw new Error("This destination was not observed in the school browser. Use a visible link or inspect the current page.");
      }
      return action(controller, () => controller.navigate(input.url));
    },
  });
  const click = defineTool({
    name: "browser_click",
    label: "Click visible element",
    description: "Click an observed ref. Navigation labels such as 'Submit Lab 3' are allowed when they only open a page; final submission controls require browser_submit.",
    parameters: Type.Object({ ref: Type.String({ minLength: 1, maxLength: 64 }) }, { additionalProperties: false }),
    execute: async (_toolCallId, input) => action(controller, () => controller.click(input.ref, false, options.readOnly)),
  });
  const type = defineTool({
    name: "browser_type",
    label: "Type in visible field",
    description: "Replace the value of an editable element from the current snapshot.",
    parameters: Type.Object(
      {
        ref: Type.String({ minLength: 1, maxLength: 64 }),
        text: Type.String({ maxLength: 20_000 }),
      },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId, input) => action(controller, () => controller.type(input.ref, input.text, options.readOnly)),
  });
  const select = defineTool({
    name: "browser_select",
    label: "Choose visible option",
    description: "Choose a value in a select element from the current snapshot.",
    parameters: Type.Object(
      { ref: Type.String({ minLength: 1, maxLength: 64 }), value: Type.String({ maxLength: 2_000 }) },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId, input) => action(controller, () => controller.select(input.ref, input.value, options.readOnly)),
  });
  const press = defineTool({
    name: "browser_press",
    label: "Press browser key",
    description: "Press one safe navigation or editing key in the visible school browser.",
    parameters: Type.Object(
      { key: Type.Union(BROWSER_KEYS.map((key) => Type.Literal(key))) },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId, input) => action(controller, () => controller.press(input.key, options.readOnly)),
  });
  const wait = defineTool({
    name: "browser_wait",
    label: "Wait for school page",
    description: "Wait up to ten seconds for optional text to appear, then return a fresh snapshot.",
    parameters: Type.Object(
      {
        text: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
        timeoutMs: Type.Integer({ minimum: 0, maximum: 10_000 }),
      },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId, input) => action(controller, () => controller.waitFor(input.text, input.timeoutMs)),
  });
  const submit = defineTool({
    name: "browser_submit",
    label: "Submit school work",
    description: "Activate a known submission control only when the student explicitly asked to submit in the current conversation. The confirmation must be exactly SUBMIT.",
    parameters: Type.Object(
      { ref: Type.String({ minLength: 1, maxLength: 64 }), confirmation: Type.Literal("SUBMIT") },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId, input) => action(controller, () => controller.click(input.ref, true)),
  });

  const scroll = defineTool({
    name: "browser_scroll",
    label: "Scroll the school page",
    description: "Scroll the page or a referenced scrollable element to reveal more content, then return a fresh snapshot. Use snapshot offsets for content already loaded in the accessibility tree.",
    parameters: Type.Object({
      direction: Type.Union([Type.Literal("up"), Type.Literal("down")]),
      ref: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    }, { additionalProperties: false }),
    execute: async (_id, input) => action(controller, () => controller.scroll(input.direction, input.ref)),
  });
  const rows = defineTool({
    name: "browser_rows",
    label: "Read a school list",
    description: "Read a repeating school table as compact rows with stable evidence refs, including collapsed course sections. Continue at nextOffset; 130 rows take three calls at the default 50 rows per call.",
    parameters: Type.Object({
      selector: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 80 })),
    }, { additionalProperties: false }),
    execute: async (_id, input) => {
      const data = await controller.rows(input.selector, input.offset, input.limit);
      return { content: [{ type: "text" as const, text: data.rows.map((row, index) => `${(input.offset ?? 0) + index + 1}. ${row.ref} ${row.cells.join(" | ")}${row.href ? ` | ${row.href}` : ""}`).join("\n") + (data.nextOffset === null ? "" : `\nNext offset: ${data.nextOffset}`) }],
        details: { rows: data.rows, count: data.rows.length, nextOffset: data.nextOffset, url: controller.state.url } };
    },
  });
  const link = defineTool({
    name: "browser_link",
    label: "Read a link destination",
    description: "Read the actual HTTP(S) destination of a current link ref without navigating. Use stable source URLs for course and assignment keys; never invent URLs.",
    parameters: Type.Object({ ref: Type.String({ minLength: 1, maxLength: 64 }) }, { additionalProperties: false }),
    execute: async (_id, input) => {
      const url = await controller.link(input.ref);
      return { content: [{ type: "text" as const, text: url }], details: { url } };
    },
  });
  const screenshot = defineTool({
    name: "browser_screenshot",
    label: "See the school page",
    description: "View a screenshot when layout, an embedded document, or an unlabeled control is unclear. Read PDF pages and diagrams visually when accessible text is missing. Use snapshot refs for actions and distinguish visually read evidence from extracted text. Never capture credentials during a student handoff.",
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async () => ({
      content: [{ type: "image" as const, mimeType: "image/jpeg", data: await controller.screenshot() }],
      details: { kind: "viewport" },
    }),
  });
  const document = createReadDocumentTool(controller);

  return options.includeSubmit === false || options.readOnly
    ? [snapshot, navigate, click, type, select, press, wait, scroll, rows, link, document, screenshot]
    : [snapshot, navigate, click, type, select, press, wait, scroll, rows, link, document, screenshot, submit];
}

export function createBrowserUploadTool(
  controller: BrowserController,
  resolveWorkspaceFiles: (paths: readonly string[]) => Promise<readonly string[]>,
): ToolDefinition {
  return defineTool({
    name: "browser_upload",
    label: "Upload workspace files",
    description: "Attach files from this assignment's private workspace to a visible school-page file input. Paths must be relative to the active assignment folder. This never submits the assignment.",
    parameters: Type.Object(
      {
        ref: Type.String({ minLength: 1, maxLength: 64 }),
        paths: Type.Array(Type.String({ minLength: 1, maxLength: 1_024 }), { minItems: 1, maxItems: 12 }),
      },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId, input) => {
      const files = await resolveWorkspaceFiles(input.paths);
      return result(await controller.upload(input.ref, files));
    },
  });
}

function result(snapshot: Awaited<ReturnType<BrowserController["snapshot"]>>) {
  return {
    content: [{ type: "text" as const, text: formatSnapshot(snapshot) }],
    details: snapshot,
  };
}

async function action(controller: BrowserController, execute: () => Promise<Awaited<ReturnType<BrowserController["snapshot"]>>>) {
  const before = controller.lastSnapshot;
  try {
    const snapshot = await execute();
    const summary = { status: "completed", url: snapshot.url, title: snapshot.title,
      changed: !before || before.url !== snapshot.url || before.text !== snapshot.text };
    return { content: [{ type: "text" as const, text: JSON.stringify(summary) }], details: summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const state = controller.state;
    const status = /timed out|did not finish/i.test(message) ? "unknown" : "failed";
    throw new Error(JSON.stringify({ status, url: state.url, title: state.title, changed: false, error: message }), { cause: error });
  }
}
