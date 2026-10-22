import { describe, expect, it } from "vitest";
import { formatDate, formatValue, parseDate } from "../src/spec/format.js";

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
});
