// Builds data/shop.sqlite: a small online furniture shop, Jan 2025 to mid-Oct 2026.
// Deterministic (seeded random), so every run makes the same shop.
import { mkdirSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const FILE = fileURLToPath(new URL("../data/shop.sqlite", import.meta.url));
const START = Date.UTC(2025, 0, 1);
const END = Date.UTC(2026, 9, 19);
const DAY = 86_400_000;

let seed = 20261020;
function random() {
  // mulberry32
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (items) => items[Math.floor(random() * items.length)];

// weight: relative popularity; trend: yearly growth of demand; from: launch date.
const PRODUCTS = [
  ["DSK-AERO", "Aero Standing Desk", "Desks", 649, 380, 3, 0.9, "2025-01-01"],
  ["DSK-OAK", "Oak Writing Desk", "Desks", 429, 230, 3, -0.35, "2025-01-01"],
  ["DSK-MINI", "Mini Wall Desk", "Desks", 189, 95, 2, 0.2, "2025-01-01"],
  ["CHR-ERGO", "Ergo Mesh Chair", "Chairs", 389, 210, 5, 0.3, "2025-01-01"],
  ["CHR-LOFT", "Loft Lounge Chair", "Chairs", 529, 300, 2, 0.1, "2025-01-01"],
  ["CHR-STOOL", "Walnut Stool", "Chairs", 119, 55, 3, 0, "2025-01-01"],
  ["CHR-KIDS", "Kids Study Chair", "Chairs", 99, 48, 2, 0.5, "2025-06-01"],
  ["LMP-ARC", "Arc Floor Lamp", "Lighting", 159, 70, 4, 0.05, "2025-01-01"],
  ["LMP-DESK", "LED Desk Lamp", "Lighting", 59, 22, 8, 0.15, "2025-01-01"],
  ["LMP-GLOBE", "Glass Globe Pendant", "Lighting", 139, 60, 2, -0.2, "2025-01-01"],
  ["LMP-SMART", "Smart Light Strip", "Lighting", 45, 16, 6, 1.4, "2025-09-01"],
  ["STO-CUBE", "Cube Shelf 3x3", "Storage", 129, 58, 5, 0, "2025-01-01"],
  ["STO-DRAW", "Rolling Drawer Unit", "Storage", 149, 70, 3, 0.25, "2025-01-01"],
  ["STO-WALL", "Floating Wall Shelf", "Storage", 49, 18, 6, 0.1, "2025-01-01"],
  ["STO-CAB", "Oak Cabinet", "Storage", 559, 320, 1, -0.1, "2025-01-01"],
  ["ACC-CABLE", "Cable Organizer Kit", "Accessories", 19, 5, 14, 0.35, "2025-01-01"],
  ["ACC-MAT", "Felt Desk Mat", "Accessories", 29, 9, 10, 0.2, "2025-01-01"],
  ["ACC-ARM", "Monitor Arm", "Accessories", 89, 38, 6, 0.6, "2025-01-01"],
  ["ACC-FOOT", "Footrest", "Accessories", 39, 14, 4, 0, "2025-01-01"],
  ["ACC-PLANT", "Desk Planter", "Accessories", 25, 8, 5, -0.3, "2025-01-01"],
];
const CITIES = ["Austin", "Berlin", "London", "Toronto", "Sydney", "Pune", "Singapore", "Amsterdam", "Seattle", "Dublin"];
const FIRST = ["Aarav", "Diya", "Kabir", "Meera", "Rohan", "Isha", "Arjun", "Sara", "Vikram", "Ananya", "Nikhil", "Priya", "Dev", "Tara", "Neel", "Zoya"];
const LAST = ["Shah", "Iyer", "Patel", "Rao", "Khan", "Menon", "Gupta", "Das", "Nair", "Joshi", "Kapoor", "Bose"];
const CHANNELS = [["web", 6], ["store", 3], ["marketplace", 2]];

/** Demand multiplier for a date: November-December rush, a summer dip, weekends busier. */
function season(ts) {
  const d = new Date(ts);
  const month = d.getUTCMonth();
  const monthly = [0.9, 0.85, 0.95, 1, 1, 0.85, 0.8, 0.9, 1.05, 1.1, 1.45, 1.6][month];
  return monthly * ([0, 6].includes(d.getUTCDay()) ? 1.25 : 1);
}

mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
rmSync(FILE, { force: true });
const db = new DatabaseSync(FILE);
db.exec(`
  CREATE TABLE products (id INTEGER PRIMARY KEY, sku TEXT UNIQUE, name TEXT, category TEXT, price REAL, cost REAL, launched TEXT);
  CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, city TEXT, joined TEXT);
  CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), ordered_at TEXT, channel TEXT, status TEXT);
  CREATE TABLE order_items (order_id INTEGER REFERENCES orders(id), product_id INTEGER REFERENCES products(id), qty INTEGER, unit_price REAL);
  CREATE INDEX orders_date ON orders(ordered_at);
  CREATE INDEX items_order ON order_items(order_id);
`);

db.exec("BEGIN");
const insertProduct = db.prepare("INSERT INTO products VALUES (?, ?, ?, ?, ?, ?, ?)");
PRODUCTS.forEach(([sku, name, category, price, cost, , , launched], i) => insertProduct.run(i + 1, sku, name, category, price, cost, launched));

const insertCustomer = db.prepare("INSERT INTO customers VALUES (?, ?, ?, ?)");
const customers = 1400;
for (let id = 1; id <= customers; id++) {
  const joined = new Date(START + Math.floor(random() * (END - START))).toISOString().slice(0, 10);
  insertCustomer.run(id, `${pick(FIRST)} ${pick(LAST)}`, pick(CITIES), joined);
}

const insertOrder = db.prepare("INSERT INTO orders VALUES (?, ?, ?, ?, ?)");
const insertItem = db.prepare("INSERT INTO order_items VALUES (?, ?, ?, ?)");
const channelTotal = CHANNELS.reduce((t, [, w]) => t + w, 0);
let orderId = 0;
for (let ts = START; ts <= END; ts += DAY) {
  const years = (ts - START) / (365 * DAY);
  const date = new Date(ts).toISOString().slice(0, 10);
  const live = PRODUCTS.map((p, i) => ({ i, weight: date >= p[7] ? p[5] * Math.max(0.15, 1 + p[6] * years) : 0 }));
  const liveTotal = live.reduce((t, p) => t + p.weight, 0);
  const count = Math.round((22 + 9 * years) * season(ts) * (0.8 + random() * 0.4));
  for (let n = 0; n < count; n++) {
    orderId++;
    let roll = random() * channelTotal;
    const channel = CHANNELS.find(([, w]) => (roll -= w) < 0)[0];
    insertOrder.run(orderId, 1 + Math.floor(random() * customers), date, channel, random() < 0.04 ? "refunded" : "paid");
    const lines = random() < 0.7 ? 1 : random() < 0.8 ? 2 : 3;
    for (let l = 0; l < lines; l++) {
      let r = random() * liveTotal;
      const product = live.find((p) => (r -= p.weight) < 0) ?? live[0];
      const [, , , price] = PRODUCTS[product.i];
      // An end-of-year sale: 15% off in the last two weeks of November.
      const sale = date.slice(5) >= "11-15" && date.slice(5) <= "11-30" ? 0.85 : 1;
      insertItem.run(orderId, product.i + 1, price < 60 && random() < 0.3 ? 2 : 1, Math.round(price * sale * 100) / 100);
    }
  }
}
db.exec("COMMIT");
const items = db.prepare("SELECT count(*) AS n FROM order_items").get().n;
db.close();
console.log(`seeded ${orderId} orders, ${items} order lines → ${FILE}`);
