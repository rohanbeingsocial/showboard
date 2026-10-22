import { useEffect, useState } from "react";
import { formatValue } from "showboard/react";
import { loadProducts, type Product } from "./ProductCard";

export interface OrderFilters {
  month?: string;
  sku?: string;
  status?: "paid" | "refunded";
}

interface Order {
  id: number;
  ordered_at: string;
  customer: string;
  city: string;
  channel: string;
  status: string;
  total: number;
}

const usd = (n: number) => formatValue(n, "currency", { locale: "en-US", currency: "USD" });

export function OrdersPage({ filters, setFilters }: { filters: OrderFilters; setFilters(f: OrderFilters): void }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  useEffect(() => void loadProducts().then(setProducts), []);
  useEffect(() => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]);
    fetch(`/api/orders?${query}`).then((r) => r.json()).then(setOrders);
  }, [filters]);

  return (
    <div className="page">
      <h1>Orders</h1>
      <div className="filters">
        <input type="month" value={filters.month ?? ""} onChange={(e) => setFilters({ ...filters, month: e.target.value || undefined })} />
        <select value={filters.sku ?? ""} onChange={(e) => setFilters({ ...filters, sku: e.target.value || undefined })}>
          <option value="">All products</option>
          {products.map((p) => (
            <option key={p.sku} value={p.sku}>{p.name}</option>
          ))}
        </select>
        <select value={filters.status ?? ""} onChange={(e) => setFilters({ ...filters, status: (e.target.value || undefined) as OrderFilters["status"] })}>
          <option value="">Any status</option>
          <option value="paid">Paid</option>
          <option value="refunded">Refunded</option>
        </select>
        <span className="muted">Latest 100</span>
      </div>
      <table className="data">
        <thead>
          <tr><th>#</th><th>Date</th><th>Customer</th><th>City</th><th>Channel</th><th>Status</th><th className="num">Total</th></tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>{o.id}</td><td>{o.ordered_at}</td><td>{o.customer}</td><td>{o.city}</td><td>{o.channel}</td><td>{o.status}</td><td className="num">{usd(o.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProductsPage({ highlight }: { highlight: string | null }) {
  const [products, setProducts] = useState<Product[]>([]);
  useEffect(() => void loadProducts().then(setProducts), []);
  return (
    <div className="page">
      <h1>Products</h1>
      <table className="data">
        <thead>
          <tr><th>SKU</th><th>Name</th><th>Category</th><th className="num">Price</th><th>Launched</th><th className="num">Sold in 2026</th></tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.sku} className={p.sku === highlight ? "highlight" : undefined}>
              <td>{p.sku}</td><td>{p.name}</td><td>{p.category}</td><td className="num">{usd(p.price)}</td><td>{p.launched}</td><td className="num">{formatValue(p.units_2026, "integer")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
