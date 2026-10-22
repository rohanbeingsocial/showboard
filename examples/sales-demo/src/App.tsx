import { useState } from "react";
import { ShowboardProvider, useShowboard, useShowboardAction, useShowboardState } from "showboard/react";
import { z } from "zod";
import { BoardPage } from "./BoardPage";
import { OrdersPage, ProductsPage, type OrderFilters } from "./pages";
import { ProductCard } from "./ProductCard";

const PAGES = ["board", "orders", "products"] as const;
type Page = (typeof PAGES)[number];

// Module constants, so the provider and actions keep one identity across renders.
const FORMAT = { locale: "en-US", currency: "USD" };
const COMPONENTS = { ProductCard };
const openPageInput = z.object({ page: z.enum(PAGES) });
const filterOrdersInput = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("YYYY-MM"),
  sku: z.string().optional().describe("Product SKU, e.g. DSK-AERO"),
  status: z.enum(["paid", "refunded"]).optional(),
});
const highlightInput = z.object({ sku: z.string() });

export function App() {
  const [page, setPage] = useState<Page>("board");
  const [filters, setFilters] = useState<OrderFilters>({});
  const [highlight, setHighlight] = useState<string | null>(null);

  return (
    <ShowboardProvider url="/showboard" format={FORMAT} components={COMPONENTS} onBoard={() => setPage("board")}>
      <ClaudeHooks page={page} filters={filters} highlight={highlight} setPage={setPage} setFilters={setFilters} setHighlight={setHighlight} />
      <div className="shell">
        <nav className="sidebar">
          <div className="brand">Nook Furniture</div>
          {PAGES.map((p) => (
            <button key={p} className={p === page ? "active" : undefined} onClick={() => setPage(p)}>
              {p === "board" ? "Claude's board" : p[0]!.toUpperCase() + p.slice(1)}
            </button>
          ))}
          <Status />
        </nav>
        <main className="content">
          {page === "board" ? <BoardPage /> : null}
          {page === "orders" ? <OrdersPage filters={filters} setFilters={setFilters} /> : null}
          {page === "products" ? <ProductsPage highlight={highlight} /> : null}
        </main>
      </div>
    </ShowboardProvider>
  );
}

/** What Claude can see (useShowboardState) and do (useShowboardAction) in this app. */
function ClaudeHooks(props: {
  page: Page;
  filters: OrderFilters;
  highlight: string | null;
  setPage(p: Page): void;
  setFilters(f: OrderFilters): void;
  setHighlight(sku: string | null): void;
}) {
  useShowboardState("page", props.page);
  useShowboardState("order_filters", props.filters);
  useShowboardState("highlighted_product", props.highlight);

  useShowboardAction({
    name: "open_page",
    description: "Switch the admin to a page: board (your boards), orders, products.",
    input: openPageInput,
    run: ({ page }) => {
      props.setPage(page);
      return { page };
    },
  });
  useShowboardAction({
    name: "filter_orders",
    description: "Open the Orders page filtered by month, product SKU and/or status. Omitted filters are cleared.",
    input: filterOrdersInput,
    run: (filters) => {
      props.setFilters(filters);
      props.setPage("orders");
      return { filters };
    },
  });
  useShowboardAction({
    name: "highlight_product",
    description: "Open the Products page with one product highlighted.",
    input: highlightInput,
    run: ({ sku }) => {
      props.setHighlight(sku);
      props.setPage("products");
      return { sku };
    },
  });
  return null;
}

function Status() {
  const { connected } = useShowboard();
  return (
    <div className="status">
      <span className={connected ? "dot on" : "dot"} /> {connected ? "Claude can see this app" : "Showboard offline"}
    </div>
  );
}
