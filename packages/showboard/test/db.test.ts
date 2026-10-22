import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanSql, openDatabase, type Database } from "../src/server/db.js";
import { bindParams } from "../src/server/params.js";

const limits = { maxRows: 3, timeoutMs: 2000 };

describe("cleanSql", () => {
  it("drops a trailing semicolon and allows leading comments", () => {
    expect(cleanSql("select 1;  ")).toBe("select 1");
    expect(cleanSql("-- top products\nWITH t AS (select 1) select * from t")).toContain("WITH");
  });
  it("refuses anything but a query", () => {
    expect(() => cleanSql("delete from orders")).toThrow(/single SELECT/);
    expect(() => cleanSql("  ;")).toThrow(/empty/);
  });
});

describe("sqlite", () => {
  let db: Database;
  beforeAll(async () => {
    const file = join(mkdtempSync(join(tmpdir(), "showboard-")), "shop.sqlite");
    const setup = new DatabaseSync(file);
    setup.exec("CREATE TABLE sales (month TEXT, revenue REAL); INSERT INTO sales VALUES ('2026-01', 10), ('2026-02', 12.5), ('2026-03', 9), ('2026-04', 14);");
    setup.close();
    db = await openDatabase(file);
  });
  afterAll(() => db.close());

  it("returns rows, columns and truncation", async () => {
    const result = await db.query("select month, revenue from sales order by month -- newest last", limits);
    expect(result.rows).toHaveLength(3);
    expect(result.truncated).toBe(true);
    expect(result.columns).toEqual([{ name: "month", type: "text" }, { name: "revenue", type: "number" }]);
  });

  it("cannot write", async () => {
    await expect(db.query("with x as (select 1) insert into sales values ('x', 1) returning *", limits)).rejects.toThrow();
    expect((await db.query("select count(*) as n from sales", limits)).rows[0]).toEqual({ n: 4 });
  });

  it("describes tables", async () => {
    expect(await db.describe()).toEqual([{ table: "sales", columns: [{ name: "month", type: "text" }, { name: "revenue", type: "real" }], rows: 4 }]);
  });
});

// Needs a scratch Postgres database the test may create a table in, e.g.
// SHOWBOARD_TEST_PG=postgres://postgres@localhost:5432/showboard_test
const PG = process.env.SHOWBOARD_TEST_PG;
describe.skipIf(!PG)("postgres", () => {
  let db: Database;
  beforeAll(async () => {
    const pg = await import("pg");
    const setup = new pg.default.Client({ connectionString: PG });
    await setup.connect();
    await setup.query(
      "DROP TABLE IF EXISTS sb_sales; DROP SEQUENCE IF EXISTS sb_seq; CREATE SEQUENCE sb_seq; CREATE TABLE sb_sales (day date, amount numeric(12,2), qty bigint); INSERT INTO sb_sales VALUES ('2026-03-01', 1234.50, 3), ('2026-03-02', 99.99, 1)",
    );
    await setup.end();
    db = await openDatabase(PG!);
  });
  afterAll(() => db.close());

  it("keeps dates as printed and turns numeric/bigint into numbers", async () => {
    const result = await db.query("select * from sb_sales order by day", limits);
    expect(result.rows[0]).toEqual({ day: "2026-03-01", amount: 1234.5, qty: 3 });
    expect(result.columns.map((c) => c.type)).toEqual(["date", "numeric", "bigint"]);
  });

  it("refuses writes, even after closing the parenthesis and committing", async () => {
    await expect(db.query("with d as (delete from sb_sales returning *) select * from d", limits)).rejects.toThrow();
    await expect(db.query("select nextval('sb_seq')", limits)).rejects.toThrow(/read-only/);
    await expect(db.query("select 1) q; commit; delete from sb_sales; select (1", limits)).rejects.toThrow();
    expect((await db.query("select count(*) as n from sb_sales", limits)).rows[0]).toEqual({ n: 2 });
  });

  it("binds named values, a list as one placeholder per value", async () => {
    const { sql, values } = bindParams("select day, qty from sb_sales where qty in (:qty) and day >= :from::date order by day", { qty: [1, 3], from: "2026-03-02" }, "postgres");
    expect((await db.query(sql, limits, values)).rows).toEqual([{ day: "2026-03-02", qty: 1 }]);
  });

  it("stops slow queries", async () => {
    await expect(db.query("select pg_sleep(2)", { maxRows: 1, timeoutMs: 200 })).rejects.toThrow(/timeout/);
  });

  it("describes tables", async () => {
    const sales = (await db.describe()).find((t) => t.table === "sb_sales");
    expect(sales?.columns.map((c) => c.name)).toEqual(["day", "amount", "qty"]);
  });
});
