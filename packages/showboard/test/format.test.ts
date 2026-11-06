import { describe, expect, it } from "vitest";
import { columnLabel, formatDate, formatValue, humanize, parseDate } from "../src/spec/format.js";

describe("format", () => {
  it("prints months, days and timestamps without shifting the day", () => {
    expect(formatDate("2025-01", "en-US")).toBe("Jan 2025");
    expect(formatDate("2026-03-01", "en-US")).toBe("Mar 1, 2026");
    expect(parseDate("2026-03-01")?.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(formatDate("not a date")).toBe("not a date");
  });

  it("formats numbers by kind", () => {
    const usd = { locale: "en-US", currency: "USD" };
    expect(formatValue(462088, "currency", usd)).toBe("$462,088");
    expect(formatValue(0.6792, "percent", usd)).toBe("67.9%");
    expect(formatValue("1234.5", undefined, usd)).toBe("1,235");
    expect(formatValue(null, "number")).toBe("–");
    expect(formatValue("Desks", undefined)).toBe("Desks");
  });

  it("turns column names into headings, with the usual short forms", () => {
    expect(humanize("revenue_2025")).toBe("Revenue 2025");
    expect(humanize("pct_of_portfolio")).toBe("% of portfolio");
    expect(humanize("total_pnl_pct")).toBe("Total P&L %");
    expect(humanize("revenue_growth_ttm")).toBe("Revenue growth TTM");
    expect(humanize("pe")).toBe("P/E");
    expect(humanize("roce")).toBe("ROCE");
    expect(humanize("div_yield")).toBe("Div yield");
    // Only identifiers change; names already written for people stay as they are.
    expect(columnLabel("Aero Standing Desk")).toBe("Aero Standing Desk");
    expect(columnLabel("iPhone sales")).toBe("iPhone sales");
    expect(columnLabel("store")).toBe("Store");
  });
});
