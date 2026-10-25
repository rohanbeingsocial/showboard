# Integrate Showboard into your app

[Documentation](README.md) ? [Product overview](../README.md)

[Put boards in your own app](#put-boards-in-your-own-app) ? [Tools your agent gets](#tools-your-agent-gets) ? [API](#api)

## Put boards in your own app

```bash
npm install showboard zod
```

The React parts need React 19. Postgres support (`pg`) comes with the package.

**Server.** The handler takes a fetch `Request` and returns a `Response`, so any Node server can mount it.

```ts
import { createShowboard } from "showboard/server";

const showboard = await createShowboard({
  db: process.env.DATABASE_URL,      // a Postgres URL, a SQLite file, or { pool } with your own pg Pool
  boardsDir: ".showboard/boards",    // keep boards across restarts
});
const handle = showboard.handler({ basePath: "/showboard" });

app.all("/showboard/*", (c) => handle(c.req.raw));            // Hono
// node:http and Express: toNodeListener(handle) from "showboard/server"
```

**Browser.**

```tsx
import { Board, BoardList, ShowboardProvider } from "showboard/react";
import "showboard/styles.css";

<ShowboardProvider url="/showboard" onBoard={() => navigate("/board")}>
  <App />
</ShowboardProvider>;

// On the page that holds the agent's answers:
<Board />        {/* the board shown last */}
<BoardList />    {/* saved boards; click one to open it */}
```

**Your agent.** In your project folder, then start your app and your agent:

```bash
npx showboard init --url http://localhost:3000/showboard --agent claude,codex
```

Your agent's own login covers your own and internal dashboards; putting Showboard in front of your customers needs a model API key instead.

<details>
<summary><b>More examples:</b> a whole board in one call, recipes, your own components, actions and state, rows your server computes</summary>

<br />

**A whole board in one call.** What the agent sends to `draw`. Each part brings its own SQL; the first part becomes a line per channel, the second asks for a pie:

```json
{
  "title": "Orders by channel, {year}",
  "params": { "year": "2026" },
  "items": [
    { "note": "Paid orders only.", "tone": "info" },
    { "row": [
      { "title": "By month",
        "sql": "SELECT substr(ordered_at, 1, 7) AS month, channel, count(*) AS orders FROM orders WHERE status = 'paid' AND substr(ordered_at, 1, 4) = :year GROUP BY 1, 2" },
      { "title": "Share", "show": "pie",
        "sql": "SELECT channel, count(*) AS orders FROM orders WHERE status = 'paid' AND substr(ordered_at, 1, 4) = :year GROUP BY 1" }
    ] }
  ],
  "save_as": { "name": "channel_orders", "about": "Paid orders by channel for one year." }
}
```

**The same board for another year** is now one `recipe` call of a few hundred tokens:

```json
{ "name": "channel_orders", "params": { "year": "2025" } }
```

**Recipes your app ships.** `:year` and `:limit` become real query parameters, never text pasted into the SQL:

```ts
createShowboard({
  db,
  recipes: [{
    name: "top_products",
    about: "A year's best-selling products by paid revenue.",
    title: "Top products of {year}",
    params: { year: { default: "2026" }, limit: { default: 10 } },
    items: [{
      title: "Revenue by product",
      sql: `SELECT p.name AS product, round(sum(i.qty * i.unit_price), 2) AS revenue
            FROM order_items i JOIN orders o ON o.id = i.order_id JOIN products p ON p.id = i.product_id
            WHERE o.status = 'paid' AND substr(o.ordered_at, 1, 4) = :year
            GROUP BY p.name ORDER BY revenue DESC LIMIT :limit`,
      formats: { revenue: "currency" },
    }],
  }],
});
```

**Your own components** next to the built-in ones:

```tsx
import { z } from "zod";
import type { ShowboardComponent } from "showboard/react";

const props = z.object({ sku: z.string().describe("Product SKU, e.g. DSK-AERO") });

export const ProductCard: ShowboardComponent<typeof props> = {
  description: "The shop's product card: name, price and units sold this year.",
  props,
  render: ({ props }) => <ProductTile sku={props.sku} />,   // a component you already have
};

const COMPONENTS = { ProductCard };   // a module constant: a new object redraws every board
<ShowboardProvider url="/showboard" components={COMPONENTS}>…</ShowboardProvider>;
```

**Actions the agent can run, and state it can see:**

```tsx
import { useShowboardAction, useShowboardState } from "showboard/react";

const filterOrdersInput = z.object({ month: z.string().describe("YYYY-MM") });   // outside the component

function ClaudeHooks({ page, setPage, setFilters }) {
  useShowboardState("page", page);   // the agent reads it with get_screen
  useShowboardAction({
    name: "filter_orders",
    description: "Open the Orders page for one month.",
    input: filterOrdersInput,
    run: ({ month }) => {
      setFilters({ month });
      setPage("orders");
    },
  });
  return null;
}
```

The agent runs an action with `ui_act`, and a board can carry an `ActionButton` that runs one.

**Rows your server computes**, offered to the agent by name:

```ts
createShowboard({
  db,
  sources: [{
    name: "stock_levels",
    description: "Units in stock per product, from the warehouse system.",
    input: z.object({ category: z.string().optional() }),
    run: ({ category }) => warehouse.stockLevels(category),   // an array of plain objects
  }],
});
```

</details>

## Tools your agent gets

| Tool | What it does |
| --- | --- |
| `describe_data` | Lists the tables and columns, the app's sources and the recipes |
| `recipe` | Draws a ready-made board for new values, in one call |
| `draw` | Fetches and draws a whole board in one call |
| `query_data` | Runs one read-only SELECT and keeps the rows as a named dataset (with a database) |
| `use_source` | Gets rows your server computes (when your app has sources) |
| `show_board` | The long form: a [json-render](https://github.com/vercel-labs/json-render) layout the agent writes element by element; also reopens a saved board |
| `list_boards` | Lists the saved boards |
| `get_screen` | What the browser shows: the page's state, its actions and its components |
| `ui_act` | Runs one of the page's actions |

Showboard tells the agent to reach for a recipe first, then `draw`. New recipes reach the agent without a restart where it listens for tool-list changes, as Claude Code does; `describe_data` lists them for the rest.

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `createShowboard` | fn | Opens your database or files; returns the tools and the HTTP handler. |
| `toNodeListener`, `serve` | fn | Mount the handler on `node:http` or Express, or serve it on its own. |
| `ShowboardProvider` *(/react)* | component | Connects the page to the handler and holds the board on screen. |
| `Board`, `BoardList` *(/react)* | component | The board shown last, and the saved boards. |
| `useShowboardAction`, `useShowboardState` *(/react)* | hook | Actions the agent can run, and state it can see. |
| `formatValue` *(/react)* | fn | Prints numbers the way boards do, for your own components. |
| `boardToText` *(/text)* | fn | A board as lines of styled text, for a pane of your own. |
| `showboard serve \| mcp \| init \| pane` | CLI | Showboard's own board page, the MCP server, setup for each agent, and the terminal pane. |
| `showboard guide \| doctor` | CLI | Setup steps written for coding agents, and a check of the setup as each agent will meet it. |

The full reference, with every option, prop, tool, flag and the chart-picking rules, is in [docs/reference.md](../docs/reference.md).

