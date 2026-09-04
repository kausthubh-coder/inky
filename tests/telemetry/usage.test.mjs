import assert from "node:assert/strict";
import test from "node:test";

import { PiEventNormalizer } from "../../dist/electron/agent/runtime.js";
import {
  addUsage,
  emptyUsage,
  readMessageUsage,
  usageProperties,
} from "../../dist/electron/telemetry/usage.js";

test("Pi usage is summed from assistant messages and tool calls", () => {
  const first = readMessageUsage({
    role: "assistant",
    usage: {
      input: 1200,
      output: 400,
      cacheRead: 80,
      cacheWrite: 20,
      cost: { input: 0.01, output: 0.02, cacheRead: 0.001, cacheWrite: 0.002, total: 0.033 },
    },
  });
  const second = addUsage(first, readMessageUsage({
    usage: { input: 100, output: 50, cost: 0.004 },
  }));
  assert.deepEqual(usageProperties(addUsage(second, { ...emptyUsage(), toolCalls: 3 })), {
    input_tokens: 1300,
    output_tokens: 450,
    cache_read_tokens: 80,
    cache_write_tokens: 20,
    total_tokens: 1850,
    cost_usd: 0.037,
    tool_calls: 3,
  });

  const normalizer = new PiEventNormalizer();
  normalizer.accept({
    type: "message_end",
    message: {
      role: "assistant",
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: { total: 0.002 } },
    },
  });
  normalizer.accept({
    type: "tool_execution_end",
    toolCallId: "call-1",
    toolName: "browser_snapshot",
    isError: false,
  });
  assert.deepEqual(usageProperties(normalizer.takeUsage()), {
    input_tokens: 10,
    output_tokens: 5,
    total_tokens: 15,
    cost_usd: 0.002,
    tool_calls: 1,
  });
  assert.deepEqual(usageProperties(normalizer.takeUsage()), {});
});
