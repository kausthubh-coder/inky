import { z } from "zod";

import {
  createIpcApi,
  createIpcHandlerRegistrations,
  type IpcHandlers,
} from "../../shared/ipc.js";

const registry = Object.freeze({
  measure: Object.freeze({
    channel: "synthetic:measure",
    requestSchema: z.string().transform((value) => value.length),
    resultSchema: z.string().transform((value) => value.length),
  }),
});

const api = createIpcApi(registry, async () => "accepted");
const handlers = {
  measure: (request) => {
    const parsedRequest: number = request;
    void parsedRequest;
    return request === 5 ? "accepted" : "rejected";
  },
} satisfies IpcHandlers<typeof registry>;
createIpcHandlerRegistrations(registry, handlers);

type MeasureHandler = IpcHandlers<typeof registry>["measure"];
const handlerRequest: Parameters<MeasureHandler>[0] = 5;
const parsedHandlerRequest: number = handlerRequest;
void parsedHandlerRequest;

// @ts-expect-error The handler receives request-schema output, not caller input.
const rawHandlerRequest: string = handlerRequest;
void rawHandlerRequest;

const handlerOutput: ReturnType<MeasureHandler> = "accepted";
void handlerOutput;

// @ts-expect-error The handler returns result-schema input, not parsed output.
const parsedHandlerOutput: ReturnType<MeasureHandler> = 8;
void parsedHandlerOutput;

const result: Promise<number> = api.measure("studi");
void result;

// @ts-expect-error The caller supplies schema input, not the parsed request output.
api.measure(5);

// @ts-expect-error A request-bearing IPC method requires exactly one argument.
api.measure();

// @ts-expect-error A request-bearing IPC method rejects extra arguments.
api.measure("studi", "extra");

// @ts-expect-error The caller receives the parsed result output, not its string input.
const wrongResult: Promise<string> = api.measure("studi");
void wrongResult;
