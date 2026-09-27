import type { BrowserSnapshot, BrowserState } from "../../shared/index.js";

const MAX_ELEMENTS = 80;
const MAX_TEXT_LENGTH = 8_000;
const ACTION_SETTLE_MS = 180;
const SUBMISSION_PATTERN = /\b(submit|turn in|hand in|finish attempt|send answers?|complete attempt)\b/i;
/** Pages whose text still counts as seen when the agent records what they listed. */
const RECENT_PAGES = 40;
const looseText = (text: string) => text.toLowerCase().replace(/&amp;/g, "&").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
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
  readonly session?: Pick<Electron.Session, "fetch">;
  executeJavaScript?<T = unknown>(code: string, userGesture?: boolean): Promise<T>;
  getURL(): string;
  getTitle(): string;
  loadURL(url: string): Promise<void>;
}

interface ElementTarget {
  readonly backendNodeId: number;
  readonly revision: number;
  readonly frameId: string;
  readonly role: string;
  readonly name: string;
}

interface AxValue {
  readonly value?: unknown;
}

interface AxNode {
  readonly nodeId?: string;
  readonly childIds?: readonly string[];
  readonly frameId?: string;
  readonly properties?: readonly { readonly name: string; readonly value: AxValue }[];
  readonly ignored?: boolean;
  readonly backendDOMNodeId?: number;
  readonly role?: AxValue;
  readonly name?: AxValue;
  readonly value?: AxValue;
}

export interface SnapshotOptions {
  readonly offset?: number;
  readonly search?: string;
  readonly ref?: string;
  readonly selector?: string;
  readonly depth?: number;
  /** "auto" (the model's plain re-read) returns only changes on the same page; internal reads get the whole page. */
  readonly mode?: "full" | "diff" | "auto";
}

export class BrowserController {
  readonly #target: BrowserTarget;
  readonly #refs = new Map<string, ElementTarget>();
  readonly #nodeRefs = new Map<string, string>();
  #revision = 1;
  #nextRef = 1;
  #lastSnapshot: BrowserSnapshot | null = null;
  #observedSnapshot: BrowserSnapshot | null = null;
  #diffBaseline: BrowserSnapshot | null = null;
  readonly #navigationUrls: string[] = [];
  readonly #observedLinks = new Set<string>();
  /** The last few pages read in full, so a row seen a moment ago can still be saved after moving on. */
  #recentTexts: string[] = [];

  /** Told before a plain link on an untouched page is clicked, so a site that posts its page loads can still be read. */
  readonly #onLinkClick: ((pageUrl: string) => void) | undefined;

  constructor(target: BrowserTarget, options: { onLinkClick?: (pageUrl: string) => void } = {}) {
    this.#target = target;
    this.#onLinkClick = options.onLinkClick;
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
    this.#nodeRefs.clear();
    this.#nextRef = 1;
    this.#lastSnapshot = null;
    this.#observedSnapshot = null;
    this.#diffBaseline = null;
  }

  get navigationUrls(): readonly string[] {
    return this.#navigationUrls;
  }

  noteMainFrameNavigation(rawUrl: string): void {
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      // Retain only the route in memory; redirect tickets and query secrets
      // are never needed to learn an exact identity-provider host.
      const route = url.origin + url.pathname;
      if (this.#navigationUrls.at(-1) !== route) this.#navigationUrls.push(route);
      if (this.#navigationUrls.length > 60) this.#navigationUrls.shift();
    } catch { /* Ignore internal browser URLs. */ }
  }

  /** Run a read-only connector from the signed-in school page's own origin. */
  async evaluateInPage<T>(code: string): Promise<T> {
    if (!this.#target.executeJavaScript) throw new Error("Signed-in page evaluation is unavailable");
    return this.#target.executeJavaScript<T>(code);
  }

  get lastSnapshot(): BrowserSnapshot | null { return this.#lastSnapshot; }

  canNavigateObserved(rawUrl: string): boolean {
    const url = parseSchoolUrl(rawUrl);
    return url === this.#target.getURL() || this.#observedLinks.has(url);
  }

  /** Whether a page read during this check showed this text, ignoring case, spacing and punctuation. */
  recentlyShowed(fragment: string): boolean {
    const wanted = looseText(fragment);
    return wanted.length > 0 && this.#recentTexts.some(text => ` ${text} `.includes(` ${wanted} `));
  }

  /**
   * Addresses seen anywhere in this check (written in a page or document, or saved by Studi) may be opened later.
   * Opening what the school showed isn't guessing; an address that never appeared still is.
   */
  rememberUrls(source: string | readonly string[]): void {
    const found = typeof source === "string" ? source.match(/https?:\/\/[^\s"'<>)\]]+/g) ?? [] : source;
    for (const raw of found) {
      try { this.#observedLinks.add(parseSchoolUrl(raw.replace(/[.,;:]+$/, ""))); } catch { /* Not a school web address. */ }
    }
  }

  async downloadSource(ref?: string): Promise<string> {
    return parseSchoolUrl(ref ? await this.link(ref) : this.#target.getURL());
  }

  fetchDownload(url: string, signal: AbortSignal): Promise<Response> {
    if (!this.#target.session) throw new Error("School downloads are unavailable in this browser. Try reading the document with browser_screenshot.");
    return this.#target.session.fetch(parseSchoolUrl(url), {
      method: "GET", credentials: "include", redirect: "follow", signal,
      bypassCustomProtocolHandlers: true,
    });
  }

  async navigate(rawUrl: string): Promise<BrowserSnapshot> {
    const url = parseSchoolUrl(rawUrl);
    const revision = this.#revision;
    await boundedBrowserOperation(this.#target.loadURL(url), "Navigation did not finish. Inspect browser_snapshot or browser_screenshot before retrying; an open PDF can also be read with browser_download.", 15_000);
    if (this.#revision === revision) this.pageChanged();
    return this.snapshot({}, false);
  }

  async snapshot(options: SnapshotOptions = {}, observed = true): Promise<BrowserSnapshot> {
    const offset = options.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0) throw new Error("Snapshot offset must be a nonnegative integer");
    if (options.depth !== undefined && (!Number.isInteger(options.depth) || options.depth < 0 || options.depth > 20)) throw new Error("Snapshot depth must be 0–20");
    if (options.ref && options.selector) throw new Error("Choose either a ref or a selector");
    const response = asRecord(
      await this.#send("Accessibility.getFullAXTree", {}, true),
    );
    const frameNodes: AxNode[] = (Array.isArray(response.nodes) ? response.nodes : []) as AxNode[];
    const frameErrors: string[] = [];
    try {
      const tree = asRecord(await this.#send("Page.getFrameTree"));
      const visit = async (entry: Record<string, unknown>): Promise<void> => {
        const children = Array.isArray(entry.childFrames) ? entry.childFrames : [];
        for (const child of children) {
          const frame = asRecord(child), identity = asRecord(frame.frame);
          const id = identity.id;
          if (typeof id !== "string") continue;
          try {
            const result = asRecord(await this.#send("Accessibility.getFullAXTree", { frameId: id }));
            frameNodes.push(...(Array.isArray(result.nodes) ? result.nodes : []).map(raw => ({ ...(raw as AxNode), frameId: id })));
          } catch { frameErrors.push(`Frame ${String(identity.url ?? id)} could not be read.`); }
          await visit(frame);
        }
      };
      await visit(asRecord(tree.frameTree));
    } catch { /* Older CDP targets may not expose a frame tree. */ }
    let scopeId: number | null = null;
    let scopeFrame = "main";
    if (options.ref) {
      const target = this.#targetForRef(options.ref);
      scopeId = target.backendNodeId;
      scopeFrame = target.frameId;
    } else if (options.selector) {
      const document = asRecord(await this.#send("DOM.getDocument", { depth: 1 }));
      const rootId = asRecord(document.root).nodeId;
      const match = asRecord(await this.#send("DOM.querySelector", { nodeId: rootId, selector: options.selector }));
      if (typeof match.nodeId !== "number" || match.nodeId === 0) throw new Error("Snapshot selector did not match a page element");
      const described = asRecord(await this.#send("DOM.describeNode", { nodeId: match.nodeId }));
      scopeId = asRecord(described.node).backendNodeId as number;
    }
    let scopedNodes = frameNodes;
    if (scopeId !== null) {
      const root = frameNodes.find(node => node.backendDOMNodeId === scopeId && (node.frameId ?? "main") === scopeFrame);
      if (!root) throw new Error("Snapshot target is no longer in the accessibility tree");
      const ids = new Set([root.nodeId]);
      for (let depth = 0, frontier = [root]; frontier.length && depth < (options.depth ?? 20); depth++) {
        const next = frameNodes.filter(node => (node.frameId ?? "main") === scopeFrame && node.nodeId && frontier.some(parent => parent.childIds?.includes(node.nodeId!)));
        next.forEach(node => ids.add(node.nodeId));
        frontier = next;
      }
      scopedNodes = frameNodes.filter(node => ids.has(node.nodeId) && (node.frameId ?? "main") === scopeFrame);
    }
    const search = options.search?.trim().toLocaleLowerCase();
    const rawNodes = scopedNodes.filter((raw) => {
      const node = raw as AxNode;
      return !node.ignored && (!search || `${readAxString(node.name)} ${readAxString(node.value)}`.toLocaleLowerCase().includes(search));
    });
    const elements: BrowserSnapshot["elements"] = [];
    const textParts: string[] = [...frameErrors];
    const seenText = new Set<string>();
    let truncated = false;
    let nextOffset: number | undefined;

    for (let index = offset; index < rawNodes.length; index += 1) {
      const rawNode = rawNodes[index];
      const node = rawNode as AxNode;
      if (node.ignored) {
        continue;
      }
      const role = readAxString(node.role).toLowerCase();
      const name = readAxString(node.name).trim();
      const value = readAxString(node.value).trim();
      const addedLength = [name, value].filter((part) => part && !seenText.has(part)).join("\n").length;
      if (index > offset && (elements.length >= MAX_ELEMENTS || textParts.join("\n").length + addedLength > MAX_TEXT_LENGTH)) {
        nextOffset = index;
        truncated = true;
        break;
      }
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
      const frameId = node.frameId ?? "main";
      const nodeKey = `${frameId}:${node.backendDOMNodeId}`;
      const ref = this.#nodeRefs.get(nodeKey) ?? `${frameId === "main" ? "" : `f${frameId}:`}r${this.#revision}:${this.#nextRef++}`;
      this.#nodeRefs.set(nodeKey, ref);
      this.#refs.set(ref, {
        backendNodeId: node.backendDOMNodeId,
        revision: this.#revision,
        frameId,
        role,
        name,
      });
      const url = readAxString(node.properties?.find(property => property.name === "url")?.value);
      const href = role === "link" && /^https?:\/\//i.test(url) ? url : undefined;
      elements.push({ ref, role, name, ...(value ? { value } : {}), ...(href ? { href } : {}) });
    }

    let text = textParts.join("\n");
    if (text.length > MAX_TEXT_LENGTH) {
      text = text.slice(0, MAX_TEXT_LENGTH);
      truncated = true;
    }

    const snapshot: BrowserSnapshot = {
      revision: this.#revision,
      url: this.#target.getURL(),
      title: this.#target.getTitle(),
      text,
      elements,
      truncated,
      ...(nextOffset === undefined ? {} : { nextOffset }),
      ...(options.search ? { search: options.search } : {}),
    };
    for (const element of elements) if (element.href) this.#observedLinks.add(element.href);
    this.rememberUrls(text);
    this.#recentTexts = [...this.#recentTexts, looseText(`${text} ${elements.map(element => element.name ?? "").join(" ")}`)].slice(-RECENT_PAGES);
    const previous = observed ? this.#diffBaseline : this.#lastSnapshot;
    this.#lastSnapshot = snapshot;
    // A plain re-read of the page the model already has returns only what changed (like Codex's accessibility
    // diffs); the full page stays here as evidence. Narrowed or paged reads, and mode "full", are returned whole.
    const plain = options.mode === "auto" && !options.search && !options.ref && !options.selector && options.offset === undefined;
    const samePage = previous?.url === snapshot.url && previous.revision === snapshot.revision;
    if (observed) {
      this.#observedSnapshot = options.mode === "diff" ? null : snapshot;
      // Only reads the model receives (its tool always sets a mode) define what it has already seen.
      if (options.mode !== undefined && !options.search && !options.ref && !options.selector) this.#diffBaseline = snapshot;
    }
    if ((options.mode === "diff" || plain) && previous && samePage) {
      const oldText = new Set(previous.text.split("\n"));
      const oldElements = new Set(previous.elements.map(element => `${element.ref}:${element.name}:${element.value ?? ""}`));
      const text = snapshot.text.split("\n").filter(line => !oldText.has(line)).join("\n");
      const elements = snapshot.elements.filter(element => !oldElements.has(`${element.ref}:${element.name}:${element.value ?? ""}`));
      return { ...snapshot, text: text || (elements.length ? "" : "No change since your last read of this page."), elements,
        ...(plain ? { note: "Only what changed since your last read of this page; use mode \"full\" to see all of it." } : {}) };
    }
    return snapshot;
  }

  // Record tools reuse the model's observation. They validate referenced DOM
  // nodes without spending another snapshot or inheriting a search filter.
  async evidenceSnapshot(refs: readonly string[] = []): Promise<BrowserSnapshot> {
    const snapshot = this.#observedSnapshot;
    if (!snapshot) throw new Error("Take a full browser_snapshot before recording school evidence.");
    if (snapshot.search) throw new Error("Take a full unfiltered browser_snapshot before recording school evidence.");
    if (snapshot.revision !== this.#revision || snapshot.url !== this.#target.getURL()) throw new Error("The page changed. Take a new snapshot before recording.");
    for (const ref of refs) {
      const target = this.#targetForRef(ref);
      if (!snapshot.elements.some(element => element.ref === ref)) throw new Error("The ref is outside the current observation. Take a full snapshot before recording.");
      const { objectId } = await this.#resolve(ref);
      const connected = await this.#callOn(objectId, "function () { return Boolean(this.isConnected); }");
      if (connected.value !== true) throw new Error("The observed element changed. Take a new snapshot before recording.");
      if (target.revision !== snapshot.revision) throw new Error("The page changed while recording.");
    }
    return snapshot;
  }

  async link(ref: string): Promise<string> {
    const { objectId } = await this.#resolve(ref);
    const result = await this.#callOn(objectId, `function () {
      if (!this.isConnected) throw new Error("Link is no longer available");
      return this.closest("a[href]")?.href || "";
    }`);
    if (typeof result.value !== "string" || !result.value) throw new Error("The referenced element has no link destination");
    return parseSchoolUrl(result.value);
  }

  async rows(selector = "tr", offset = 0, limit = 50): Promise<{ readonly rows: readonly { readonly ref: string; readonly cells: readonly string[]; readonly href: string | null }[]; readonly nextOffset: number | null }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 80) throw new Error("Row limit must be 1–80");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Row offset must be nonnegative");
    if (selector.length > 200) throw new Error("Row selector is too long");
    const response = asRecord(await this.#send("Runtime.evaluate", {
      expression: `(() => ({ total:document.querySelectorAll(${JSON.stringify(selector)}).length, rows:[...document.querySelectorAll(${JSON.stringify(selector)})].slice(${offset},${offset + limit}).map(row => ({
        cells: [...row.querySelectorAll('th,td')].map(cell => (cell.innerText || cell.textContent || '').trim().replace(/\\s+/g,' ').slice(0,300)),
        href: row.querySelector('a[href]')?.href || null
      })).filter(row => row.cells.length) }))()`,
      returnByValue: true,
    }));
    const value = asRecord(asRecord(response.result).value);
    if (!Array.isArray(value.rows) || !Number.isSafeInteger(value.total)) throw new Error("The page did not provide a readable row list");
    const document = asRecord(await this.#send("DOM.getDocument", { depth: 1 }));
    const all = asRecord(await this.#send("DOM.querySelectorAll", { nodeId: asRecord(document.root).nodeId, selector }));
    const nodeIds = Array.isArray(all.nodeIds) ? all.nodeIds : [];
    const rows = [];
    const elements: BrowserSnapshot["elements"] = [];
    for (const [index, raw] of value.rows.entries()) {
      const row = asRecord(raw), nodeId = nodeIds[offset + index];
      if (typeof nodeId !== "number") throw new Error("A school row changed during extraction. Retry browser_rows.");
      const link = asRecord(await this.#send("DOM.querySelector", { nodeId, selector: "a[href]" }));
      const targetId = typeof link.nodeId === "number" && link.nodeId > 0 ? link.nodeId : nodeId;
      const described = asRecord(await this.#send("DOM.describeNode", { nodeId: targetId }));
      const backendNodeId = asRecord(described.node).backendNodeId;
      if (typeof backendNodeId !== "number") throw new Error("A school row lost its DOM identity. Retry browser_rows.");
      const key = `main:${backendNodeId}`;
      const ref = this.#nodeRefs.get(key) ?? `r${this.#revision}:${this.#nextRef++}`;
      this.#nodeRefs.set(key, ref);
      const cells = Array.isArray(row.cells) ? row.cells.map(cell => String(cell).slice(0, 300)) : [];
      const href = typeof row.href === "string" && /^https?:\/\//i.test(row.href) ? row.href : null;
      if (href) this.#observedLinks.add(href);
      const name = cells.join(" | ");
      this.#refs.set(ref, { backendNodeId, revision: this.#revision, frameId: "main", role: href ? "link" : "row", name });
      elements.push({ ref, role: href ? "link" : "row", name, ...(href ? { href } : {}) });
      rows.push({ ref, cells, href });
    }
    const nextOffset = offset + rows.length < (value.total as number) ? offset + rows.length : null;
    const snapshot: BrowserSnapshot = { revision: this.#revision, url: this.#target.getURL(), title: this.#target.getTitle(),
      text: elements.map(element => element.name).join("\n").slice(0, MAX_TEXT_LENGTH), elements,
      truncated: nextOffset !== null, ...(nextOffset === null ? {} : { nextOffset }) };
    this.#lastSnapshot = snapshot;
    this.#observedSnapshot = snapshot;
    this.#diffBaseline = snapshot;
    return { rows, nextOffset };
  }

  async scroll(direction: "up" | "down", ref?: string): Promise<BrowserSnapshot> {
    const amount = direction === "down" ? 600 : -600;
    if (ref) {
      const { objectId } = await this.#resolve(ref);
      await this.#callOn(objectId, `function (amount) { this.scrollIntoView({block:"center"}); this.scrollBy({top:amount,behavior:"instant"}); }`, [{ value: amount }]);
    } else {
      await this.#send("Runtime.evaluate", { expression: `window.scrollBy({top:${amount},behavior:"instant"})` });
    }
    return this.#afterAction();
  }

  async screenshot(): Promise<string> {
    const result = asRecord(await this.#send("Page.captureScreenshot", { format: "jpeg", quality: 70, captureBeyondViewport: false }));
    if (typeof result.data !== "string" || result.data.length > 8_000_000) throw new Error("The browser screenshot was unavailable or too large");
    return result.data;
  }

  async click(ref: string, allowSubmission = false, _readOnly = false): Promise<BrowserSnapshot> {
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
          submission: type === "submit" && Boolean(element.form),
          link: tag === "a" || element.getAttribute?.("role") === "link",
          // Anything typed, ticked, chosen or attached on this page; posting it could hand in work.
          touched: [...document.querySelectorAll("input, textarea, select")].some(field => {
            const kind = String(field.type || "").toLowerCase();
            if (kind === "hidden" || kind === "submit" || kind === "button") return false;
            if (kind === "file") return field.files?.length > 0;
            if (kind === "checkbox" || kind === "radio") return field.checked !== field.defaultChecked || (field.checked && field.offsetParent !== null);
            if (field.tagName === "SELECT") return [...field.options].some(option => option.selected !== option.defaultSelected);
            return field.value !== field.defaultValue;
          }),
          ltiLaunch: Boolean(element.form && String(element.form.method).toUpperCase() === "POST" && (() => {
            const names = new Set([...element.form.querySelectorAll('input[name]')].map(input => input.name.toLowerCase()));
            return (names.has("lti_message_type") && names.has("resource_link_id")) || (names.has("id_token") && names.has("state"));
          })()),
          label
        };
      }`),
    );
    const value = asRecord(inspection.value);
    const label = typeof value.label === "string" ? value.label : target.name;
    // Saving a draft is a form POST on many school sites, but does not hand in work.
    const draftSave = /^save(?: as)? draft$/i.test(label);
    const knownSubmission = (target.role !== "link" && SUBMISSION_PATTERN.test(label)) || (value.submission === true && !draftSave);
    if (knownSubmission && !allowSubmission && value.ltiLaunch !== true) {
      throw new Error("Ordinary click cannot activate a submission control. Use browser_submit only after the student explicitly asks to submit.");
    }
    if (value.connected !== true || value.disabled === true) {
      throw new Error("The referenced element is no longer available or is disabled");
    }
    if (value.link === true && !value.touched && !SUBMISSION_PATTERN.test(label)) this.#onLinkClick?.(this.#target.getURL());
    await this.#callOn(objectId, "function () { this.scrollIntoView({ block: 'center' }); this.click(); return true; }");
    return this.#afterAction();
  }

  async refreshRef(ref: string): Promise<{ readonly snapshot: BrowserSnapshot; readonly ref: string }> {
    const target = this.#targetForRef(ref);
    const url = this.#target.getURL();
    const snapshot = await this.snapshot({}, false);
    if (snapshot.revision !== target.revision || snapshot.url !== url) {
      throw new Error("The page changed while refreshing the submission control");
    }
    const matches = snapshot.elements.filter((element) => this.#refs.get(element.ref)?.backendNodeId === target.backendNodeId);
    if (matches.length !== 1) {
      throw new Error("The submission control could not be uniquely re-identified in a fresh browser snapshot");
    }
    return { snapshot, ref: matches[0]!.ref };
  }

  async #assertScanFilter(objectId: string): Promise<void> {
    const inspected = asRecord(await this.#callOn(objectId, `function () {
      const tag = String(this.tagName || "").toLowerCase();
      const type = String(this.type || "").toLowerCase();
      const label = [this.getAttribute?.("aria-label"), this.placeholder, ...(Array.from(this.labels || []).map(label => label.innerText))].filter(Boolean).join(" ");
      const safeType = tag === "select" || (tag === "input" && ["text", "search"].includes(type));
      return { scanFilter: safeType && (type === "search" || this.getAttribute?.("role") === "searchbox" || /\\b(search|filter)\\b/i.test(label)) };
    }`));
    if (asRecord(inspected.value).scanFilter !== true) throw new Error("A read-only school check can edit only identified search or filter controls");
  }

  async type(ref: string, text: string, readOnly = false): Promise<BrowserSnapshot> {
    const { objectId } = await this.#resolve(ref);
    if (readOnly) await this.#assertScanFilter(objectId);
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

  async select(ref: string, value: string, readOnly = false): Promise<BrowserSnapshot> {
    const { objectId } = await this.#resolve(ref);
    if (readOnly) await this.#assertScanFilter(objectId);
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

  async upload(ref: string, files: readonly string[]): Promise<BrowserSnapshot> {
    if (files.length < 1 || files.length > 12) {
      throw new TypeError("Browser upload requires between 1 and 12 workspace files");
    }
    const { objectId, target } = await this.#resolve(ref);
    const inspection = asRecord(
      await this.#callOn(objectId, `function () {
        return {
          connected: Boolean(this.isConnected),
          disabled: Boolean(this.disabled || this.getAttribute?.("aria-disabled") === "true"),
          fileInput: String(this.tagName || "").toLowerCase() === "input" && String(this.type || "").toLowerCase() === "file"
        };
      }`),
    );
    const value = asRecord(inspection.value);
    if (value.connected !== true || value.disabled === true || value.fileInput !== true) {
      throw new Error("The referenced element is not an available file input");
    }
    await this.#send("DOM.setFileInputFiles", {
      files: [...files],
      backendNodeId: target.backendNodeId,
    });
    return this.#afterAction();
  }

  async press(key: BrowserKey, readOnly = false): Promise<BrowserSnapshot> {
    if (readOnly && !["Tab", "Escape", "PageUp", "PageDown", "Home", "End"].includes(key)) throw new Error("A read-only school check uses clicks for navigation and cannot edit or activate forms with keys");
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
    this.#observedSnapshot = null;
    let latest = await this.snapshot({}, false);
    while (text && !latest.text.toLowerCase().includes(text.toLowerCase()) && Date.now() < deadline) {
      await delay(Math.min(250, Math.max(0, deadline - Date.now())));
      latest = await this.snapshot({}, false);
    }
    if (text && !latest.text.toLowerCase().includes(text.toLowerCase())) {
      throw new Error(`Timed out waiting for page text: ${text}`);
    }
    if (!text && timeoutMs > 0) {
      await delay(timeoutMs);
      latest = await this.snapshot({}, false);
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
    if (!target || target.revision !== this.#revision) {
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
    this.#observedSnapshot = null;
    await delay(ACTION_SETTLE_MS);
    return this.snapshot({}, false);
  }

  async #send(
    method: string,
    params: Record<string, unknown> = {},
    retryAfterDetach = false,
  ): Promise<unknown> {
    this.#ensureAttached();
    try {
      return await boundedBrowserOperation(this.#target.debugger.sendCommand(method, params), "The browser operation timed out. Try a fresh snapshot, a screenshot, or download the open document instead.");
    } catch (error) {
      if (!retryAfterDetach || this.#target.debugger.isAttached()) {
        throw error;
      }
      this.pageChanged();
      this.#ensureAttached();
      return boundedBrowserOperation(this.#target.debugger.sendCommand(method, params), "The browser operation timed out after reconnecting. Inspect the visible page or try downloading the document.");
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
  "PageUp",
  "PageDown",
  "Home",
  "End",
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
  PageUp: 33,
  PageDown: 34,
  Home: 36,
  End: 35,
};

export function formatSnapshot(snapshot: BrowserSnapshot): string {
  const elementLines = snapshot.elements.map((element) => {
    const value = element.value ? ` value=${JSON.stringify(element.value)}` : "";
    const href = element.href ? ` href=${JSON.stringify(element.href)}` : "";
    return `${element.ref} ${element.role} ${JSON.stringify(element.name)}${value}${href}`;
  });
  return [
    `Page revision ${snapshot.revision}: ${snapshot.title || "Untitled"}`,
    snapshot.url,
    snapshot.text,
    elementLines.length ? `Interactive elements:\n${elementLines.join("\n")}` : "Interactive elements: none",
    snapshot.nextOffset !== undefined ? `More page content: call browser_snapshot with offset=${snapshot.nextOffset}${snapshot.search ? ` and search=${JSON.stringify(snapshot.search)}` : ""}.` : "",
    snapshot.truncated ? "This observation is incomplete; inspect remaining content before claiming inventory coverage." : "",
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

async function boundedBrowserOperation<T>(operation: Promise<T>, message: string, milliseconds = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}
