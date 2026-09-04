import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { BROWSER_KEYS, formatSnapshot, type BrowserController } from "./controller.js";

export function createBrowserTools(
  controller: BrowserController,
  options: { readonly includeSubmit?: boolean } = {},
): ToolDefinition[] {
  const snapshot = defineTool({
    name: "browser_snapshot",
    label: "Read visible school page",
    description: "Read a bounded accessibility snapshot of Studi's visible school browser. Take a new snapshot after every action because refs expire when the page changes.",
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async () => result(await controller.snapshot()),
  });
  const navigate = defineTool({
    name: "browser_navigate",
    label: "Open school page",
    description: "Navigate Studi's visible school browser to an HTTP or HTTPS URL.",
    parameters: Type.Object(
      { url: Type.String({ minLength: 1, maxLength: 2_048 }) },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId, input) => result(await controller.navigate(input.url)),
  });
  const click = defineTool({
    name: "browser_click",
    label: "Click visible element",
    description: "Click a current snapshot ref. This tool refuses known submission controls.",
    parameters: Type.Object({ ref: Type.String({ minLength: 1, maxLength: 64 }) }, { additionalProperties: false }),
    execute: async (_toolCallId, input) => result(await controller.click(input.ref)),
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
    execute: async (_toolCallId, input) => result(await controller.type(input.ref, input.text)),
  });
  const select = defineTool({
    name: "browser_select",
    label: "Choose visible option",
    description: "Choose a value in a select element from the current snapshot.",
    parameters: Type.Object(
      { ref: Type.String({ minLength: 1, maxLength: 64 }), value: Type.String({ maxLength: 2_000 }) },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId, input) => result(await controller.select(input.ref, input.value)),
  });
  const press = defineTool({
    name: "browser_press",
    label: "Press browser key",
    description: "Press one safe navigation or editing key in the visible school browser.",
    parameters: Type.Object(
      { key: Type.Union(BROWSER_KEYS.map((key) => Type.Literal(key))) },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId, input) => result(await controller.press(input.key)),
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
    execute: async (_toolCallId, input) =>
      result(await controller.waitFor(input.text, input.timeoutMs)),
  });
  const submit = defineTool({
    name: "browser_submit",
    label: "Submit school work",
    description: "Activate a known submission control only when the student explicitly asked to submit in the current conversation. The confirmation must be exactly SUBMIT.",
    parameters: Type.Object(
      { ref: Type.String({ minLength: 1, maxLength: 64 }), confirmation: Type.Literal("SUBMIT") },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId, input) => result(await controller.click(input.ref, true)),
  });

  return options.includeSubmit === false
    ? [snapshot, navigate, click, type, select, press, wait]
    : [snapshot, navigate, click, type, select, press, wait, submit];
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
