import { useEffect, useState } from "react";
import { formatValue, type ShowboardComponent } from "showboard/react";
import { z } from "zod";

export interface Product {
  sku: string;
  name: string;
  category: string;
  price: number;
  launched: string;
  units_2026: number;
}

let products: Promise<Product[]> | null = null;
export const loadProducts = () => (products ??= fetch("/api/products").then((r) => r.json() as Promise<Product[]>));

const props = z.object({ sku: z.string().describe("Product SKU, e.g. DSK-AERO") });

/** The shop's own product card, offered to Claude as a board component. */
export const ProductCard: ShowboardComponent<typeof props> = {
  description: "The shop's product card: name, category, price and units sold in 2026, from the shop's own API.",
  props,
  render: function ProductCardView({ props: { sku } }) {
    const [product, setProduct] = useState<Product | null | undefined>(undefined);
    useEffect(() => {
      loadProducts().then((all) => setProduct(all.find((p) => p.sku === sku) ?? null));
    }, [sku]);
    if (product === undefined) return <div className="sb-card">Loading {sku}…</div>;
    if (product === null) return <div className="sb-missing">No product {sku}.</div>;
    return (
      <div className="sb-card product-card">
        <div className="sb-muted">{product.category} · {product.sku}</div>
        <div className="product-name">{product.name}</div>
        <div className="product-meta">
          <span>{formatValue(product.price, "currency", { locale: "en-US", currency: "USD" })}</span>
          <span>{formatValue(product.units_2026, "integer")} sold in 2026</span>
        </div>
      </div>
    );
  },
};
