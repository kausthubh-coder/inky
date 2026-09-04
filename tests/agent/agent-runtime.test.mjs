import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  InMemoryCredentialStore,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

import {
  FakeAgentRuntime,
  PiAgentRuntime,
  PiEventNormalizer,
} from "../../dist/electron/agent/runtime.js";
import { AgentRunEventSchema, ProviderStatusSchema } from "../../dist/shared/index.js";

const expectedProbeEvents = [
  {
    schemaVersion: 1,
    type: "tool_started",
    toolCallId: "studi-probe-call",
    toolName: "studi_probe",
    arguments: {},
  },
  {
    schemaVersion: 1,
    type: "tool_finished",
    toolCallId: "studi-probe-call",
    toolName: "studi_probe",
    outcome: "succeeded",
    result: {
      content: [{ type: "text", text: "Studi probe ready." }],
      details: { ready: true },
    },
  },
  { schemaVersion: 1, type: "text", delta: "Prob" },
  { schemaVersion: 1, type: "text", delta: "e co" },
  { schemaVersion: 1, type: "text", delta: "mple" },
  { schemaVersion: 1, type: "text", delta: "te." },
  { schemaVersion: 1, type: "terminal", outcome: "completed" },
];

test("real Pi session exposes only studi_probe, resumes, and matches the deterministic fake", async () => {
  await withRuntime({ tokenSize: { min: 1, max: 1 } }, async ({ faux, runtime, root }) => {
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("studi_probe", {}, { id: "studi-probe-call" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("Probe complete."),
    ]);

    const readyStatus = await runtime.getProviderStatus("studi-faux");
    assert.deepEqual(ProviderStatusSchema.parse(readyStatus), {
      schemaVersion: 1,
      providerId: "studi-faux",
      providerName: "studi-faux",
      state: "ready",
      loginMethods: [],
      reason: "studi-faux is ready to use.",
    });
    assert.deepEqual(await runtime.getProviderStatus("studi-login"), {
      schemaVersion: 1,
      providerId: "studi-login",
      providerName: "Studi login",
      state: "needs_login",
      loginMethods: ["oauth"],
      reason: "Studi login needs authentication.",
    });
    const canary = "sk-test-secret C:\\private\\auth.json";
    const missingStatus = await runtime.getProviderStatus(canary);
    assert.equal(missingStatus.providerId, "unknown");
    assert.equal(missingStatus.state, "unavailable");
    assert.doesNotMatch(JSON.stringify(missingStatus), /sk-test-secret|private|auth\.json/);

    const session = await runtime.createSession();
    try {
      assert.deepEqual(session.toolNames, ["studi_probe"]);
      const firstTurn = [];
      const allEvents = [];
      session.subscribe((event) => {
        AgentRunEventSchema.parse(event);
        firstTurn.push(event);
        allEvents.push(event);
      });
      await session.prompt("Run the Studi probe.");
      assert.deepEqual(withoutDurations(firstTurn), expectedProbeEvents);

      const fake = await new FakeAgentRuntime().createSession();
      const fakeEvents = [];
      fake.subscribe((event) => fakeEvents.push(event));
      await fake.prompt("Run the Studi probe.");
      assert.deepEqual(withoutDurations(fakeEvents), withoutDurations(firstTurn));
      fake.dispose();

      const sessionPath = session.sessionPath;
      assert.equal(typeof sessionPath, "string");
      assert.equal(existsSync(sessionPath), true);
      const originalSessionId = session.sessionId;
      const transcript = await readFile(sessionPath, "utf8");
      assert.match(transcript, /studi_probe/);
      assert.doesNotMatch(transcript, /sk-test-secret|private|auth\.json/);

      faux.appendResponses([fauxAssistantMessage("Resumed.")]);
      await session.replace({ resumeSessionPath: sessionPath });
      assert.equal(session.sessionId, originalSessionId);
      assert.deepEqual(session.toolNames, ["studi_probe"]);
      const beforeResumePrompt = allEvents.length;
      await session.prompt("Continue the resumed session.");
      assert.deepEqual(allEvents.slice(beforeResumePrompt), [
        { schemaVersion: 1, type: "text", delta: "Resu" },
        { schemaVersion: 1, type: "text", delta: "med." },
        { schemaVersion: 1, type: "terminal", outcome: "completed" },
      ]);

      const beforeCompaction = allEvents.length;
      await assert.rejects(session.compact("Keep the probe result."), /Nothing to compact/);
      assert.deepEqual(allEvents.slice(beforeCompaction), [
        { schemaVersion: 1, type: "compaction", phase: "started", reason: "manual" },
        {
          schemaVersion: 1,
          type: "compaction",
          phase: "finished",
          reason: "manual",
          outcome: "failed",
        },
      ]);
    } finally {
      session.dispose();
    }

    assert.equal(existsSync(join(root, "agent", "sessions")), true);
  });
});

function withoutDurations(events) {
  return events.map(({ durationMs: _durationMs, ...event }) => event);
}

test("real Pi abort produces one abort event followed by an aborted terminal event", async () => {
  await withRuntime(
    { tokenSize: { min: 1, max: 1 }, tokensPerSecond: 10 },
    async ({ faux, runtime }) => {
      faux.setResponses([
        fauxAssistantMessage("This response is long enough to abort after its first chunk."),
      ]);
      const session = await runtime.createSession();
      try {
        const events = [];
        let resolveFirstText;
        const firstText = new Promise((resolveText) => {
          resolveFirstText = resolveText;
        });
        session.subscribe((event) => {
          events.push(event);
          if (event.type === "text") {
            resolveFirstText();
          }
        });
        const prompt = session.prompt("Start a response.");
        await firstText;
        await session.abort();
        await prompt;
        assert.deepEqual(events.slice(-2), [
          { schemaVersion: 1, type: "aborted" },
          { schemaVersion: 1, type: "terminal", outcome: "aborted" },
        ]);
        assert.equal(events.filter((event) => event.type === "aborted").length, 1);
      } finally {
        session.dispose();
      }
    },
  );
});

test("retry and completed compaction normalization remove upstream error text", () => {
  const normalizer = new PiEventNormalizer();
  const canary = "sk-secret-from-provider C:\\credentials\\auth.json";
  const events = [
    ...normalizer.accept({
      type: "auto_retry_start",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 50,
      errorMessage: canary,
    }),
    ...normalizer.accept({
      type: "auto_retry_end",
      success: false,
      attempt: 3,
      finalError: canary,
    }),
    ...normalizer.accept({ type: "compaction_start", reason: "threshold" }),
    ...normalizer.accept({
      type: "compaction_end",
      reason: "threshold",
      result: undefined,
      aborted: false,
      willRetry: false,
    }),
  ];

  for (const event of events) {
    AgentRunEventSchema.parse(event);
  }
  assert.doesNotMatch(JSON.stringify(events), /sk-secret-from-provider|credentials|auth\.json/);
  assert.deepEqual(events.at(-1), {
    schemaVersion: 1,
    type: "compaction",
    phase: "finished",
    reason: "threshold",
    outcome: "completed",
  });
});

test("provider failures and every fake operation stay inside the public contract", async () => {
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-wp03-provider-")));
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.match(basename(root), /^studi-wp03-provider-/);
  const canary = "sk-provider-secret C:\\private\\auth.json upstream detail";
  const failingModelRuntime = {
    getProvider: () => ({
      id: "studi-broken",
      name: "Studi broken",
      auth: {
        apiKey: {
          login: async () => {
            throw new Error("The status check must not start a login flow");
          },
        },
      },
    }),
    checkAuth: async () => {
      throw new Error(canary);
    },
  };

  try {
    const runtime = await PiAgentRuntime.create({
      cwd: root,
      agentDir: join(root, "agent"),
      modelRuntime: failingModelRuntime,
    });
    const status = ProviderStatusSchema.parse(await runtime.getProviderStatus("studi-broken"));
    assert.deepEqual(status, {
      schemaVersion: 1,
      providerId: "studi-broken",
      providerName: "Studi broken",
      state: "unavailable",
      loginMethods: ["api_key"],
      reason: "Studi could not check Studi broken authentication.",
    });
    assert.doesNotMatch(JSON.stringify(status), /sk-provider-secret|private|auth\.json|upstream detail/);

    const fakeRuntime = new FakeAgentRuntime();
    ProviderStatusSchema.parse(await fakeRuntime.getProviderStatus("fake"));
    ProviderStatusSchema.parse(await fakeRuntime.getProviderStatus(canary));
    const fake = await fakeRuntime.createSession();
    const events = [];
    fake.subscribe((event) => events.push(AgentRunEventSchema.parse(event)));
    await fake.compact("Keep the probe result.");
    await fake.abort();
    await fake.replace({ resumeSessionPath: "fake-resumed.jsonl" });
    const beforeReplacementPrompt = events.length;
    await fake.prompt("Run the Studi probe after replacement.");
    assert.equal(fake.sessionPath, "fake-resumed.jsonl");
    assert.deepEqual(events.slice(0, 4), [
      { schemaVersion: 1, type: "compaction", phase: "started", reason: "manual" },
      {
        schemaVersion: 1,
        type: "compaction",
        phase: "finished",
        reason: "manual",
        outcome: "completed",
      },
      { schemaVersion: 1, type: "aborted" },
      { schemaVersion: 1, type: "terminal", outcome: "aborted" },
    ]);
    assert.deepEqual(withoutDurations(events.slice(beforeReplacementPrompt)), expectedProbeEvents);
    fake.dispose();
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    assert.equal(existsSync(root), false);
  }
});

test("OpenAI Codex login selects Pi device code and forwards only its handoff", async () => {
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-wp12-login-")));
  const selected = [];
  const notifications = [];
  const opened = [];
  const modelRuntime = {
    login: async (providerId, type, interaction) => {
      assert.equal(providerId, "openai-codex");
      assert.equal(type, "oauth");
      selected.push(await interaction.prompt({
        type: "select",
        message: "Select OpenAI Codex login method:",
        options: [
          { id: "browser", label: "Browser" },
          { id: "device_code", label: "Device code" },
        ],
      }));
      interaction.notify({
        type: "device_code",
        userCode: "SAFE-CODE",
        verificationUri: "https://auth.openai.com/codex/device",
        expiresInSeconds: 900,
      });
    },
  };

  try {
    const runtime = await PiAgentRuntime.create({
      cwd: root,
      agentDir: join(root, "agent"),
      modelRuntime,
      model: { id: "codex-test", name: "Codex test", provider: "openai-codex" },
    });
    await runtime.loginOpenAiCodex("device_code", new AbortController().signal, {
      openExternal: async (url) => { opened.push(url); },
      notify: (event) => notifications.push(event),
    });
    assert.deepEqual(selected, ["device_code"]);
    assert.deepEqual(notifications, [{
      type: "device_code",
      userCode: "SAFE-CODE",
      verificationUri: "https://auth.openai.com/codex/device",
      expiresInSeconds: 900,
    }]);
    assert.deepEqual(opened, ["https://auth.openai.com/codex/device"]);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

async function withRuntime(fauxOptions, run) {
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-wp03-agent-")));
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.match(basename(root), /^studi-wp03-agent-/);
  const cwd = join(root, "cwd");
  await mkdir(cwd);
  try {
    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false,
      signal: AbortSignal.timeout(3_000),
    });
    const faux = fauxProvider({
      provider: "studi-faux",
      api: "studi-faux",
      ...fauxOptions,
    });
    modelRuntime.registerNativeProvider(faux.provider);
    const loginFaux = fauxProvider({ provider: "studi-login", api: "studi-login" });
    modelRuntime.registerNativeProvider({
      ...loginFaux.provider,
      name: "Studi login",
      auth: {
        oauth: {
          name: "Studi OAuth",
          login: async () => {
            throw new Error("The test must not start a login flow");
          },
          refresh: async (credential) => credential,
          toAuth: async () => ({}),
        },
      },
    });
    const runtime = await PiAgentRuntime.create({
      cwd,
      agentDir: join(root, "agent"),
      modelRuntime,
      model: faux.getModel(),
    });
    await run({ faux, runtime, root });
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    assert.equal(existsSync(root), false);
  }
}
