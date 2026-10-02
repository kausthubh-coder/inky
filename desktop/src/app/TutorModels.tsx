import { Icon } from "./Icon.js";
import { useEffect, useRef, useState } from "react";
import type { PublicTutorBlock } from "../../shared/tutor.js";
import { TUTOR_CODE_SANDBOX_HTML } from "../../shared/tutor-code-sandbox.js";

// The board's visuals. Figures are pencil, what Chalky adds is its purple, and every label and number is plain type.
type Model = Extract<PublicTutorBlock, { tool: "tutor_show_model" }>["args"];
type Props<K extends Model["model"]> = { model: Extract<Model, { model: K }>; onExplore: (action: string) => void; disabled: boolean };
const round = (value: number) => Number(value.toFixed(2));

export function TutorModel({ model, onExplore, disabled }: { model: Model; onExplore: (action: string) => void; disabled: boolean }) {
  switch (model.model) {
    case "population_grid": return <Population model={model} onExplore={onExplore} disabled={disabled} />;
    case "flashcards": return <Flashcards model={model} onExplore={onExplore} disabled={disabled} />;
    case "number_line": return <NumberLine model={model} onExplore={onExplore} disabled={disabled} />;
    case "function_plot": return <FunctionPlot model={model} onExplore={onExplore} disabled={disabled} />;
    case "code_runner": return <CodeRunner model={model} onExplore={onExplore} disabled={disabled} />;
    case "table": return <Table model={model} />;
  }
}

function Table({ model }: Pick<Props<"table">, "model">) {
  return (
    <table className="tu-table">
      <thead><tr>{model.params.columns.map((column, index) => <th key={index} scope="col">{column}</th>)}</tr></thead>
      <tbody>{model.params.rows.map((row, index) => <tr key={index}>{row.map((value, cell) => <td key={cell}>{value}</td>)}</tr>)}</tbody>
    </table>
  );
}

function Population({ model, onExplore, disabled }: Props<"population_grid">) {
  const { population, proportion } = model.params, start = Math.min(model.params.sampleSize, population);
  const [size, setSize] = useState(start), [sample, setSample] = useState<number[]>([]);
  useEffect(() => { setSize(start); setSample([]); }, [start, population, proportion]);
  const draw = () => {
    const chosen = new Set<number>();
    while (chosen.size < size) chosen.add(Math.floor(Math.random() * population));
    setSample([...chosen]);
    onExplore("Drew a sample of " + size);
  };
  const marked = (value: number) => value < Math.round(population * proportion);
  const hits = sample.filter(marked).length;
  return (
    <div className="tu-model">
      <p className="tu-lab">A population of {population.toLocaleString()}. {Math.round(proportion * 100)}% are filled in.</p>
      <div className="tu-population" role="img" aria-label={sample.length ? `Sample: ${hits} of ${sample.length} filled in` : "The population, shown as 100 dots"}>
        {Array.from({ length: 100 }, (_, index) => <i key={index} className={(sample.length ? marked(sample[index % sample.length]!) : index < proportion * 100) ? "on" : ""} />)}
      </div>
      <div className="tu-slide">
        {model.controls.includes("sampleSize") && <label><span className="tu-lab">sample size</span>
          <input type="range" min={1} max={Math.min(500, population)} value={size} disabled={disabled} onChange={event => setSize(Number(event.target.value))} /><b>{size}</b></label>}
        {model.controls.includes("sample") && <button type="button" className="rd-button" disabled={disabled} onClick={draw}>Draw a sample</button>}
        {model.controls.includes("reset") && <button type="button" className="rd-quiet" disabled={disabled} onClick={() => { setSample([]); setSize(start); onExplore("Reset the sample"); }}>Reset</button>}
        {sample.length > 0 && <span role="status"><span className="tu-lab">your sample</span> <b>{hits} of {sample.length}</b> <span className="tu-lab">→</span> <b>{Math.round(hits / sample.length * 100)}%</b></span>}
      </div>
    </div>
  );
}

function Flashcards({ model, onExplore, disabled }: Props<"flashcards">) {
  const cards = model.params.cards;
  const [index, setIndex] = useState(0), [flipped, setFlipped] = useState(false);
  const card = cards[index % cards.length]!;
  const move = (delta: number) => { setIndex(value => (value + delta + cards.length) % cards.length); setFlipped(false); onExplore("Changed flashcard"); };
  return (
    <div className="tu-model">
      <div className="tu-card" aria-live="polite">{flipped ? card.back : card.front}</div>
      <div className="tu-slide">
        {model.controls.includes("flip") && <button type="button" className="rd-button" disabled={disabled} onClick={() => { setFlipped(value => !value); onExplore("Flipped card " + (index + 1)); }}>Flip card</button>}
        {model.controls.includes("previous") && <button type="button" className="rd-quiet" disabled={disabled} onClick={() => move(-1)}><Icon name="back" size={15} /> Previous</button>}
        {model.controls.includes("next") && <button type="button" className="rd-quiet" disabled={disabled} onClick={() => move(1)}>Next <Icon name="forward" size={15} /></button>}
        <span className="tu-lab">Card {index + 1} of {cards.length}</span>
      </div>
    </div>
  );
}

function NumberLine({ model, onExplore, disabled }: Props<"number_line">) {
  const { min, max, step } = model.params, saved = model.params.points.join(",");
  const [points, setPoints] = useState(model.params.points);
  useEffect(() => { setPoints(saved ? saved.split(",").map(Number) : []); }, [saved]);
  if (max <= min) return <p role="alert">This number line has an invalid range. Ask Chalky to try again.</p>;
  const x = (value: number) => 20 + (Math.min(max, Math.max(min, value)) - min) / (max - min) * 680;
  return (
    <div className="tu-model">
      <svg className="tu-pic is-line" viewBox="0 0 720 76" preserveAspectRatio="xMinYMid meet" role="img" aria-label={`Number line from ${min} to ${max}. Points: ${points.join(", ")}`}>
        <path d="M20 30H700" stroke="var(--pencil)" strokeWidth="2.2" strokeLinecap="round" />
        {Array.from({ length: 11 }, (_, index) => <g key={index}>
          <path d={`M${20 + index * 68} 23v14`} stroke="var(--pencil)" strokeWidth="2" strokeLinecap="round" />
          <text x={20 + index * 68} y="62" textAnchor="middle">{round(min + (max - min) * index / 10)}</text>
        </g>)}
        {points.map((point, index) => <circle key={index} cx={x(point)} cy="30" r="8" fill="#b7a3dd" stroke="var(--pencil)" strokeWidth="2" />)}
      </svg>
      {model.controls.includes("move") && points.map((point, index) => <div className="tu-slide" key={index}><label><span className="tu-lab">point {index + 1}</span>
        <input type="range" min={min} max={max} step={step} value={point} disabled={disabled} onChange={event => {
          const value = Number(event.target.value);
          setPoints(old => old.map((item, other) => other === index ? value : item));
          onExplore(`Moved point ${index + 1} to ${value}`);
        }} /><b>{point}</b></label></div>)}
      {model.controls.includes("reset") && <div className="tu-slide"><button type="button" className="rd-quiet" disabled={disabled} onClick={() => { setPoints(model.params.points); onExplore("Reset number line"); }}>Reset</button></div>}
    </div>
  );
}

function FunctionPlot({ model, onExplore, disabled }: Props<"function_plot">) {
  const { xMin, xMax, family, secant } = model.params;
  const [coefficients, setCoefficients] = useState({ a: model.params.a, b: model.params.b, c: model.params.c });
  const [gap, setGap] = useState(secant?.gap ?? 0);
  useEffect(() => { setCoefficients({ a: model.params.a, b: model.params.b, c: model.params.c }); }, [model.params.a, model.params.b, model.params.c]);
  useEffect(() => { setGap(secant?.gap ?? 0); }, [secant?.x, secant?.gap]);
  if (xMax <= xMin) return <p role="alert">This plot has an invalid range. Ask Chalky to try again.</p>;
  const { a, b, c } = coefficients;
  const f = (x: number) => family === "linear" ? a * x + b : family === "quadratic" ? a * x * x + b * x + c : a * Math.sin(b * x) + c;
  const values = Array.from({ length: 121 }, (_, index) => { const x = xMin + (xMax - xMin) * index / 120; return { x, y: f(x) }; });
  // The picture is 720 by 230 and never changes size; the curve is fitted inside it.
  const low = Math.min(0, ...values.map(point => point.y)), high = Math.max(low + 1, ...values.map(point => point.y));
  const px = (x: number) => 44 + (x - xMin) / (xMax - xMin) * 660, py = (y: number) => 202 - (y - low) / (high - low) * 186;
  const axisX = Math.min(704, Math.max(44, px(0)));
  const width = secant ? Math.min(gap, xMax - secant.x) : 0;
  const slope = !secant ? 0 : width > 0 ? (f(secant.x + width) - f(secant.x)) / width : family === "linear" ? a : family === "quadratic" ? 2 * a * secant.x + b : a * b * Math.cos(b * secant.x);
  // The line through the two points, drawn a little past each and kept inside the picture.
  const line = (x: number) => f(secant!.x) + slope * (x - secant!.x);
  const reach = (xMax - xMin) / 5;
  const within = (from: number, toward: number) => {
    let x = toward;
    for (let tries = 0; tries < 20 && (line(x) > high || line(x) < low); tries++) x = (x + from) / 2;
    return x;
  };
  const from = secant ? within(secant.x, Math.max(xMin, secant.x - reach)) : 0, to = secant ? within(secant.x + width, Math.min(xMax, secant.x + width + reach)) : 0;
  // "y = x² − 3x", not "y = 1x² + -3x + 0".
  const term = (k: number, power: string) => !k ? "" : `${k < 0 ? " − " : " + "}${Math.abs(k) === 1 && power ? "" : round(Math.abs(k))}${power}`;
  const tidy = (terms: string) => "y = " + (terms.replace(/^ \+ /, "").replace(/^ − /, "−") || "0");
  const formula = family === "linear" ? tidy(term(a, "x") + term(b, "")) : family === "quadratic" ? tidy(term(a, "x²") + term(b, "x") + term(c, "")) : tidy(term(a, `sin(${round(b)}x)`) + term(c, ""));
  return (
    <div className="tu-model">
      <svg className="tu-pic" viewBox="0 0 720 230" preserveAspectRatio="xMinYMid meet" fill="none" strokeLinecap="round" strokeLinejoin="round" role="img"
        aria-label={`${formula}, for x from ${xMin} to ${xMax}${secant ? `. A line through x = ${secant.x} and x = ${round(secant.x + width)} has slope ${round(slope)}` : ""}`}>
        <path d={`M${axisX} 8V${py(low)}M44 ${py(0)}H704`} stroke="var(--pencil)" strokeWidth="2.2" />
        <text x="704" y="222" textAnchor="end">{xMax}</text><text x="44" y="222">{xMin}</text>
        <text x={axisX + 10} y="20">{formula}</text>
        <polyline points={values.map(point => `${px(point.x).toFixed(1)},${py(point.y).toFixed(1)}`).join(" ")} stroke="var(--pencil)" strokeWidth="3" />
        {secant && <>
          <path d={`M${px(from)} ${py(line(from))}L${px(to)} ${py(line(to))}`} stroke="var(--ink-chalky)" strokeWidth="3" />
          {px(to) < 610 ? <text className="is-chalky" x={px(to) + 10} y={py(line(to)) + 5}>slope {round(slope)}</text>
            : <text className="is-chalky" x={px(to) - 6} y={py(line(to)) + 30} textAnchor="end">slope {round(slope)}</text>}
          {width > 0 && <circle cx={px(secant.x + width)} cy={py(f(secant.x + width))} r="8" fill="#b7a3dd" stroke="var(--pencil)" strokeWidth="2" />}
          <circle cx={px(secant.x)} cy={py(f(secant.x))} r="6.5" fill="#fff" stroke="var(--pencil)" strokeWidth="2.4" />
          <text className="is-point" x={px(secant.x) - 10} y={py(f(secant.x)) - 10} textAnchor="end">x = {secant.x}</text>
        </>}
        {(model.params.labels ?? []).map((label, index) => {
          const x = px(label.x), y = Math.min(py(f(label.x)), 150);
          return <g key={index}><path d={`M${x} ${y + 12}v14`} stroke="var(--ink-chalky)" strokeWidth="2.6" />
            <text className="is-chalky is-label" x={x} y={y + 46} textAnchor={x > 620 ? "end" : x < 100 ? "start" : "middle"}>{label.text}</text></g>;
        })}
      </svg>
      {secant && model.controls.includes("gap") && <div className="tu-slide"><label><span className="tu-lab">gap</span>
        <input type="range" min={0} max={xMax - secant.x} step={(xMax - secant.x) / 100} value={width} disabled={disabled} aria-label="The gap between the two points"
          onChange={event => { const value = Number(event.target.value); setGap(value); onExplore("Set gap to " + round(value)); }} />
        <b>{round(width)}</b><span className="tu-lab">→ slope</span><b>{round(slope)}</b></label></div>}
      {(["a", "b", "c"] as const).filter(key => model.controls.includes(key)).map(key => <div className="tu-slide" key={key}><label><span className="tu-lab">{key}</span>
        <input type="range" min="-100" max="100" step=".1" value={coefficients[key]} disabled={disabled}
          onChange={event => { const value = Number(event.target.value); setCoefficients(old => ({ ...old, [key]: value })); onExplore(`Set ${key} to ${value}`); }} />
        <b>{coefficients[key]}</b></label></div>)}
      {model.controls.includes("reset") && <div className="tu-slide"><button type="button" className="rd-quiet" disabled={disabled}
        onClick={() => { setCoefficients({ a: model.params.a, b: model.params.b, c: model.params.c }); setGap(secant?.gap ?? 0); onExplore("Reset plot"); }}>Reset</button></div>}
    </div>
  );
}

function CodeRunner({ model, onExplore, disabled }: Props<"code_runner">) {
  const [code, setCode] = useState(model.params.code), [output, setOutput] = useState(""), [running, setRunning] = useState(false),
    [ready, setReady] = useState(false), [generation, setGeneration] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null), runId = useRef<string | null>(null), watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { setCode(model.params.code); }, [model.params.code]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !runId.current || event.data?.channel !== "studi-tutor-code" || event.data.runId !== runId.current) return;
      if (!["completed", "failed", "timed_out", "cancelled"].includes(event.data.outcome)) return;
      if (watchdog.current) clearTimeout(watchdog.current);
      runId.current = null;
      setRunning(false);
      const logs = Array.isArray(event.data.logs) ? event.data.logs.slice(0, 50).map((line: unknown) => String(line).slice(0, 2000)).join("\n") : "";
      setOutput([logs, typeof event.data.error === "string" ? event.data.error.slice(0, 2000) : ""].filter(Boolean).join("\n") || "Finished with no output.");
      onExplore("Ran JavaScript: " + event.data.outcome);
    };
    window.addEventListener("message", receive);
    return () => { window.removeEventListener("message", receive); if (watchdog.current) clearTimeout(watchdog.current); };
  }, [onExplore]);
  const run = () => {
    if (!ready || running || disabled) return;
    const id = crypto.randomUUID();
    runId.current = id;
    setRunning(true);
    setOutput("Running…");
    frame.current?.contentWindow?.postMessage({ channel: "studi-tutor-code", runId: id, code: code.slice(0, 12000), timeoutMs: Math.min(1000, model.params.timeoutMs) }, "*");
    watchdog.current = setTimeout(() => {
      runId.current = null;
      setRunning(false);
      setOutput("Stopped: the code exceeded its time limit.");
      setReady(false);
      setGeneration(value => value + 1);
    }, 1500);
  };
  return (
    <div className="tu-model">
      <p className="tu-lab">{model.params.instructions}</p>
      <textarea className="tu-code" aria-label="JavaScript" spellCheck={false} maxLength={12000} value={code} readOnly={disabled || !model.controls.includes("edit")} onChange={event => setCode(event.target.value)} />
      <iframe key={generation} ref={frame} sandbox="allow-scripts" srcDoc={TUTOR_CODE_SANDBOX_HTML} title="Isolated JavaScript runner" hidden onLoad={() => setReady(true)} />
      <div className="tu-slide">
        {model.controls.includes("run") && <button type="button" className="rd-button" disabled={disabled || running || !ready} onClick={run}>{running ? "Running…" : "Run code"}</button>}
        {model.controls.includes("reset") && <button type="button" className="rd-quiet" disabled={disabled || running} onClick={() => { setCode(model.params.code); setOutput(""); onExplore("Reset code"); }}>Reset</button>}
      </div>
      {output && <pre className="tu-output" aria-live="polite">{output}</pre>}
    </div>
  );
}
