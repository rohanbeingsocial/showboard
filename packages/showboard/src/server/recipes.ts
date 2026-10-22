import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { dataParts, itemShape, nameShape, type Item } from "./items.js";
import type { Params, ParamValue } from "./params.js";

// Recipes: boards worth drawing again with other values ("these stocks over a year"). The app
// ships its own; Claude saves new ones with draw's save_as. Running one is a single tool call
// that names the recipe and its values, so a familiar question costs a few hundred tokens.

export const paramValueShape = z.union([z.string().max(200), z.number(), z.null(), z.array(z.union([z.string().max(200), z.number()])).max(50)]);

export const recipeShape = z.object({
  name: nameShape,
  about: z.string().min(1).max(400),
  /** May use {param} to name the values, e.g. "{symbols} over {days} days". */
  title: z.string().min(1).max(160),
  params: z
    .record(
      nameShape,
      z.object({ about: z.string().max(200).optional(), default: paramValueShape.optional(), example: paramValueShape.optional() }),
    )
    .optional(),
  items: z.array(itemShape).min(1).max(12),
  at: z.string().optional(),
});
export type Recipe = z.infer<typeof recipeShape>;

/** Why these items cannot be kept as a recipe, or null: a recipe fetches its own rows each time. */
export function recipeProblem(items: Item[]): string | null {
  const borrowed = dataParts(items).filter((p) => p.dataset);
  return borrowed.length ? `A recipe fetches its own rows: give ${borrowed.map((p) => `"${p.title ?? p.dataset}"`).join(", ")} sql or a source instead of a dataset.` : null;
}

export class RecipeStore {
  private builtIn = new Map<string, Recipe>();
  private saved = new Map<string, Recipe>();

  /** `builtIn` are the app's own (checked here, so a mistake fails at start); `dir` keeps the saved ones. */
  constructor(builtIn: Recipe[] = [], private dir?: string) {
    for (const recipe of builtIn) {
      const parsed = recipeShape.safeParse(recipe);
      if (!parsed.success) throw new Error(`Recipe "${recipe?.name ?? "?"}": ${issues(parsed.error)}`);
      const problem = recipeProblem(parsed.data.items);
      if (problem) throw new Error(`Recipe "${recipe.name}": ${problem}`);
      this.builtIn.set(parsed.data.name, parsed.data);
    }
    if (!dir || !existsSync(dir)) return;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      try {
        const parsed = recipeShape.safeParse(JSON.parse(readFileSync(join(dir, file), "utf8")));
        if (!parsed.success) throw new Error(issues(parsed.error));
        if (!this.builtIn.has(parsed.data.name)) this.saved.set(parsed.data.name, parsed.data);
      } catch (err) {
        console.warn(`showboard: skipped recipe ${file}: ${(err as Error).message}`);
      }
    }
  }

  get(name: string): Recipe | undefined {
    return this.builtIn.get(name) ?? this.saved.get(name);
  }

  list(): Recipe[] {
    return [...this.builtIn.values(), ...this.saved.values()];
  }

  isBuiltIn(name: string): boolean {
    return this.builtIn.has(name);
  }

  save(recipe: Recipe): void {
    if (this.builtIn.has(recipe.name)) throw new Error(`"${recipe.name}" is one of the app's recipes; save under another name.`);
    this.saved.set(recipe.name, recipe);
    if (!this.dir) return;
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${recipe.name}.json`), `${JSON.stringify(recipe, null, 2)}\n`);
  }
}

/** `compare_prices(symbols e.g. ["ITC","TCS"], days = 365): Closing prices rebased to 100.` */
export function describeRecipe(recipe: Recipe): string {
  const params = Object.entries(recipe.params ?? {}).map(([name, p]) => {
    const value = p.default !== undefined ? ` = ${JSON.stringify(p.default)}` : p.example !== undefined ? ` e.g. ${JSON.stringify(p.example)}` : "";
    return `${name}${value}${p.about ? ` (${p.about})` : ""}`;
  });
  return `${recipe.name}(${params.join(", ")}): ${recipe.about}`;
}

/** The values to run a recipe with: what Claude passed, then the defaults. */
export function recipeParams(recipe: Recipe, given: Params): Params {
  const declared = recipe.params ?? {};
  for (const key of Object.keys(given)) {
    if (!Object.hasOwn(declared, key)) throw new Error(`${recipe.name} has no parameter "${key}" (it takes: ${Object.keys(declared).join(", ") || "none"}).`);
  }
  const out: Params = {};
  for (const [key, def] of Object.entries(declared)) {
    const value: ParamValue | undefined = Object.hasOwn(given, key) ? given[key] : def.default;
    if (value === undefined) throw new Error(`${recipe.name} needs ${key}${def.example !== undefined ? `, e.g. ${JSON.stringify(def.example)}` : ""}.`);
    out[key] = value;
  }
  return out;
}

const issues = (error: z.ZodError) => error.issues.map((i) => `${i.path.join(".") || "recipe"}: ${i.message}`).join("; ");
