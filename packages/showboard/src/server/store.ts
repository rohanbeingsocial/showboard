import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Board, BoardSummary, Dataset } from "../spec/types.js";

// Datasets live in memory for the session; boards are kept (in a folder, when one is
// given) so the user can reopen one tomorrow and see the same numbers.

const MAX_DATASETS = 40;
const MAX_BOARDS = 200;

export class DatasetStore {
  private items = new Map<string, Dataset>();

  set(dataset: Dataset): void {
    this.items.delete(dataset.name); // re-insert so the newest is last
    this.items.set(dataset.name, dataset);
    while (this.items.size > MAX_DATASETS) this.items.delete(this.items.keys().next().value!);
  }

  get(name: string): Dataset | undefined {
    return this.items.get(name);
  }

  columns(): Record<string, string[]> {
    return Object.fromEntries([...this.items].map(([name, d]) => [name, d.columns.map((c) => c.name)]));
  }

  list(): Dataset[] {
    return [...this.items.values()];
  }
}

export class BoardStore {
  private boards = new Map<string, Board>();

  constructor(private dir?: string) {
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    const loaded: Board[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      try {
        loaded.push(JSON.parse(readFileSync(join(dir, file), "utf8")) as Board);
      } catch (err) {
        console.warn(`showboard: skipped unreadable board ${file}: ${(err as Error).message}`);
      }
    }
    for (const board of loaded.sort((a, b) => a.at.localeCompare(b.at))) this.boards.set(board.id, board);
  }

  save(board: Board): void {
    this.boards.delete(board.id);
    this.boards.set(board.id, board);
    if (this.dir) writeFileSync(join(this.dir, `${board.id}.json`), JSON.stringify(board));
    while (this.boards.size > MAX_BOARDS) this.boards.delete(this.boards.keys().next().value!);
  }

  get(id: string): Board | undefined {
    return this.boards.get(id);
  }

  latest(): Board | null {
    return [...this.boards.values()].at(-1) ?? null;
  }

  /** Newest first. */
  list(): BoardSummary[] {
    return [...this.boards.values()].reverse().map(({ id, title, at }) => ({ id, title, at }));
  }
}
