import { Icon } from "./Icon.js";
import { useEffect, useRef, useState } from "react";
import type { PublicTutorBlock } from "../../shared/tutor.js";
import { TUTOR_CODE_SANDBOX_HTML } from "../../shared/tutor-code-sandbox.js";

type Model = Extract<PublicTutorBlock, { tool: "tutor_show_model" }>["args"];
export function TutorModel({
  model,
  onExplore,
  disabled,
}: {
  model: Model;
  onExplore: (action: string) => void;
  disabled: boolean;
}) {
  switch (model.model) {
    case "population_grid":
      return (
        <Population model={model} onExplore={onExplore} disabled={disabled} />
      );
    case "flashcards":
      return (
        <Flashcards model={model} onExplore={onExplore} disabled={disabled} />
      );
    case "number_line":
      return (
        <NumberLine model={model} onExplore={onExplore} disabled={disabled} />
      );
    case "function_plot":
      return (
        <FunctionPlot model={model} onExplore={onExplore} disabled={disabled} />
      );
    case "code_runner":
      return (
        <CodeRunner model={model} onExplore={onExplore} disabled={disabled} />
      );
  }
}
type Props<K extends Model["model"]> = {
  model: Extract<Model, { model: K }>;
  onExplore: (action: string) => void;
  disabled: boolean;
};
function Population({ model, onExplore, disabled }: Props<"population_grid">) {
  const [size, setSize] = useState(
    Math.min(model.params.sampleSize, model.params.population),
  );
  const [sample, setSample] = useState<number[]>([]);
  const draw = () => {
    const chosen = new Set<number>();
    while (chosen.size < size)
      chosen.add(Math.floor(Math.random() * model.params.population));
    setSample([...chosen]);
    onExplore("Drew a sample of " + size);
  };
  const successes = sample.filter(
    (value) =>
      value < Math.round(model.params.population * model.params.proportion),
  ).length;
  return (
    <div className="rd-model">
      <p>
        A population of {model.params.population.toLocaleString()}.{" "}
        {Math.round(model.params.proportion * 100)}% are highlighted.
      </p>
      <div
        className="rd-population"
        role="img"
        aria-label={
          sample.length
            ? `Sample: ${successes} of ${sample.length} highlighted`
            : "Population, shown as 100 dots"
        }
      >
        {Array.from({ length: 100 }, (_, index) => (
          <i
            key={index}
            className={
              (
                sample.length
                  ? sample[index % sample.length]! <
                    model.params.population * model.params.proportion
                  : index < model.params.proportion * 100
              )
                ? "marked"
                : ""
            }
          />
        ))}
      </div>
      {sample.length > 0 && (
        <p role="status">
          Your sample: {successes} / {sample.length} ·{" "}
          {Math.round((successes / sample.length) * 100)}%
        </p>
      )}
      <div className="rd-actions">
        {model.controls.includes("sampleSize") && (
          <label>
            Sample size{" "}
            <input
              type="range"
              min={1}
              max={Math.min(500, model.params.population)}
              value={size}
              disabled={disabled}
              onChange={(event) => setSize(Number(event.target.value))}
            />
            <output>{size}</output>
          </label>
        )}
        {model.controls.includes("sample") && (
          <button
            className="rd-button primary"
            disabled={disabled}
            onClick={draw}
          >
            Draw a sample
          </button>
        )}
        {model.controls.includes("reset") && (
          <button
            className="rd-link"
            disabled={disabled}
            onClick={() => {
              setSample([]);
              setSize(
                Math.min(model.params.sampleSize, model.params.population),
              );
              onExplore("Reset the sample");
            }}
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
function Flashcards({ model, onExplore, disabled }: Props<"flashcards">) {
  const [index, setIndex] = useState(0),
    [flipped, setFlipped] = useState(false);
  const card = model.params.cards[index]!;
  const move = (delta: number) => {
    setIndex(
      (value) =>
        (value + delta + model.params.cards.length) % model.params.cards.length,
    );
    setFlipped(false);
    onExplore("Changed flashcard");
  };
  return (
    <div className="rd-model">
      <p className="rd-muted">
        Card {index + 1} of {model.params.cards.length}
      </p>
      <div className="rd-flashcard" aria-live="polite">
        {flipped ? card.back : card.front}
      </div>
      <div className="rd-actions">
        {model.controls.includes("previous") && (
          <button
            className="rd-link"
            disabled={disabled}
            onClick={() => move(-1)}
          >
            <Icon name="back" size={15} /> Previous
          </button>
        )}
        {model.controls.includes("flip") && (
          <button
            className="rd-button primary"
            disabled={disabled}
            onClick={() => {
              setFlipped((value) => !value);
              onExplore("Flipped card " + (index + 1));
            }}
          >
            Flip card
          </button>
        )}
        {model.controls.includes("next") && (
          <button
            className="rd-link"
            disabled={disabled}
            onClick={() => move(1)}
          >
            Next <Icon name="forward" size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
function NumberLine({ model, onExplore, disabled }: Props<"number_line">) {
  const { min, max, step } = model.params;
  const [points, setPoints] = useState(model.params.points);
  if (max <= min)
    return (
      <p role="alert">
        This number line has an invalid range. Ask Inky to try again.
      </p>
    );
  return (
    <div className="rd-model">
      <svg
        className="rd-plot"
        viewBox="0 0 600 120"
        role="img"
        aria-label={
          "Number line from " +
          min +
          " to " +
          max +
          ". Points: " +
          points.join(", ")
        }
      >
        <line x1="30" x2="570" y1="60" y2="60" stroke="currentColor" />
        {Array.from({ length: 11 }, (_, i) => (
          <g key={i}>
            <line
              x1={30 + i * 54}
              x2={30 + i * 54}
              y1="54"
              y2="66"
              stroke="currentColor"
            />
            <text x={30 + i * 54} y="90" textAnchor="middle">
              {Number((min + ((max - min) * i) / 10).toFixed(2))}
            </text>
          </g>
        ))}
        {points.map((point, i) => (
          <circle
            key={i}
            cx={
              30 +
              ((Math.min(max, Math.max(min, point)) - min) / (max - min)) * 540
            }
            cy="60"
            r="7"
            fill="var(--highlighter)"
            stroke="currentColor"
          />
        ))}
      </svg>
      {model.controls.includes("move") &&
        points.map((point, i) => (
          <label className="rd-slider" key={i}>
            Point {i + 1}
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={point}
              disabled={disabled}
              onChange={(event) => {
                const value = Number(event.target.value);
                setPoints((old) => old.map((p, j) => (j === i ? value : p)));
                onExplore("Moved point " + (i + 1) + " to " + value);
              }}
            />
            <output>{point}</output>
          </label>
        ))}
      {model.controls.includes("reset") && (
        <button
          className="rd-link"
          disabled={disabled}
          onClick={() => {
            setPoints(model.params.points);
            onExplore("Reset number line");
          }}
        >
          Reset
        </button>
      )}
    </div>
  );
}
function FunctionPlot({ model, onExplore, disabled }: Props<"function_plot">) {
  const [coefficients, setCoefficients] = useState({
    a: model.params.a,
    b: model.params.b,
    c: model.params.c,
  });
  const { xMin, xMax, family } = model.params,
    { a, b, c } = coefficients;
  if (xMax <= xMin)
    return (
      <p role="alert">This plot has an invalid range. Ask Inky to try again.</p>
    );
  const values = Array.from({ length: 201 }, (_, i) => {
    const x = xMin + ((xMax - xMin) * i) / 200;
    return {
      x,
      y:
        family === "linear"
          ? a * x + b
          : family === "quadratic"
            ? a * x * x + b * x + c
            : a * Math.sin(b * x) + c,
    };
  });
  const yLimit = Math.max(1, ...values.map((p) => Math.abs(p.y)));
  const path = values
    .map(
      (p, i) =>
        `${i ? "L" : "M"}${30 + ((p.x - xMin) / (xMax - xMin)) * 540},${140 - (p.y / yLimit) * 110}`,
    )
    .join(" ");
  return (
    <div className="rd-model">
      <p>
        {family === "linear"
          ? `y = ${a}x + ${b}`
          : family === "quadratic"
            ? `y = ${a}x² + ${b}x + ${c}`
            : `y = ${a} sin(${b}x) + ${c}`}
      </p>
      <svg
        className="rd-plot"
        viewBox="0 0 600 280"
        role="img"
        aria-label={
          family +
          " function, x from " +
          xMin +
          " to " +
          xMax +
          ", y from " +
          (-yLimit).toFixed(1) +
          " to " +
          yLimit.toFixed(1)
        }
      >
        <line x1="30" x2="570" y1="140" y2="140" stroke="var(--graphite)" />
        {xMin <= 0 && xMax >= 0 && (
          <line
            x1={30 - (xMin / (xMax - xMin)) * 540}
            x2={30 - (xMin / (xMax - xMin)) * 540}
            y1="20"
            y2="260"
            stroke="var(--graphite)"
          />
        )}
        <path d={path} fill="none" stroke="var(--pencil)" strokeWidth="2.5" />
        <text x="30" y="275">
          {xMin}
        </text>
        <text x="550" y="275">
          {xMax}
        </text>
        <text x="3" y="25">
          {yLimit.toFixed(1)}
        </text>
      </svg>
      {(["a", "b", "c"] as const)
        .filter((key) => model.controls.includes(key))
        .map((key) => (
          <label className="rd-slider" key={key}>
            {key}
            <input
              type="range"
              min="-100"
              max="100"
              step=".1"
              value={coefficients[key]}
              disabled={disabled}
              onChange={(event) => {
                const value = Number(event.target.value);
                setCoefficients((old) => ({ ...old, [key]: value }));
                onExplore("Set " + key + " to " + value);
              }}
            />
            <output>{coefficients[key]}</output>
          </label>
        ))}
      {model.controls.includes("reset") && (
        <button
          className="rd-link"
          disabled={disabled}
          onClick={() => {
            setCoefficients({
              a: model.params.a,
              b: model.params.b,
              c: model.params.c,
            });
            onExplore("Reset plot");
          }}
        >
          Reset
        </button>
      )}
    </div>
  );
}
function CodeRunner({ model, onExplore, disabled }: Props<"code_runner">) {
  const [code, setCode] = useState(model.params.code),
    [output, setOutput] = useState(""),
    [running, setRunning] = useState(false),
    [ready, setReady] = useState(false),
    [generation, setGeneration] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null),
    runId = useRef<string | null>(null),
    watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        !runId.current ||
        event.data?.channel !== "studi-tutor-code" ||
        event.data.runId !== runId.current
      )
        return;
      if (
        !["completed", "failed", "timed_out", "cancelled"].includes(
          event.data.outcome,
        )
      )
        return;
      if (watchdog.current) clearTimeout(watchdog.current);
      runId.current = null;
      setRunning(false);
      const logs = Array.isArray(event.data.logs)
        ? event.data.logs
            .slice(0, 50)
            .map((line: unknown) => String(line).slice(0, 2000))
            .join("\n")
        : "";
      setOutput(
        [
          logs,
          typeof event.data.error === "string"
            ? event.data.error.slice(0, 2000)
            : "",
        ]
          .filter(Boolean)
          .join("\n") || "Finished with no output.",
      );
      onExplore("Ran JavaScript: " + event.data.outcome);
    };
    window.addEventListener("message", receive);
    return () => {
      window.removeEventListener("message", receive);
      if (watchdog.current) clearTimeout(watchdog.current);
    };
  }, [onExplore]);
  const run = () => {
    if (!ready || running || disabled) return;
    const id = crypto.randomUUID();
    runId.current = id;
    setRunning(true);
    setOutput("Running…");
    frame.current?.contentWindow?.postMessage(
      {
        channel: "studi-tutor-code",
        runId: id,
        code: code.slice(0, 12000),
        timeoutMs: Math.min(1000, model.params.timeoutMs),
      },
      "*",
    );
    watchdog.current = setTimeout(() => {
      runId.current = null;
      setRunning(false);
      setOutput("Stopped: the code exceeded its time limit.");
      setReady(false);
      setGeneration((value) => value + 1);
    }, 1500);
  };
  return (
    <div className="rd-model">
      <p>{model.params.instructions}</p>
      <label className="rd-code-label">
        JavaScript
        <textarea
          className="rd-code"
          spellCheck={false}
          maxLength={12000}
          value={code}
          readOnly={disabled || !model.controls.includes("edit")}
          onChange={(event) => setCode(event.target.value)}
        />
      </label>
      <iframe
        key={generation}
        ref={frame}
        sandbox="allow-scripts"
        srcDoc={TUTOR_CODE_SANDBOX_HTML}
        title="Isolated JavaScript runner"
        hidden
        onLoad={() => setReady(true)}
      />
      <div className="rd-actions">
        {model.controls.includes("run") && (
          <button
            className="rd-button primary"
            disabled={disabled || running || !ready}
            onClick={run}
          >
            {running ? "Running…" : "Run code"}
          </button>
        )}
        {model.controls.includes("reset") && (
          <button
            className="rd-link"
            disabled={disabled || running}
            onClick={() => {
              setCode(model.params.code);
              setOutput("");
              onExplore("Reset code");
            }}
          >
            Reset
          </button>
        )}
      </div>
      {output && (
        <pre className="rd-code-output" aria-live="polite">
          {output}
        </pre>
      )}
    </div>
  );
}
