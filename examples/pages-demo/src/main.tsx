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
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
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

function Stat({ value, cost, label, lead }: { value: string; cost: number; label: string; lead?: boolean }) {
  return (
    <div className={`pd-stat${lead ? " pd-lead" : ""}`}>
      <span className="pd-stat-value">
        {value} <span className="pd-stat-cost">${cost.toFixed(2)}</span>
      </span>
      <span className="pd-stat-label">{label}</span>
    </div>
  );
}

/** All five questions, one after another. */
function total(mode: "showboard" | "alone") {
  const seconds = ANSWERS.reduce((sum, a) => sum + a[mode].seconds, 0);
  const cost = ANSWERS.reduce((sum, a) => sum + a[mode].cost, 0);
  return { minutes: (seconds / 60).toFixed(1), cost };
}

function time(took: Took): string {
  return `${took.seconds} s · $${took.cost.toFixed(2)}`;
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
    <div className="pd-cmd">
      {/* Each word kept whole, so a narrow screen breaks the line at a space, never inside --marketplace. */}
      <code>
        {INSTALL.split(" ").map((word, i) => (
          <span key={i}>
            {i ? " " : ""}
            <span className="pd-word">{word}</span>
          </span>
        ))}
      </code>
      <button type="button" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function App() {
  const dark = useDark();
  const [answer, setAnswer] = useState(fromHash);
  const questionsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onHash = () => setAnswer(fromHash());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    // On a phone the questions are a row you swipe: keep the chosen one in view. Only the
    // row scrolls, never the page; on a desktop the row doesn't overflow, so this is a no-op.
    const row = questionsRef.current;
    const active = row?.querySelector("[aria-current]");
    if (!row || !active) return;
    const inset = parseFloat(getComputedStyle(row).scrollPaddingLeft) || 0;
    row.scrollLeft += active.getBoundingClientRect().left - row.getBoundingClientRect().left - inset;
  }, [answer]);

  const withIt = total("showboard");
  const alone = total("alone");

  return (
    <div className={`pd-page${dark ? " pd-dark" : ""}`}>
      <header className="pd-wrap pd-nav">
        <a className="pd-brand" href={REPO} aria-label="Showboard on GitHub">
          <img src={icon} alt="" width={26} height={26} />
          <span>
            show<span className="pd-orange">board</span>
          </span>
        </a>
        <a className="pd-link" href={REPO}>
          GitHub
        </a>
      </header>

      <section className="pd-wrap pd-hero">
        <h1>
          <span>Ask in your terminal.</span>
          <span className="pd-dim">Get a dashboard on your screen.</span>
        </h1>
        <div className="pd-hero-row">
          <p>Point Claude Code at a folder of messy spreadsheets or a database. It answers with a dashboard, and every number shows where it came from.</p>
          <div className="pd-get">
            <Install />
            <p className="pd-fine">
              Paste it into Claude Code. It reads your data and never changes it. Using Codex, Cursor or Gemini CLI? See{" "}
              <a href={`${REPO}#works-with-your-agent`}>the setup</a>.
            </p>
          </div>
        </div>
      </section>

      <main className="pd-wrap pd-demo">
        <div className="pd-demo-head">
          <div>
            <h2>Five real questions, three messy spreadsheets</h2>
            <p className="pd-files">
              {FILES.map((f, i) => (
                <span key={f}>
                  <code>{f}</code>
                  {i < FILES.length - 2 ? ", " : i === FILES.length - 2 ? " and " : ""}
                </span>
              ))}
            </p>
          </div>
          <div className="pd-stats">
            <Stat value={`${withIt.minutes} min`} cost={withIt.cost} label="all five, with Showboard" lead />
            <Stat value={`${alone.minutes} min`} cost={alone.cost} label="all five, Claude Code alone" />
          </div>
        </div>

        <div className="pd-demo-body">
          <nav className="pd-qs" aria-label="Questions" ref={questionsRef}>
            {ANSWERS.map((a) => (
              <a key={a.id} href={`#${a.id}`} className="pd-q" aria-current={a.id === answer.id ? "true" : undefined}>
                {a.ask}
                {a.then ? <span className="pd-then">then: {a.then}</span> : null}
                <span className="pd-time">
                  <span className="pd-time-with">{time(a.showboard)}</span> vs {time(a.alone)} alone
                </span>
              </a>
            ))}
          </nav>
          <div className="pd-board" key={answer.id}>
            <ShowboardContext.Provider value={CONTEXT}>
              <Board board={answer.board} className={dark ? "sb-dark" : ""} />
            </ShowboardContext.Provider>
          </div>
        </div>
      </main>

      <footer className="pd-wrap">
        <div className="pd-foot">
          <p>
            Claude Opus 5.5 in Claude Code, with Showboard and on its own. Times and costs are the average of {answer.showboard.tries} tries, at API
            list price.
          </p>
          <a className="pd-link" href={REPO}>
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
