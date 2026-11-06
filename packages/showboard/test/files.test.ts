import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import writeXlsxFile from "write-excel-file/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createShowboard, openFiles, type Database } from "../src/server/index.js";
import { currencyIn, detectDelimiter, parseCsv, parseNumberText, parseTextDate, shapeSheet, sqlName } from "../src/server/sheets.js";

const limits = { maxRows: 1000, timeoutMs: 1000 };

describe("CSV", () => {
  it("reads quotes, embedded delimiters and newlines, CRLF and a BOM", () => {
    const text = '﻿name,note\r\n"Smith, J","said ""hi""\nthen left"\r\nLee,\r\n';
    expect(parseCsv(text)).toEqual([
      ["name", "note"],
      ["Smith, J", 'said "hi"\nthen left'],
      ["Lee", ""],
    ]);
  });

  it("finds the delimiter", () => {
    expect(detectDelimiter("a;b;c\n1;2,5;3\n")).toBe(";");
    expect(detectDelimiter("a\tb\n1\t2\n")).toBe("\t");
    expect(detectDelimiter('a,b\n"x;y",2\n')).toBe(",");
  });
});

describe("values", () => {
  it("parses numbers written as text", () => {
    expect(parseNumberText("1,234.50")).toBe(1234.5);
    expect(parseNumberText("₹1,23,456")).toBe(123456);
    expect(parseNumberText("$ 99")).toBe(99);
    expect(parseNumberText("(1,200)")).toBe(-1200);
    expect(parseNumberText("-3.5%")).toBe(-3.5);
    expect(parseNumberText("Rs. 500")).toBe(500);
    expect(parseNumberText("abc")).toBeNull();
    expect(parseNumberText("1,2,3")).toBeNull();
    expect(parseNumberText("0612")).toBe(612); // the column check keeps codes like this as text
    expect(parseNumberText("03.04.2026")).toBeNull();
  });

  it("parses comma decimals, and settles numbers that read two ways", () => {
    expect(parseNumberText("1.234,50")).toBe(1234.5);
    expect(parseNumberText("1 234,50 €")).toBe(1234.5);
    expect(parseNumberText("1'234.50")).toBe(1234.5);
    expect(parseNumberText("12,34")).toBe(12.34);
    expect(parseNumberText("-1.234.567,8")).toBe(-1234567.8);
    expect(parseNumberText("1,234")).toBe(1234);
    expect(parseNumberText("1,234", ",")).toBe(1.234);
    expect(parseNumberText("1.234")).toBe(1.234);
    expect(parseNumberText("1.234", ",")).toBe(1234);
    expect(parseNumberText("0.500", ",")).toBe(0.5);
  });

  it("reads each value in a column by its own decimal mark", () => {
    const amounts = (...values: string[]) => shapeSheet([["Item", "Amount"], ...values.map((v, i) => [`item ${i + 1}`, v])])!;
    const mixed = amounts("1.234,50", "1,234.50", "99.00");
    expect(mixed.columns[1]!.type).toBe("real");
    expect(mixed.rows.map((r) => r[1])).toEqual([1234.5, 1234.5, 99]);
    expect(mixed.notes.join(" ")).toMatch(/mixes 2 values written like 1,234.50 with 1 like 1.234,50/);

    // A comma-decimal column reads "1.234" as a thousand.
    expect(amounts("1.234,50", "12,5", "1.234").rows.map((r) => r[1])).toEqual([1234.5, 12.5, 1234]);
    // With nothing to go by, "." is the decimal mark, and the note says it was a guess.
    const guessed = amounts("1.234", "12.345");
    expect(guessed.rows.map((r) => r[1])).toEqual([1.234, 12.345]);
    expect(guessed.notes.join(" ")).toMatch(/could be a decimal or a thousands mark/);
    expect(amounts("1,234", "12,500").notes).toEqual([]);

    // Split down the middle: a value that reads two ways is left empty and named.
    const split = amounts("1.234,50", "1,234.50", "5.000");
    expect(split.rows.map((r) => r[1])).toEqual([1234.5, 1234.5, null]);
    expect(split.notes.join(" ")).toMatch(/1 value left empty because each reads two ways \(row 4 "5.000"\)/);
    // Mostly one way: it follows the rest.
    const most = amounts("1,234.50", "2.5", "3.75", "10.5", "1.234,50", "5,000");
    expect(most.rows.map((r) => r[1])).toEqual([1234.5, 2.5, 3.75, 10.5, 1234.5, 5000]);
    expect(most.notes.join(" ")).toMatch(/used "\." as the decimal mark, like most of the column/);

    // One value that is not a number keeps the column as text, and the note warns against summing it.
    const typo = amounts("1,234.50", "99.00", "1.234,5O");
    expect(typo.columns[1]!.type).toBe("text");
    expect(typo.notes.join(" ")).toMatch(/kept as text: 1 of 3 values is not a number \(row 4 "1.234,5O"\), so a sum over it would be wrong/);
    expect(shapeSheet([["Name", "City"], ["A", "Pune"], ["B", "Delhi"]])!.notes).toEqual([]);
  });

  it("reads the currency amounts are written in", () => {
    expect(currencyIn("Net Sales (₹)")).toBe("INR");
    expect(currencyIn("Rs. 500")).toBe("INR");
    expect(currencyIn("$1,200")).toBe("USD");
    expect(currencyIn("1200 EUR")).toBe("EUR");
    expect(currencyIn("Mrs Rao")).toBeNull();
    expect(currencyIn("Amount")).toBeNull();
    const priced = shapeSheet([["Item", "Price"], ["Desk", "£120"], ["Lamp", "£15.50"]])!;
    expect(priced.columns[1]).toEqual({ name: "price", label: "Price", type: "real", currency: "GBP" });
  });

  it("parses dates written as text", () => {
    expect(parseTextDate("2026-03-01", "dmy")).toBe("2026-03-01");
    expect(parseTextDate("2026-03-01T09:30:00Z", "dmy")).toBe("2026-03-01 09:30:00");
    expect(parseTextDate("03/04/2026", "dmy")).toBe("2026-04-03");
    expect(parseTextDate("03/04/2026", "mdy")).toBe("2026-03-04");
    expect(parseTextDate("15-Mar-2026", "dmy")).toBe("2026-03-15");
    expect(parseTextDate("Sept 5, 2026", "dmy")).toBe("2026-09-05");
    expect(parseTextDate("31/02/2026", "dmy")).toBeNull();
    expect(parseTextDate("Marketing 5, 2026", "dmy")).toBeNull();
  });

  it("names columns for SQL", () => {
    expect(sqlName("Net Sales (₹)", "x")).toBe("net_sales");
    expect(sqlName("Café Région", "x")).toBe("cafe_region");
    expect(sqlName("2024", "x")).toBe("_2024");
    expect(sqlName("Order", "x")).toBe("order_");
    expect(sqlName("Order #", "x")).toBe("order_no");
    expect(sqlName("Margin %", "x")).toBe("margin_pct");
    expect(sqlName("   ", "column_3")).toBe("column_3");
  });
});

describe("shapeSheet", () => {
  it("skips titles, blank rows and totals, and types each column", () => {
    const table = shapeSheet([
      ["Quarterly sales report", null, null, null, null],
      ["Generated 1 Oct 2026", null, null, null, null],
      [],
      ["Region", "Order Date", "Net Sales (₹)", "Margin", "PIN"],
      ["North", new Date(Date.UTC(2026, 0, 5)), "1,200", "12.5%", "011001"],
      [null, null, null, null, null],
      ["South", new Date(Date.UTC(2026, 1, 9)), 800, "N/A", "560001"],
      ["Total", null, 2000, null, null],
    ])!;
    expect(table.columns).toEqual([
      { name: "region", label: "Region", type: "text" },
      { name: "order_date", label: "Order Date", type: "date" },
      { name: "net_sales", label: "Net Sales (₹)", type: "integer", currency: "INR" },
      { name: "margin", label: "Margin", type: "real" },
      { name: "pin", label: "PIN", type: "text" },
    ]);
    expect(table.rows).toEqual([
      ["North", "2026-01-05", 1200, 12.5, "011001"],
      ["South", "2026-02-09", 800, null, "560001"],
    ]);
    expect(table.notes.join(" ")).toMatch(/header on row 4/);
    expect(table.notes.join(" ")).toMatch(/skipped 1 total row \(row 8\)/);
    expect(table.notes.join(" ")).toMatch(/12.5% is stored as 12.5/);
  });

  it("joins a row of group titles onto the header below it", () => {
    const table = shapeSheet([
      [null, "Sales", null, "Returns", null],
      ["Region", "Units", "Value", "Units", "Value"],
      ["North", 3, 300, 1, 100],
    ])!;
    expect(table.columns.map((c) => c.name)).toEqual(["region", "sales_units", "sales_value", "returns_units", "returns_value"]);
  });

  it("takes years as headers, and names columns of a sheet with no header", () => {
    expect(shapeSheet([["Region", 2025, 2026], ["North", 10, 12]])!.columns.map((c) => c.name)).toEqual(["region", "_2025", "_2026"]);
    const bare = shapeSheet([[1, 2], [3, 4]])!;
    expect(bare.columns.map((c) => c.name)).toEqual(["column_1", "column_2"]);
    expect(bare.rows).toEqual([[1, 2], [3, 4]]);
  });

  it("reads day/month order from the values, and keeps ambiguous dates as text", () => {
    const dmy = shapeSheet([["Day"], ["03/04/2026"], ["25/04/2026"]])!;
    expect(dmy.columns[0]!.type).toBe("date");
    expect(dmy.rows).toEqual([["2026-04-03"], ["2026-04-25"]]);
    const unclear = shapeSheet([["Day"], ["03/04/2026"], ["05/06/2026"]])!;
    expect(unclear.columns[0]!.type).toBe("text");
    expect(unclear.notes.join(" ")).toMatch(/could be day\/month or month\/day/);
  });

  it("dedupes names, drops empty columns and repeated headers", () => {
    const table = shapeSheet([
      ["Amount", "Amount", null, "Note"],
      [1, 2, null, "a"],
      ["Amount", "Amount", null, "Note"],
      [3, 4, null, "b"],
    ])!;
    expect(table.columns.map((c) => c.name)).toEqual(["amount", "amount_2", "note"]);
    expect(table.rows).toEqual([[1, 2, "a"], [3, 4, "b"]]);
  });

  it("returns null for an empty sheet", () => {
    expect(shapeSheet([[], [null, ""]])).toBeNull();
  });
});

describe("openFiles", () => {
  let dir: string;
  let db: Database;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "showboard-files-"));
    const header = (...titles: string[]) => titles.map((value) => ({ value }));
    await writeXlsxFile([
      {
        sheet: "Orders",
        data: [
          [{ value: "Orders export" }],
          [],
          header("Order ID", "Date", "Product", "Qty", "Amount"),
          [{ value: 1 }, { value: new Date(Date.UTC(2026, 0, 3)), format: "yyyy-mm-dd" }, { value: "Desk" }, { value: 2 }, { value: 500 }],
          [{ value: 2 }, { value: new Date(Date.UTC(2026, 1, 7)), format: "yyyy-mm-dd" }, { value: "Lamp" }, { value: 1 }, { value: 40.5 }],
          [{ value: 3 }, { value: new Date(Date.UTC(2026, 1, 9)), format: "yyyy-mm-dd" }, { value: "Desk" }, { value: 1 }, { value: 250 }],
          [{ value: "Grand Total" }, null, null, { value: 4 }, { value: 790.5 }],
        ],
      },
      { sheet: "Products", data: [header("Product", "Category"), [{ value: "Desk" }, { value: "Furniture" }], [{ value: "Lamp" }, { value: "Lighting" }]] },
    ]).toFile(join(dir, "Sales 2026.xlsx"));
    writeFileSync(join(dir, "targets.csv"), "Category;Target (₹)\nFurniture;700\nLighting;100\n");
    writeFileSync(join(dir, "~$Sales 2026.xlsx"), "lock");
    writeFileSync(join(dir, "old.xls"), "binary");
    db = await openFiles([dir], { recheckMs: 0 });
  });

  afterAll(async () => {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("makes a table of each sheet and says where it came from", async () => {
    const tables = await db.describe();
    expect(tables.map((t) => t.table)).toEqual(["sales_2026_orders", "sales_2026_products", "targets"]);
    const orders = tables[0]!;
    expect(orders.source).toMatch(/Sales 2026\.xlsx › Orders$/);
    expect(orders.rows).toBe(3);
    expect(orders.columns.map((c) => `${c.name}:${c.type}`)).toEqual(["order_id:integer", "date:date (YYYY-MM-DD)", "product:text", "qty:integer", "amount:number"]);
    expect(orders.columns[0]!.label).toBeUndefined();
    expect(orders.notes?.join(" ")).toMatch(/total row/);
    expect(db.notes!().join(" ")).toMatch(/old\.xls: \.xls files cannot be read/);
  });

  it("joins across files with SQL", async () => {
    const result = await db.query(
      `SELECT p.category, SUM(o.amount) AS sales, t.target
       FROM sales_2026_orders o JOIN sales_2026_products p ON p.product = o.product JOIN targets t ON t.category = p.category
       GROUP BY p.category ORDER BY p.category`,
      limits,
    );
    expect(result.rows).toEqual([
      { category: "Furniture", sales: 750, target: 700 },
      { category: "Lighting", sales: 40.5, target: 100 },
    ]);
  });

  it("only reads", async () => {
    await expect(db.query("DELETE FROM targets", limits)).rejects.toThrow(/Only a single SELECT/);
    await expect(db.query("WITH x AS (SELECT 1) DELETE FROM targets", limits)).rejects.toThrow();
    expect((await db.query("SELECT count(*) AS n FROM targets", limits)).rows).toEqual([{ n: 2 }]);
  });

  it("reloads a file when it changes", async () => {
    const file = join(dir, "targets.csv");
    writeFileSync(file, "Category;Target (₹)\nFurniture;900\nLighting;100\nDecor;50\n");
    const later = new Date(Date.now() + 5000);
    utimesSync(file, later, later);
    expect((await db.query("SELECT count(*) AS n, max(target) AS top FROM targets", limits)).rows).toEqual([{ n: 3, top: 900 }]);
  });

  it("refuses when nothing can be read", async () => {
    await expect(openFiles([join(dir, "missing.csv")])).rejects.toThrow(/No tables could be read.*not found/);
  });

  it("totals a column that mixes 1.234,50 and 1,234.50", async () => {
    const own = mkdtempSync(join(tmpdir(), "showboard-mixed-"));
    try {
      writeFileSync(join(own, "orders.csv"), "Item;Amount\nDesk;1.234,50\nLamp;1,234.50\nRug;99.00\n");
      const mixed = await openFiles([own]);
      expect((await mixed.query("SELECT sum(amount) AS total FROM orders", limits)).rows).toEqual([{ total: 2568 }]);
      expect((await mixed.describe())[0]!.notes?.join(" ")).toMatch(/each is read by its own decimal mark/);
      await mixed.close();
    } finally {
      rmSync(own, { recursive: true, force: true });
    }
  });

  it("shows source, headings and notes in describe_data", async () => {
    const board = await createShowboard({ files: [dir] });
    const out = JSON.parse((await board.callTool("describe_data", {})).content) as {
      database: { tables: { table: string; from: string; columns: string[]; notes?: string[] }[]; notes: string[] };
      format?: { locale?: string; currency?: string };
    };
    // "Target (₹)" is the only currency in the files, so the board page prints rupees.
    expect(out.format).toEqual({ locale: "en-IN", currency: "INR" });
    const orders = out.database.tables.find((t) => t.table === "sales_2026_orders")!;
    expect(orders.from).toMatch(/Orders$/);
    expect(orders.columns).toContain("order_id integer");
    expect(out.database.tables.find((t) => t.table === "targets")!.columns).toContain('target integer ← "Target (₹)"');
    expect(out.database.notes.join(" ")).toMatch(/\.xls/);
    const res = await board.handler({ viewer: true })(new Request("http://127.0.0.1:4710/", { headers: { host: "127.0.0.1:4710" } }));
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(await res.text()).toMatch(/viewer\.js/);
    const off = await board.handler()(new Request("http://127.0.0.1:4710/", { headers: { host: "127.0.0.1:4710" } }));
    expect(off.status).toBe(404);
    await board.close();
    const dollars = await createShowboard({ files: [dir], format: { currency: "USD" } });
    expect(JSON.parse((await dollars.callTool("describe_data", {})).content).format).toEqual({ currency: "USD" });
    await dollars.close();
  });
});
