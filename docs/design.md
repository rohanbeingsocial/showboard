# Design rules

How a Showboard board should look and move, and why. The renderer (`showboard/react`,
`styles.css`) enforces the first three parts. The last part, composition, is up to the
agent drawing the board: the `draw` tool carries a short version of it.

## 1. Principles

- **Hierarchy first.** A reader should see the answer, then the evidence, then the detail,
  without reading everything. Size, weight and space do that work, not colour or decoration.
- **One scale for everything.** Every space, text size and duration comes from the scales
  below. A one-off value is a bug.
- **Air over lines.** Groups are told apart by space. Borders are hairlines, grid lines are
  quieter than borders, and nothing is boxed twice.
- **Numbers line up.** Figures use tabular digits and sit right-aligned in tables, so columns
  can be compared at a glance.
- **Motion explains, then gets out of the way.** A board builds itself once, in reading
  order. After that, motion only confirms what the pointer is doing.

## 2. Tokens

All are CSS variables on `.sb-board`. Override them to theme a board (see
[Styling](reference.md#styling)).

### Space: 4 · 8 · 12 · 16 · 24 · 32 · 48

| Token | px | Used for |
| --- | --- | --- |
| `--sb-space-1` | 4 | Title to subtitle, legend rows |
| `--sb-space-2` | 8 | Inside tooltips and table cells, label to value |
| `--sb-space-3` | 12 | Legend to chart, small gaps |
| `--sb-space-4` | 16 | Between cards, card title to body, metric padding |
| `--sb-space-5` | 24 | Card padding, between blocks of the board |
| `--sb-space-6` | 32 | Reserved for page-level gaps |
| `--sb-space-7` | 48 | Reserved for page-level gaps |

Rhythm: 16px between cards in a group, 24px between the board's blocks, and 24px more
above each stacked section, so a section reads as its own group (40px from the block above).

### Type: 12 · 13 · 14 · 18 · 28

| Token | px | Weight | Used for |
| --- | --- | --- | --- |
| `--sb-text-xs` | 12 | 400–500 | Dates, captions, legends, table headers, tooltips |
| `--sb-text-sm` | 13 | 400–500 | Table cells, metric labels, section subtitles |
| `--sb-text-md` | 14 | 400 / 600 | Body, notes, card titles (600) |
| `--sb-text-lg` | 18 | 650 | Section titles |
| `--sb-text-xl` | 28 | 650–700 | Board title (700), headline numbers (650) |

Axis labels are 11px, below the scale on purpose: they are furniture, not reading text.
Large text is tightened (letter-spacing −0.01 to −0.025em). Titles use `text-wrap: balance`.
Notes and subtitles stop at 80 characters a line.

### Colour

- Greys do the work: `--sb-fg` for content, `--sb-muted` for labels and meta.
- `--sb-border` (cards) is stronger than `--sb-grid` (grid and row lines), which is stronger
  than `--sb-hover` (hover fills).
- One accent (`--sb-accent`) for things you can press.
- Good, warn, bad and info appear only where they mean something: a note's tone.
- Series colours `--sb-c1`…`--sb-c8` in that order, picked to stay apart for colour-blind
  readers. "Other" in a donut is always muted.

### Shape

`--sb-radius` 14px for cards and notes, `--sb-radius-sm` 8px for tooltips, buttons and
legend rows. Bars are rounded only at their value end, square where they leave the axis.

### Motion

| Token | Value | Used for |
| --- | --- | --- |
| `--sb-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | Everything that arrives: fast start, soft landing |
| `--sb-ease-draw` | `cubic-bezier(0.45, 0, 0.2, 1)` | Lines and the donut sweep, which travel a distance |
| `--sb-fast` | 160ms | Hover and press feedback |
| `--sb-enter` | 560ms | A block rising into place |
| `--sb-draw` | 900ms | Bars growing, lines drawing |
| `--sb-stagger` | 55ms | Delay between one block and the next |

## 3. What the renderer does

**Layout.**
- Cards in a row stretch to the same height. A donut centres itself in the space it gets.
- Grids of 3 or 4 fall to 2 columns under 960px of board width, and everything goes to
  1 column under 640px. The board measures its own width, not the window's.

**Cards.**
- Every chart, table and metric sits in a card with a 24px inset.
- A metric is a label, a 28px number and an optional caption.
- A note is a card with a tone bar on its left; toned notes get a faint wash of their colour.

**Tables.** Headers are small and muted. Numbers are right-aligned with tabular digits, rows
are separated by grid lines, and the row under the pointer is highlighted. Column names
like `share_of_risk` are shown as "Share of risk". The same goes for chart legends and
tooltips.

**Entrance.** When a board opens, it builds itself in reading order:

1. The title, then each section heading, card and note rises 10px into place and fades in,
   55ms after the one before (the order is capped, so a long board starts within 0.8s).
2. Inside each card, 160ms after it lands:
   - Bars grow from the baseline one after another (30ms apart), and their value labels fade in after.
   - Lines draw from left to right, one series after the next, then the end dots pop in.
     A single line's area fades in underneath.
   - The donut sweeps clockwise from 12 o'clock.
   - Legend rows and table rows fade in, top to bottom.
   - Headline numbers and the donut's total count up from zero in their own precision, so
     the digits don't flicker.
3. Everything on the first screen has landed within about 2 seconds.

**Hover.**
- Other bars and slices dim, and the hovered slice lifts 3%.
- Line charts show a dashed guide and move their dots smoothly to the hovered point.
- Tooltips fade up in 140ms and glide to follow the pointer.
- Buttons press in to 97%.

**Reduced motion.** When the system asks for reduced motion, there is no entrance, no
count-up and no transitions. Lines and the donut are simply drawn.

What it never does: loop, bounce, shake, autoplay after the entrance, or animate on data it
is only re-reading.

## 4. Composition (for the agent drawing the board)

These are the rules the `draw` tool gives agents. They decide most of how good a board looks.

1. **The title states the finding**, not the topic. "IT is a quarter of the money but a
   third of the risk", rather than "Holdings by sector".
2. **Open with the answer.** Up to four headline numbers in one row, then one short note if
   the takeaway needs words, then the charts that show why. Detail tables go last.
3. **One idea per chart**, titled by what it shows.
   - Bars: four series at most. Lines: five at most.
   - Horizontal bars for more than eight categories or long names.
   - A donut only for the parts of one whole, seven slices at most.
4. **Rows of two.** Metrics can go up to four across. Put a chart beside the table that
   explains it, rather than two tables side by side.
5. **Sections only for two or more groups.** Give a section a subtitle only when it adds a fact.
6. **Small tables.** Seven columns and fifteen rows at most, unless the user asked for the
   full list. Name the columns as they should read, or in snake_case (shown humanised).
7. **Notes are short.** Five bullets at most, each leading with its point in **bold**. Use
   the good, warn or bad tone only when the news is.
8. **Numbers come from the data.** A note quotes only figures that were read from a dataset.
