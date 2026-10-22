import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
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
}

function useDataInfo(): DataInfo {
  const [state, setState] = useState<DataInfo>({ tables: null, notes: [] });
  useEffect(() => {
    fetch(`${BASE}/tools/describe_data`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
      .then((res) => res.json() as Promise<{ content: string }>)
      .then((res) => {
        const out = JSON.parse(res.content) as { database: { tables: TableSummary[]; notes?: string[] } | null; format?: FormatOptions };
        setState({ tables: out.database?.tables ?? [], notes: out.database?.notes ?? [], format: out.format });
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

function Viewer({ data }: { data: DataInfo }) {
  const { connected } = useShowboard();
  const dark = useDark();
  return (
    <div className={`sv-page${dark ? " sv-dark" : ""}`}>
      <header className="sv-top">
        <span>Showboard</span>
        <span className={`sv-dot${connected ? " sv-on" : ""}`} title={connected ? "Connected" : "Not connected"} />
      </header>
      <main className="sv-main">
        <Board
          className={dark ? "sb-dark" : ""}
          empty={
            <div className="sv-empty">
              <h2>Ask your coding agent about your data</h2>
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
