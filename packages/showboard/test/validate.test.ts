import { describe, expect, it } from "vitest";
import { checkBoard } from "../src/spec/validate.js";

const ctx = { datasets: { sales: ["month", "revenue", "orders"], top: ["product", "revenue"] }, customComponents: ["PriceChart"] };

const board = (elements: Record<string, unknown>, root = "root") => ({ root, elements });

describe("checkBoard", () => {
  it("accepts a board that uses known components, datasets and columns", () => {
    const result = checkBoard(
      board({
        root: { type: "Grid", props: { columns: 2 }, children: ["kpi", "chart", "note"] },
        kpi: { type: "Metric", props: { label: "Revenue", dataset: "sales", field: "revenue", format: "currency" } },
        chart: { type: "LineChart", props: { dataset: "sales", x: "month", y: ["revenue", "orders"] } },
        note: { type: "Note", props: { text: "Revenue rose." } },
      }),
      ctx,
    );
    expect(result.problems).toEqual([]);
    expect(result.datasetsUsed).toEqual(["sales"]);
  });

  it("names the missing column and lists the ones the dataset has", () => {
    const { problems } = checkBoard(board({ root: { type: "BarChart", props: { dataset: "top", x: "product", y: ["profit"] } } }), ctx);
    expect(problems).toEqual(['root: column "profit" is not in dataset "top" (it has: product, revenue).']);
  });

  it("refuses unknown datasets, components and props, and missing required props", () => {
    const { problems } = checkBoard(
      board({
        root: { type: "Section", props: { title: "T" }, children: ["a", "b", "c"] },
        a: { type: "Table", props: { dataset: "nope" } },
        b: { type: "Sparkline", props: {} },
        c: { type: "Metric", props: { label: "x", dataset: "sales", colour: "red" } },
      }),
      ctx,
    );
    expect(problems).toContain('a: dataset "nope" does not exist. Datasets: sales, top.');
    expect(problems.some((p) => p.startsWith('b: unknown component "Sparkline"'))).toBe(true);
    expect(problems.some((p) => p.startsWith('c: Metric has no prop "colour"'))).toBe(true);
    expect(problems).toContain('c: Metric needs "field".');
  });

  it("takes Table columns as names or objects, and checks both", () => {
    const table = (columns: unknown[]) => checkBoard(board({ root: { type: "Table", props: { dataset: "top", columns } } }), ctx).problems;
    expect(table(["product", { field: "revenue", format: "currency" }])).toEqual([]);
    expect(table(["product", "units"])).toEqual(['root: column "units" is not in dataset "top" (it has: product, revenue).']);
  });

  it("lets the app's own components through for the browser to check", () => {
    expect(checkBoard(board({ root: { type: "PriceChart", props: { symbols: ["TCS"] } } }), ctx).problems).toEqual([]);
  });

  it("skips expression props and records the datasets $state reads", () => {
    const result = checkBoard(
      board({ root: { type: "Note", props: { title: { $state: "/data/top/0/product" }, text: "Best seller" } } }),
      ctx,
    );
    expect(result.problems).toEqual([]);
    expect(result.datasetsUsed).toEqual(["top"]);
    expect(checkBoard(board({ root: { type: "Note", props: { text: { $state: "/data/gone/0/x" } } } }), ctx).problems[0]).toContain('reads dataset "gone"');
  });

  it("reports structural problems from json-render and bad shapes", () => {
    expect(checkBoard(board({ root: { type: "Grid", props: {}, children: ["ghost"] } }), ctx).problems.join(" ")).toMatch(/ghost/);
    expect(checkBoard({ elements: {} }, ctx).problems[0]).toMatch(/^spec\.root/);
    expect(checkBoard(board({ root: { type: "Metric", props: { label: "x", dataset: "sales", field: "revenue" }, children: ["root"] } }), ctx).problems.join(" ")).toMatch(/takes no children/);
  });
});
