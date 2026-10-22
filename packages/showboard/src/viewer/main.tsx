import { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { inline } from "../react/components/basic.js";
import { Board, BoardList, ShowboardProvider, useShowboard } from "../react/index.js";
import type { FormatOptions } from "../spec/format.js";
import "../react/styles.css";
import "./viewer.css";

// Showboard's own page, served by `showboard serve` for people without an app: Claude's
// latest board, the saved ones, and the tables it can read (so a spreadsheet import can be
// checked at a glance).

interface TableSummary {
  table: string;
  from?: string;
  rows?: number;
  notes?: string[];
}

const BASE = new URL(".", location.href).href.replace(/\/$/, "");
const DARK = "(prefers-color-scheme: dark)";

function useDark(): boolean {
  const [dark, setDark] = useState(() => matchMedia(DARK).matches);
  useEffect(() => {
    const media = matchMedia(DARK);
    const update = () => setDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return dark;
}

interface DataInfo {
  tables: TableSummary[] | null;
  notes: string[];
  /** The data's currency and locale, e.g. rupees for spreadsheets written in ₹. */
  format?: FormatOptions;
  /** Whether the server has a model key for the question box (see server/ask.ts). */
  ask?: boolean;
}

function useDataInfo(): DataInfo {
  const [state, setState] = useState<DataInfo>({ tables: null, notes: [] });
  useEffect(() => {
    const health = fetch(`${BASE}/health`).then((res) => res.json() as Promise<{ ask?: boolean }>);
    fetch(`${BASE}/tools/describe_data`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
      .then((res) => res.json() as Promise<{ content: string }>)
      .then(async (res) => {
        const out = JSON.parse(res.content) as { database: { tables: TableSummary[]; notes?: string[] } | null; format?: FormatOptions };
        const ask = (await health.catch(() => ({ ask: false }))).ask === true;
        setState({ tables: out.database?.tables ?? [], notes: out.database?.notes ?? [], format: out.format, ask });
      })
      .catch((err: Error) => setState({ tables: [], notes: [`Tables could not be listed: ${err.message}`] }));
  }, []);
  return state;
}

function Tables({ tables, notes }: { tables: TableSummary[] | null; notes: string[] }) {
  if (!tables) return null;
  return (
    <div className="sv-tables">
      {tables.map((t) => (
        <div key={t.table} className="sv-table" title={t.notes?.join("\n")}>
          <code>{t.table}</code>
          <span className="sb-muted">
            {t.from ? `${t.from} · ` : ""}
            {t.rows?.toLocaleString() ?? "?"} rows
          </span>
        </div>
      ))}
      {notes.map((n) => (
        <p key={n} className="sb-error">
          {n}
        </p>
      ))}
    </div>
  );
}

/** A question for the model behind the server's key; its board arrives on the stream like any other. */
function Ask() {
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<{ busy: boolean; answer?: string; error?: string }>({ busy: false });
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!question.trim() || state.busy) return;
    setState({ busy: true });
    try {
      const res = await fetch(`${BASE}/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question }) });
      const out = (await res.json()) as { answer?: string; error?: string };
      setState({ busy: false, answer: out.answer, error: out.error });
    } catch (err) {
      setState({ busy: false, error: (err as Error).message });
    }
  }
  return (
    <form className="sv-ask" onSubmit={submit}>
      <div className="sv-ask-row">
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about your data, e.g. Which region sold the most?" aria-label="Question" maxLength={2000} />
        <button type="submit" disabled={state.busy || !question.trim()}>
          {state.busy ? "Drawing…" : "Ask"}
        </button>
      </div>
      {state.answer ? <p className="sv-answer">{inline(state.answer)}</p> : null}
      {state.error ? <p className="sb-error">{state.error}</p> : null}
    </form>
  );
}

function Viewer({ data }: { data: DataInfo }) {
  const { connected } = useShowboard();
  const dark = useDark();
  return (
    <div className={`sv-page${dark ? " sv-dark" : ""}`}>
      <header className="sv-top">
        <span>Showboard</span>
        <span className={`sv-dot${connected ? " sv-on" : ""}`} title={connected ? "Connected" : "Not connected"} />
      </header>
      {data.ask ? <Ask /> : null}
      <main className="sv-main">
        <Board
          className={dark ? "sb-dark" : ""}
          empty={
            <div className="sv-empty">
              <h2>{data.ask ? "Ask a question above, or ask your coding agent" : "Ask your coding agent about your data"}</h2>
              <p className="sb-muted">Its boards appear here.</p>
            </div>
          }
        />
        <aside className="sv-side">
          <h3>Boards</h3>
          <BoardList />
          <h3>Data</h3>
          <Tables tables={data.tables} notes={data.notes} />
        </aside>
      </main>
    </div>
  );
}

function App() {
  const data = useDataInfo();
  // Boards print amounts in the data's own currency, so they wait for describe_data.
  if (!data.tables) return null;
  return (
    <ShowboardProvider url={BASE} format={data.format}>
      <Viewer data={data} />
    </ShowboardProvider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
