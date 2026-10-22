import { validateSpec, type Spec } from "@json-render/core";
import { z } from "zod";
import { BUILT_IN, columnRefs, isBuiltIn } from "./catalog.js";

// Checks a board Claude wrote before anyone sees it, and says what to fix in words Claude
// can act on: the element, the prop, and what would have been valid.

const elementShape = z.looseObject({
  type: z.string().min(1),
  props: z.record(z.string(), z.unknown()).optional(),
  children: z.array(z.string()).optional(),
});

export const specShape = z.object({
  root: z.string().min(1),
  elements: z.record(z.string(), elementShape),
  state: z.record(z.string(), z.unknown()).optional(),
});

export interface BoardContext {
  /** Column names of each dataset the server holds. */
  datasets: Record<string, string[]>;
  /** Components the app added (reported by the browser). */
  customComponents: string[];
}

export interface BoardCheck {
  problems: string[];
  /** Datasets the board reads, by component props or `$state: "/data/<name>…"`. */
  datasetsUsed: string[];
}

/** A json-render expression such as `{ "$state": "/data/sales/0/total" }`, resolved in the browser. */
export const isExpression = (value: unknown): boolean =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).some((k) => k.startsWith("$"));

export function checkBoard(input: unknown, ctx: BoardContext): BoardCheck & { spec?: Spec } {
  const parsed = specShape.safeParse(input);
  if (!parsed.success) return { problems: parsed.error.issues.map((i) => `spec.${i.path.join(".")}: ${i.message}`), datasetsUsed: [] };
  const spec = parsed.data as Spec;
  const problems: string[] = [];
  const used = new Set<string>();

  for (const issue of validateSpec(spec).issues) {
    if (issue.severity === "error") problems.push(issue.elementKey ? `${issue.elementKey}: ${issue.message}` : issue.message);
  }

  const custom = new Set(ctx.customComponents);
  for (const [key, element] of Object.entries(spec.elements)) {
    const props = (element.props ?? {}) as Record<string, unknown>;
    for (const path of statePaths(props)) {
      const name = /^\/data\/([^/]+)/.exec(path)?.[1];
      if (!name) continue;
      if (ctx.datasets[name]) used.add(name);
      else problems.push(`${key}: $state "${path}" reads dataset "${name}", which does not exist. ${known(ctx)}`);
    }

    if (!isBuiltIn(element.type)) {
      if (!custom.has(element.type)) {
        const names = [...Object.keys(BUILT_IN), ...custom].join(", ");
        problems.push(`${key}: unknown component "${element.type}". Use one of: ${names}.`);
      }
      continue; // the browser checks the app's own components
    }

    const def = BUILT_IN[element.type];
    if (element.children?.length && !("hasChildren" in def && def.hasChildren)) {
      problems.push(`${key}: ${element.type} takes no children; put them in a Grid or Section.`);
    }
    problems.push(...checkElementProps(key, element.type, def.props, props));

    const dataset = typeof props.dataset === "string" ? props.dataset : undefined;
    if (!dataset) continue;
    const columns = ctx.datasets[dataset];
    if (!columns) {
      problems.push(`${key}: dataset "${dataset}" does not exist. ${known(ctx)}`);
      continue;
    }
    used.add(dataset);
    for (const col of columnRefs(element.type, props)) {
      if (!columns.includes(col)) problems.push(`${key}: column "${col}" is not in dataset "${dataset}" (it has: ${columns.join(", ")}).`);
    }
  }
  return { problems, datasetsUsed: [...used], spec };
}

/** Checks literal props against the schema; props given as expressions are resolved later, in the browser. */
export function checkElementProps(key: string, type: string, schema: z.ZodObject, props: Record<string, unknown>): string[] {
  const shape = schema.shape as Record<string, z.ZodType>;
  const problems: string[] = [];
  for (const [prop, value] of Object.entries(props)) {
    const schema = shape[prop];
    if (!schema) {
      problems.push(`${key}: ${type} has no prop "${prop}" (props: ${Object.keys(shape).join(", ")}).`);
      continue;
    }
    if (isExpression(value)) continue;
    const result = schema.safeParse(value);
    if (!result.success) problems.push(...result.error.issues.map((i) => `${key}: ${type}.${[prop, ...i.path].join(".")}: ${i.message}`));
  }
  for (const [prop, schema] of Object.entries(shape)) {
    if (!(prop in props) && !schema.safeParse(undefined).success) problems.push(`${key}: ${type} needs "${prop}".`);
  }
  return problems;
}

function statePaths(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => statePaths(v, out));
  else if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      if (k === "$state" && typeof v === "string") out.push(v);
      else statePaths(v, out);
    }
  }
  return out;
}

function known(ctx: BoardContext): string {
  const names = Object.keys(ctx.datasets);
  return names.length ? `Datasets: ${names.join(", ")}.` : "No datasets yet: make one with query_data first.";
}
