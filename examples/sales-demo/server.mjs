// The demo shop's server: its own small API, Showboard mounted at /showboard, and the
// React app (through Vite). One process, one port: http://localhost:4710.
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createShowboard, toNodeListener } from "showboard/server";
import { createServer as createVite } from "vite";

const PORT = Number(process.env.PORT ?? 4710);
const DB_FILE = fileURLToPath(new URL("./data/shop.sqlite", import.meta.url));
if (!existsSync(DB_FILE)) execFileSync(process.execPath, [fileURLToPath(new URL("./scripts/seed.mjs", import.meta.url))], { stdio: "inherit" });

// Boards people ask for often, each drawn in one call. Claude adds its own with draw's save_as
// (kept in .showboard/recipes).
const PAID = "FROM order_items i JOIN orders o ON o.id = i.order_id JOIN products p ON p.id = i.product_id WHERE o.status = 'paid'";
const recipes = [
  {
    name: "top_products",
    about: "A year's best-selling products by paid revenue.",
    title: "Top products of {year}",
    params: { year: { default: "2026" }, limit: { default: 10 } },
    items: [
      {
        title: "Revenue by product",
        sql: `SELECT p.name AS product, round(sum(i.qty * i.unit_price), 2) AS revenue ${PAID} AND substr(o.ordered_at, 1, 4) = :year GROUP BY p.name ORDER BY revenue DESC LIMIT :limit`,
        formats: { revenue: "currency" },
      },
    ],
  },
  {
    name: "monthly_revenue",
    about: "Paid revenue per month, a line per year.",
    title: "Revenue by month",
    items: [
      {
        title: "Revenue per month",
        sql: `SELECT substr(o.ordered_at, 6, 2) AS month, substr(o.ordered_at, 1, 4) AS year, round(sum(i.qty * i.unit_price), 2) AS revenue ${PAID} GROUP BY 1, 2 ORDER BY 1, 2`,
        show: "line",
        series: "year",
        formats: { revenue: "currency" },
      },
    ],
  },
];

// The same format the app's pages use, so a terminal pane prints dollars the same way.
const showboard = await createShowboard({ db: DB_FILE, recipes, format: { locale: "en-US", currency: "USD" }, boardsDir: fileURLToPath(new URL("./.showboard/boards", import.meta.url)) });
const showboardListener = toNodeListener(showboard.handler({ basePath: "/showboard" }));

// The shop's own API, which its pages use. Claude reads the same database through Showboard.
const db = new DatabaseSync(DB_FILE, { readOnly: true });
const api = {
  "/api/products": () =>
    db.prepare(`SELECT p.sku, p.name, p.category, p.price, p.launched,
                       (SELECT coalesce(sum(i.qty), 0) FROM order_items i JOIN orders o ON o.id = i.order_id
                        WHERE i.product_id = p.id AND o.status = 'paid' AND o.ordered_at >= '2026-01-01') AS units_2026
                FROM products p ORDER BY p.category, p.name`).all(),
  "/api/orders": (q) => {
    const filters = [
      ["month", "substr(o.ordered_at, 1, 7) = ?"],
      ["sku", "o.id IN (SELECT i.order_id FROM order_items i JOIN products p ON p.id = i.product_id WHERE p.sku = ?)"],
      ["status", "o.status = ?"],
    ].filter(([key]) => q.get(key));
    const where = ["1 = 1", ...filters.map(([, sql]) => sql)];
    const args = filters.map(([key]) => q.get(key));
    return db.prepare(`SELECT o.id, o.ordered_at, c.name AS customer, c.city, o.channel, o.status,
                              (SELECT sum(qty * unit_price) FROM order_items WHERE order_id = o.id) AS total
                       FROM orders o JOIN customers c ON c.id = o.customer_id
                       WHERE ${where.join(" AND ")} ORDER BY o.ordered_at DESC, o.id DESC LIMIT 100`).all(...args);
  },
};

const vite = await createVite({ root: fileURLToPath(new URL(".", import.meta.url)), server: { middlewareMode: true, hmr: { port: PORT + 1 } }, appType: "spa" });

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname.startsWith("/showboard/")) {
    showboardListener(req, res).catch((err) => {
      console.error(err);
      res.end();
    });
    return;
  }
  const route = api[url.pathname];
  if (route) {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(route(url.searchParams)));
    return;
  }
  vite.middlewares(req, res);
}).listen(PORT, "127.0.0.1", () => console.log(`sales demo: http://localhost:${PORT}  (Showboard at /showboard)`));
