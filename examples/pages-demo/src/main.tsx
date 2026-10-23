import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
// The page draws saved boards with no Showboard server behind it, so Board gets a fixed
// context instead of a ShowboardProvider (which would open an event stream to a server).
// The context isn't in the package's public API, so Board and it both come from the source:
// one copy of the module, or Board would not see the value.
import { Board } from "../../../packages/showboard/src/react/Board.js";
import { ShowboardContext, type ShowboardContextValue } from "../../../packages/showboard/src/react/context.js";
import type { Board as BoardData } from "../../../packages/showboard/src/spec/types.js";
import icon from "../../../assets/showboard-icon.svg";
import "../../../packages/showboard/src/react/styles.css";
import "./demo.css";
import answers from "./answers.json";

// Real answers from the benchmark (bench/), copied by scripts/collect.mjs.
/** What an answer took, on average over the benchmark's tries. */
interface Took {
  seconds: number;
  cost: number;
  tries: number;
}

interface Answer {
  id: string;
  ask: string;
  then?: string;
  showboard: Took;
  alone: Took;
  board: BoardData;
}

// TypeScript types the JSON by its literal shape, which can't line up with a board's spec.
const ANSWERS = answers as unknown as Answer[];
const REPO = "https://github.com/rohanbeingsocial/showboard";
const INSTALL = "/plugin install showboard --marketplace rohanbeingsocial/showboard";
const FILES = ["Sales 2026.xlsx", "reps.csv", "targets 2026.csv"];
const DARK = "(prefers-color-scheme: dark)";

const noServer = () => Promise.reject(new Error("This demo has no Showboard server."));
const CONTEXT: ShowboardContextValue = {
  board: null,
  connected: true,
  openBoard: noServer,
  runAction: noServer,
  registerAction: () => () => {},
  publish() {},
  unpublish() {},
  components: {},
  // The sample spreadsheets are in rupees.
  format: { locale: "en-IN", currency: "INR" },
  url: "",
};

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

/** The answer a link like #targets points at, so a post can link straight to one board. */
function fromHash(): Answer {
  return ANSWERS.find((a) => `#${a.id}` === location.hash) ?? ANSWERS[0];
}

function money(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function Install() {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(INSTALL).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  }
  return (
    <div className="pd-install">
      <code>{INSTALL}</code>
      <button type="button" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function App() {
  const dark = useDark();
  const [answer, setAnswer] = useState(fromHash);
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onHash = () => {
      setAnswer(fromHash());
      // On a phone the questions sit above the board: bring the new board into view.
      const top = boardRef.current?.getBoundingClientRect().top ?? 0;
      if (top > innerHeight * 0.6) boardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div className={`pd-page${dark ? " pd-dark" : ""}`}>
      <header className="pd-top">
        <a className="pd-brand" href={REPO}>
          <img src={icon} alt="" width={24} height={24} />
          Showboard
        </a>
        <nav className="pd-links">
          <a href={REPO}>GitHub</a>
          <a className="pd-cta" href={`${REPO}#quick-start`}>
            Get started
          </a>
        </nav>
      </header>

      <section className="pd-intro">
        <h1>Ask in your terminal. Get a dashboard on your screen.</h1>
        <p>
          These are real answers, not mock-ups. Claude Code was given three deliberately messy spreadsheets from a small furniture business and asked five
          questions. Each board below is exactly what it drew. Turn on <b>Show sources</b> to see where every number comes from.
        </p>
        <ul className="pd-files" aria-label="The spreadsheets">
          {FILES.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </section>

      <main className="pd-main">
        <nav className="pd-questions" aria-label="Questions">
          {ANSWERS.map((a) => (
            <a key={a.id} href={`#${a.id}`} className="pd-question" aria-current={a.id === answer.id ? "true" : undefined}>
              <span>“{a.ask}”</span>
              {a.then ? <span className="pd-then">Then: “{a.then}”</span> : null}
            </a>
          ))}
          <p className="pd-note">
            Claude Code with Claude Opus 5.5. Times and costs are the average of {answer.showboard.tries} tries each way, at API list price.
          </p>
        </nav>

        <div className="pd-answer" ref={boardRef}>
          <p className="pd-stats">
            <span className="pd-fast">
              Drawn in {answer.showboard.seconds} seconds for {money(answer.showboard.cost)}.
            </span>{" "}
            Claude Code on its own took {answer.alone.seconds} seconds and {money(answer.alone.cost)} to write a web page of charts.
          </p>
          <ShowboardContext.Provider value={CONTEXT}>
            <Board board={answer.board} className={dark ? "sb-dark" : ""} />
          </ShowboardContext.Provider>
        </div>
      </main>

      <footer className="pd-try">
        <h2>Try it on your own spreadsheets</h2>
        <p>At the prompt of a Claude Code session:</p>
        <Install />
        <p className="pd-muted">
          Point it at a folder of Excel or CSV files, or a database, and ask a question. It reads your data and never changes it. Codex, Cursor, Gemini CLI and
          other agents work too: see <a href={`${REPO}#works-with-your-agent`}>the setup</a>.
        </p>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
