import { randomUUID } from "node:crypto";
import type { Board, Reply, ScreenReport, ServerMessage } from "../spec/types.js";

// The browser tabs showing the app. Each tab holds an event stream open and reports what
// it shows; the agent's requests go to the tab the user looked at last. Panes (a terminal
// pane, the pane beside an agent's chat) only watch: they get every board shown and are
// never asked anything.

/** A pane that polls instead of holding a stream counts as open this long after its last poll. */
const POLLED_PANE_MS = 10_000;

interface Tab {
  send(message: ServerMessage): void;
  report: ScreenReport | null;
  /** When the tab last reported focus; the most recent one is "the screen". */
  activeAt: number;
}

interface Pending {
  resolve(reply: Reply): void;
  timer: NodeJS.Timeout;
}

export class Hub {
  private tabs = new Map<string, Tab>();
  private pending = new Map<string, Pending>();
  private panes = new Map<string, { send?(message: ServerMessage): void; seenAt: number }>();
  /** The board shown last, so a pane or tab that opens later starts from it. */
  shown: Board | null = null;
  /** Goes up with every board shown, so a polling pane can tell a redraw from the same board. */
  shows = 0;

  /** A pane's event stream; it gets every board shown from now on. */
  watch(pane: string, send: (message: ServerMessage) => void): () => void {
    this.panes.set(pane, { send, seenAt: Date.now() });
    return () => {
      if (this.panes.get(pane)?.send === send) this.panes.delete(pane);
    };
  }

  /** A pane that polls says it is still open. */
  touch(pane: string): void {
    const existing = this.panes.get(pane);
    if (existing) existing.seenAt = Date.now();
    else this.panes.set(pane, { seenAt: Date.now() });
  }

  /** Open panes: those holding a stream, and those that polled lately. */
  get watching(): number {
    const now = Date.now();
    let count = 0;
    for (const [id, pane] of this.panes) {
      if (pane.send || now - pane.seenAt < POLLED_PANE_MS) count++;
      else this.panes.delete(id);
    }
    return count;
  }

  /** Puts a board on every pane and remembers it as the one on screen. */
  show(board: Board): void {
    this.shown = board;
    this.shows++;
    for (const pane of this.panes.values()) pane.send?.({ type: "board", board });
  }

  connect(tab: string, send: (message: ServerMessage) => void): () => void {
    const existing = this.tabs.get(tab);
    this.tabs.set(tab, { send, report: existing?.report ?? null, activeAt: existing?.activeAt ?? Date.now() });
    return () => {
      if (this.tabs.get(tab)?.send === send) this.tabs.delete(tab);
    };
  }

  report(report: ScreenReport): void {
    const tab = this.tabs.get(report.tab);
    if (!tab) return; // a report from a tab whose stream has closed
    tab.report = report;
    if (report.focused) tab.activeAt = Date.now();
  }

  get connected(): number {
    return this.tabs.size;
  }

  /** The tab the user looked at last, if any tab is open. */
  active(): { id: string; report: ScreenReport | null } | null {
    let best: [string, Tab] | null = null;
    for (const entry of this.tabs) if (!best || entry[1].activeAt > best[1].activeAt) best = entry;
    return best ? { id: best[0], report: best[1].report } : null;
  }

  broadcast(message: ServerMessage): void {
    for (const tab of this.tabs.values()) tab.send(message);
  }

  /**
   * Sends a message carrying a request id to the active tab (and `alsoBroadcast` to the
   * others) and waits for its reply. Resolves to null when no tab is open or none answers.
   */
  async request(make: (request: string) => ServerMessage, timeoutMs: number, alsoBroadcast = false): Promise<Reply | null> {
    const target = this.active();
    if (!target) return null;
    const request = randomUUID();
    const message = make(request);
    const reply = new Promise<Reply | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(request);
        resolve(null);
      }, timeoutMs);
      this.pending.set(request, { resolve, timer });
    });
    for (const [id, tab] of this.tabs) {
      if (id === target.id) tab.send(message);
      else if (alsoBroadcast) tab.send({ ...message, request: undefined } as ServerMessage);
    }
    return reply;
  }

  reply(reply: Reply): boolean {
    const pending = this.pending.get(reply.request);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pending.delete(reply.request);
    pending.resolve(reply);
    return true;
  }
}
