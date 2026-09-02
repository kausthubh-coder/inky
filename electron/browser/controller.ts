import type { BrowserSnapshot, BrowserState } from "../../shared/index.js";

const MAX_ELEMENTS = 80;
const MAX_TEXT_LENGTH = 8_000;
const ACTION_SETTLE_MS = 180;
const SUBMISSION_PATTERN = /\b(submit|turn in|hand in|finish attempt|send answers?|complete attempt)\b/i;
const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "menuitem",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
]);

export interface CdpDebugger {
  isAttached(): boolean;
  attach(protocolVersion?: string): void;
  sendCommand(method: string, commandParams?: Record<string, unknown>): Promise<unknown>;
  on?(event: "detach", listener: () => void): void;
}

export interface BrowserTarget {
  readonly debugger: CdpDebugger;
  getURL(): string;
  getTitle(): string;
  loadURL(url: string): Promise<void>;
}

interface ElementTarget {
  readonly backendNodeId: number;
  readonly revision: number;
  readonly role: string;
  readonly name: string;
}

interface AxValue {
  readonly value?: unknown;
}

interface AxNode {
  readonly ignored?: boolean;
  readonly backendDOMNodeId?: number;
  readonly role?: AxValue;
  readonly name?: AxValue;
  readonly value?: AxValue;
}

export class BrowserController {
  readonly #target: BrowserTarget;
  readonly #refs = new Map<string, ElementTarget>();
  #revision = 1;

  constructor(target: BrowserTarget) {
    this.#target = target;
    target.debugger.on?.("detach", () => {
      this.pageChanged();
    });
  }

  get state(): Omit<BrowserState, "driver"> {
    return {
      url: this.#target.getURL(),
      title: this.#target.getTitle(),
      revision: this.#revision,
    };
  }

  pageChanged(): void {
    this.#revision += 1;
    this.#refs.clear();
  }

  async navigate(rawUrl: string): Promise<BrowserSnapshot> {
    const url = parseSchoolUrl(rawUrl);
    await this.#target.loadURL(url);
    this.pageChanged();
    return this.snapshot();
  }

  async snapshot(): Promise<BrowserSnapshot> {
    this.pageChanged();
    const response = asRecord(
      await this.#send("Accessibility.getFullAXTree", { depth: 12 }, true),
    );
    const rawNodes = Array.isArray(response.nodes) ? response.nodes : [];
    const elements: BrowserSnapshot["elements"] = [];
    const textParts: string[] = [];
    const seenText = new Set<string>();
    let truncated = false;
    this.#refs.clear();

    for (const rawNode of rawNodes) {
      const node = rawNode as AxNode;
      if (node.ignored) {
        continue;
      }
      const role = readAxString(node.role).toLowerCase();
      const name = readAxString(node.name).trim();
      const value = readAxString(node.value).trim();
      if (name && !seenText.has(name)) {
        seenText.add(name);
        textParts.push(name);
      }
      if (value && value !== name && !seenText.has(value)) {
        seenText.add(value);
        textParts.push(value);
      }

      if (!INTERACTIVE_ROLES.has(role) || typeof node.backendDOMNodeId !== "number") {
        continue;
      }
      if (elements.length >= MAX_ELEMENTS) {
        truncated = true;
        continue;
      }
      const ref = `r${this.#revision}:${elements.length + 1}`;
      this.#refs.set(ref, {
        backendNodeId: node.backendDOMNodeId,
        revision: this.#revision,
        role,
        name,
      });
      elements.push({ ref, role, name, ...(value ? { value } : {}) });
    }

    let text = textParts.join("\n");
    if (text.length > MAX_TEXT_LENGTH) {
      text = text.slice(0, MAX_TEXT_LENGTH);
      truncated = true;
    }
    if (rawNodes.length > MAX_ELEMENTS * 10) {
      truncated = true;
    }

    return {
      revision: this.#revision,
      url: this.#target.getURL(),
      title: this.#target.getTitle(),
      text,
      elements,
      truncated,
    };
  }

  async click(ref: string, allowSubmission = false): Promise<BrowserSnapshot> {
    const { objectId, target } = await this.#resolve(ref);
    const inspection = asRecord(
      await this.#callOn(objectId, `function () {
        const element = this;
        const tag = String(element.tagName || "").toLowerCase();
        const type = String(element.type || "").toLowerCase();
        const label = String(element.innerText || element.value || element.getAttribute?.("aria-label") || "").trim();
        return {
          connected: Boolean(element.isConnected),
          disabled: Boolean(element.disabled || element.getAttribute?.("aria-disabled") === "true"),
          submission: (tag === "button" && (!type || type === "submit")) || type === "submit",
          label
        };
      }`),
    );
    const value = asRecord(inspection.value);
    const label = typeof value.label === "string" ? value.label : target.name;
    const knownSubmission = value.submission === true || SUBMISSION_PATTERN.test(label);
    if (knownSubmission && !allowSubmission) {
      throw new Error("Ordinary click cannot activate a submission control. Use browser_submit only after the student explicitly asks to submit.");
    }
    if (value.connected !== true || value.disabled === true) {
      throw new Error("The referenced element is no longer available or is disabled");
    }
    await this.#callOn(objectId, "function () { this.scrollIntoView({ block: 'center' }); this.click(); return true; }");
    return this.#afterAction();
  }

  async refreshRef(ref: string): Promise<{ readonly snapshot: BrowserSnapshot; readonly ref: string }> {
    const target = this.#targetForRef(ref);
    const url = this.#target.getURL();
    const snapshot = await this.snapshot();
    if (snapshot.revision !== target.revision + 1 || snapshot.url !== url) {
      throw new Error("The page changed while refreshing the submission control");
    }
    const matches = snapshot.elements.filter((element) => element.role === target.role && element.name === target.name);
    if (matches.length !== 1) {
      throw new Error("The submission control could not be uniquely re-identified in a fresh browser snapshot");
    }
    return { snapshot, ref: matches[0]!.ref };
  }

  async type(ref: string, text: string): Promise<BrowserSnapshot> {
    const { objectId } = await this.#resolve(ref);
    await this.#callOn(
      objectId,
      `function (nextValue) {
        if (!this.isConnected || this.disabled || this.readOnly) throw new Error("Element is not editable");
        this.scrollIntoView({ block: "center" });
        this.focus();
        const prototype = Object.getPrototypeOf(this);
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
        if (descriptor?.set) descriptor.set.call(this, nextValue); else this.value = nextValue;
        this.dispatchEvent(new Event("input", { bubbles: true }));
        this.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }`,
      [{ value: text }],
    );
    return this.#afterAction();
  }

  async select(ref: string, value: string): Promise<BrowserSnapshot> {
    const { objectId } = await this.#resolve(ref);
    await this.#callOn(
      objectId,
      `function (nextValue) {
        if (!this.isConnected || this.disabled || String(this.tagName).toLowerCase() !== "select") {
          throw new Error("Element is not an enabled select");
        }
        this.value = nextValue;
        this.dispatchEvent(new Event("input", { bubbles: true }));
        this.dispatchEvent(new Event("change", { bubbles: true }));
        return this.value;
      }`,
      [{ value }],
    );
    return this.#afterAction();
  }

  async press(key: BrowserKey): Promise<BrowserSnapshot> {
    if (key === "Enter" && (await this.#enterWouldSubmit())) {
      throw new Error("Enter could submit the current form. Use browser_submit only after the student explicitly asks to submit.");
    }
    const keyCode = KEY_CODES[key];
    await this.#send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code: key,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    });
    await this.#send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code: key,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    });
    return this.#afterAction();
  }

  async waitFor(text: string | undefined, timeoutMs: number): Promise<BrowserSnapshot> {
    const deadline = Date.now() + timeoutMs;
    let latest = await this.snapshot();
    while (text && !latest.text.toLowerCase().includes(text.toLowerCase()) && Date.now() < deadline) {
      await delay(Math.min(250, Math.max(0, deadline - Date.now())));
      latest = await this.snapshot();
    }
    if (text && !latest.text.toLowerCase().includes(text.toLowerCase())) {
      throw new Error(`Timed out waiting for page text: ${text}`);
    }
    if (!text && timeoutMs > 0) {
      await delay(timeoutMs);
      latest = await this.snapshot();
    }
    return latest;
  }

  async #resolve(ref: string): Promise<{ objectId: string; target: ElementTarget }> {
    const target = this.#targetForRef(ref);
    const resolved = asRecord(
      await this.#send("DOM.resolveNode", { backendNodeId: target.backendNodeId }),
    );
    const object = asRecord(resolved.object);
    if (typeof object.objectId !== "string") {
      throw new Error("The referenced element is no longer available");
    }
    return { objectId: object.objectId, target };
  }

  #targetForRef(ref: string): ElementTarget {
    const target = this.#refs.get(ref);
    if (!target || target.revision !== this.#revision || !ref.startsWith(`r${this.#revision}:`)) {
      throw new Error("Stale or unknown browser ref. Take a new snapshot before acting.");
    }
    return target;
  }

  async #enterWouldSubmit(): Promise<boolean> {
    const response = asRecord(
      await this.#send("Runtime.evaluate", {
        expression: `(() => {
          const active = document.activeElement;
          if (!active) return false;
          const tag = String(active.tagName || "").toLowerCase();
          const type = String(active.type || "").toLowerCase();
          if (type === "submit" || (tag === "button" && (!type || type === "submit"))) return true;
          return tag !== "textarea" && Boolean(active.form);
        })()`,
        returnByValue: true,
      }),
    );
    return asRecord(response.result).value === true;
  }

  async #callOn(
    objectId: string,
    functionDeclaration: string,
    argumentsList: readonly Record<string, unknown>[] = [],
  ): Promise<Record<string, unknown>> {
    const response = asRecord(
      await this.#send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration,
        arguments: argumentsList,
        returnByValue: true,
        awaitPromise: true,
      }),
    );
    if (response.exceptionDetails) {
      throw new Error("The page rejected the browser action");
    }
    return asRecord(response.result);
  }

  async #afterAction(): Promise<BrowserSnapshot> {
    this.pageChanged();
    await delay(ACTION_SETTLE_MS);
    return this.snapshot();
  }

  async #send(
    method: string,
    params: Record<string, unknown> = {},
    retryAfterDetach = false,
  ): Promise<unknown> {
    this.#ensureAttached();
    try {
      return await this.#target.debugger.sendCommand(method, params);
    } catch (error) {
      if (!retryAfterDetach || this.#target.debugger.isAttached()) {
        throw error;
      }
      this.pageChanged();
      this.#ensureAttached();
      return this.#target.debugger.sendCommand(method, params);
    }
  }

  #ensureAttached(): void {
    if (!this.#target.debugger.isAttached()) {
      this.#target.debugger.attach("1.3");
    }
  }
}

export const BROWSER_KEYS = [
  "Enter",
  "Tab",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Backspace",
  "Delete",
] as const;

export type BrowserKey = (typeof BROWSER_KEYS)[number];

const KEY_CODES: Record<BrowserKey, number> = {
  Enter: 13,
  Tab: 9,
  Escape: 27,
  ArrowUp: 38,
  ArrowDown: 40,
  ArrowLeft: 37,
  ArrowRight: 39,
  Backspace: 8,
  Delete: 46,
};

export function formatSnapshot(snapshot: BrowserSnapshot): string {
  const elementLines = snapshot.elements.map((element) => {
    const value = element.value ? ` value=${JSON.stringify(element.value)}` : "";
    return `${element.ref} ${element.role} ${JSON.stringify(element.name)}${value}`;
  });
  return [
    `Page revision ${snapshot.revision}: ${snapshot.title || "Untitled"}`,
    snapshot.url,
    snapshot.text,
    elementLines.length ? `Interactive elements:\n${elementLines.join("\n")}` : "Interactive elements: none",
    snapshot.truncated ? "Observation truncated to Studi's safety bounds." : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function parseSchoolUrl(rawUrl: string): string {
  const withProtocol = /^[a-z][a-z\d+.-]*:/i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const url = new URL(withProtocol);
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    throw new Error("School URLs must use HTTP or HTTPS and cannot contain credentials");
  }
  return url.href;
}

function readAxString(value: AxValue | undefined): string {
  return typeof value?.value === "string" ? value.value : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
