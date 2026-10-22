// Writes a small, deliberately untidy set of spreadsheets for trying Showboard on files:
// a workbook with a title row, Excel dates and a "Grand Total" row, rupee targets typed as
// text with Indian digit grouping, and day/month/year dates in a CSV.
//
//   node examples/spreadsheets/make.mjs
//   node packages/showboard/dist/cli/main.js serve examples/spreadsheets/data --port 4720
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import writeXlsxFile from "write-excel-file/node";

const out = fileURLToPath(new URL("./data/", import.meta.url));
mkdirSync(out, { recursive: true });

let seed = 20261020;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(random() * list.length)];

const products = [
  ["Ergo Chair", "Seating", 14500, 8200],
  ["Mesh Stool", "Seating", 4200, 2100],
  ["Oak Desk", "Desks", 32000, 19000],
  ["Lift Desk", "Desks", 48000, 30500],
  ["Arc Lamp", "Lighting", 3600, 1500],
  ["Strip Light", "Lighting", 1900, 700],
  ["File Cabinet", "Storage", 11000, 7400],
  ["Wall Shelf", "Storage", 2800, 1300],
];
const reps = [
  ["Asha Rao", "South", "14/02/2022"],
  ["Vikram Shah", "West", "03/07/2021"],
  ["Meera Iyer", "South", "21/09/2024"],
  ["Karan Mehta", "North", "11/01/2020"],
  ["Divya Nair", "East", "28/05/2023"],
  ["Rohit Gupta", "North", "17/08/2025"],
];
// How each region is doing against plan: North slips after June, East grows.
const pace = { North: [1.05, 1.0, 1.0, 0.98, 0.95, 0.9, 0.8, 0.75, 0.72, 0.7], South: Array(10).fill(1), West: Array(10).fill(0.97), East: [0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.3] };

const orders = [];
let id = 5001;
for (let month = 0; month < 10; month++) {
  const days = month === 9 ? 19 : new Date(Date.UTC(2026, month + 1, 0)).getUTCDate();
  for (const [rep, region] of reps) {
    const count = Math.round((14 + random() * 8) * pace[region][month] * (days / 30));
    for (let i = 0; i < count; i++) {
      const [name, , price] = pick(products);
      const qty = 1 + Math.floor(random() * (price > 20000 ? 2 : 6));
      const discount = random() < 0.25 ? 0.1 : 0;
      orders.push([id++, new Date(Date.UTC(2026, month, 1 + Math.floor(random() * days))), region, rep, name, qty, price, Math.round(qty * price * (1 - discount))]);
    }
  }
}
orders.sort((a, b) => a[1] - b[1] || a[0] - b[0]);

const cell = (value, extra) => (value === null ? null : { value, ...extra });
const bold = (titles) => titles.map((value) => ({ value, fontWeight: "bold" }));
const total = orders.reduce((sum, o) => sum + o[7], 0);

await writeXlsxFile([
  {
    sheet: "Orders",
    data: [
      [{ value: "Nook Office · order export (Jan 1 – Oct 19, 2026)", fontWeight: "bold" }],
      [],
      bold(["Order #", "Order Date", "Region", "Sales Rep", "Product", "Qty", "List Price (₹)", "Amount (₹)"]),
      ...orders.map((o) => o.map((v, i) => cell(v, i === 1 ? { format: "dd mmm yyyy" } : i >= 6 ? { format: "#,##0" } : undefined))),
      [{ value: "Grand Total", fontWeight: "bold" }, null, null, null, null, null, null, { value: total, format: "#,##0", fontWeight: "bold" }],
    ],
    columns: [{ width: 9 }, { width: 13 }, { width: 9 }, { width: 14 }, { width: 13 }, { width: 6 }, { width: 14 }, { width: 13 }],
  },
  {
    sheet: "Products",
    data: [bold(["Product", "Category", "List Price (₹)", "Unit Cost (₹)"]), ...products.map((p) => p.map((v) => ({ value: v })))],
  },
]).toFile(`${out}Sales 2026.xlsx`);

// Monthly targets per region, typed by hand: "₹4,50,000" text, months as "Jan-2026".
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const base = { North: 1150000, South: 1150000, West: 560000, East: 560000 };
const inr = (n) => `₹${n.toLocaleString("en-IN")}`;
const targetRows = [["Region", "Month", "Target"]];
for (const region of Object.keys(base)) for (let m = 0; m < 12; m++) targetRows.push([region, `01-${months[m]}-2026`, inr(Math.round((base[region] * (1 + m * 0.01)) / 1000) * 1000)]);
writeFileSync(`${out}targets 2026.csv`, `${targetRows.map((r) => r.map((v) => (v.includes(",") ? `"${v}"` : v)).join(",")).join("\n")}\n`);

writeFileSync(`${out}reps.csv`, `${[["Sales Rep", "Region", "Joined"], ...reps].map((r) => r.join(",")).join("\n")}\n`);

// The same data as one workbook, for chat apps that take a single upload (claude.ai). Kept
// out of data/ so Showboard does not read everything twice.
const one = fileURLToPath(new URL("./one-file/", import.meta.url));
mkdirSync(one, { recursive: true });
const text = (rows) => rows.map((r) => r.map((v) => ({ value: v })));
await writeXlsxFile([
  { sheet: "Orders", data: [[{ value: "Nook Office · order export (Jan 1 – Oct 19, 2026)", fontWeight: "bold" }], [], bold(["Order #", "Order Date", "Region", "Sales Rep", "Product", "Qty", "List Price (₹)", "Amount (₹)"]), ...orders.map((o) => o.map((v, i) => cell(v, i === 1 ? { format: "dd mmm yyyy" } : i >= 6 ? { format: "#,##0" } : undefined))), [{ value: "Grand Total", fontWeight: "bold" }, null, null, null, null, null, null, { value: total, format: "#,##0", fontWeight: "bold" }]] },
  { sheet: "Products", data: [bold(["Product", "Category", "List Price (₹)", "Unit Cost (₹)"]), ...products.map((p) => p.map((v) => ({ value: v })))] },
  { sheet: "Targets", data: [bold(targetRows[0]), ...text(targetRows.slice(1))] },
  { sheet: "Reps", data: [bold(["Sales Rep", "Region", "Joined"]), ...text(reps)] },
]).toFile(`${one}Nook Office 2026.xlsx`);

console.log(`wrote ${orders.length} orders, ${products.length} products, ${targetRows.length - 1} targets and ${reps.length} reps to ${out}`);
