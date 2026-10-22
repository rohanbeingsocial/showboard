import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Board, ShowboardProvider } from "../src/react/index.js";

// Next.js and other frameworks render client components on the server first, where there is no
// sessionStorage, window or EventSource. The provider and an empty board must render there.
describe("server rendering", () => {
  it("renders the provider and an empty board without browser globals", () => {
    expect(typeof sessionStorage).toBe("undefined");
    const html = renderToString(createElement(ShowboardProvider, { url: "/api/showboard", children: createElement(Board) }));
    expect(html).toContain("Connecting to Showboard");
  });
});
