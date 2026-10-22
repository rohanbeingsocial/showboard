# Benchmark: Showboard vs the Claude app's way

Short version: inside Claude Code, Showboard answers these questions for 2.7× fewer tokens
than writing code and an HTML page does. Against claude.ai itself it used the same share of
a Pro plan's limit (a tie, below).

The same questions about the same spreadsheets (`examples/spreadsheets/data`: an untidy
`Sales 2026.xlsx` with Orders and Products sheets, `targets 2026.csv`, `reps.csv`), asked
with the same model, two ways:

- **app**: how the Claude app (claude.ai) answers when you upload files and ask for a chart.
  Claude reads the files with code, works out the numbers, then writes the charts out as one
  self-contained HTML page (an artifact). Rebuilt in Claude Code with only Bash, Read, Write
  and Glob, so it can be measured.
- **showboard**: Showboard over the same files. Claude writes SQL, Showboard runs it and
  draws the board; the only tools are Showboard's.

Each question starts a fresh `claude -p` session; a follow-up continues it. Tokens and cost
come from Claude Code's own usage report (cost is the API list price, which is what the
tokens would cost on an API key; on Pro or Max they count against your usage limit instead).
Your hooks and plugins are left out (`--setting-sources project`).

```sh
npm run build
node bench/run.mjs                      # every question, both ways, Opus
node bench/run.mjs --model sonnet --reps 3 --only trend,targets
```

Results land in `bench/results/` (a table in `.md`, every turn with its reply and tool calls
in `.json`); each run's folder, with the `board.html` or saved boards, stays in
`bench/.runs/` so you can check the answers are right.

## Results, 21 Oct 2026

Opus 5.5 at medium effort (`claude -p`'s default), the 5 questions in `questions.json` (one with a follow-up), each asked four times
both ways over two runs: 24 turns per way ([first run](results/2026-10-21-04-10-opus.md),
[second run](results/2026-10-21-05-01-opus.md), after the board fixes below).

| Way | Output tokens | Input tokens (new) | Input tokens (cached) | Cost (list price) | Time |
|---|---|---|---|---|---|
| app | 128,929 | 231,443 | 1,703,931 | $4.77 | 24.3 min |
| showboard | 36,659 | 99,200 | 1,258,099 | $1.78 | 7.5 min |
| | **3.5× fewer** | **2.3× fewer** | 1.4× fewer | **2.7× cheaper** | **3.2× faster** |

Showboard was cheaper on all 24 turns, by 1.6× to 4.4× (the lowest was the first call after
its tool descriptions changed, when nothing was cached yet). The two runs agree: 2.7× and
2.65× cheaper. Both ways gave the same figures on every question; one app run counted
October's target pro rata where the others stopped at September.

Where the app way spends its tokens: it writes the analysis as Python, prints and checks the
results over several turns, then writes the whole page, chart code included. Showboard's
model writes SQL and a short layout, and the server does the rest.

The first run's boards showed rupee amounts with a $ sign, raw column names as table headings
and a fraction axis (0.5 to 1.5) for attainment. Those are fixed in the board itself, at no
token cost: amounts print in the spreadsheets' own currency, headings are readable, and
shares and attainment print as percents.

What this does not show:

- The app way's pages were more designed: headline cards and a chart per region, each made
  to measure. Showboard's boards are plainer and consistent.
- **It is not a comparison with claude.ai.** The app way here is a stand-in run inside Claude
  Code, and measured against claude.ai itself (below) Showboard used the same share of the
  plan, not less.
- Two runs (four asks per question) on one dataset. Run your own with `--reps` and your files.

## Against claude.ai itself: a tie (21 Oct 2026)

Pro plan, Opus 5.5 at medium effort, `Nook Office 2026.xlsx` (the same data as one
workbook), the five questions and the follow-up, read off the five-hour "current session"
meter that claude.ai and Claude Code share:

| Way | Meter | Used |
|---|---|---|
| claude.ai, file attached, by hand | 25% → 30% | 5 points |
| Showboard in Claude Code (`bench/usage.mjs`, 5 boards drawn) | 5% → 10% | 5 points |

The meter shows whole percents, so each side is somewhere between 4 and 6 points: no
difference that this can measure. Most of Claude Code's share is its own fixed prompt and
tool list, which it sends with every turn: a run whose tool calls were all refused (so it
drew nothing) still cost 4 points for the same six turns. claude.ai turns are leaner than the
stand-in above, which is why the 2.7× does not carry over.

`node bench/usage.mjs --dir <folder>` repeats the Showboard side: it reads the meter from
Claude Code's own stream on every turn. Nothing else may use the account while it runs.

## Try it yourself on claude.ai

claude.ai shows no token counts, but Settings → Usage shows how much of your plan's
current limit you have used, and Claude Code shares that limit on Pro and Max. So:

1. Start when you have not used Claude for a while, or note the Usage figure first.
2. claude.ai → New chat, pick the same model and effort you will use in Claude Code
   (start it with `claude --effort high`, for example). Attach
   `examples/spreadsheets/one-file/Nook Office 2026.xlsx`: the same data as one workbook
   (Orders, Products, Targets and Reps sheets), made by `make.mjs`.
3. Ask the questions in `bench/questions.json`, one per new chat (a follow-up in the same
   chat). Wait for each answer and its chart to finish.
4. Refresh Settings → Usage and note how far it moved.
5. Then, in `examples/spreadsheets/one-file`, run `npx showboard init .` (before it is on
   npm: `node <this repo>/packages/showboard/dist/cli/main.js init .`), start `claude`,
   open the board page it names and ask the same questions, one `/clear` between them.
   Read Settings → Usage again (or `/usage` in Claude Code) and compare how far each side
   moved it.

Usage moves in whole percent, so ask all the questions before reading it, and run each
side once or twice more if the numbers are close.
