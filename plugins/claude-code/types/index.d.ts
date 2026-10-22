/** JSON, as the pane keeps it: a board exactly as Showboard serves it. */
export type ShowboardJson = string | number | boolean | null | readonly ShowboardJson[] | { readonly [key: string]: ShowboardJson };

export type ShowboardPane = {
  /** Where Showboard answers. */
  url: string;
  online: boolean;
  /** The board in the pane, as GET /boards/:id serves it. */
  board: { readonly [key: string]: ShowboardJson } | null;
  /** Showboard's count of boards shown, when the pane last caught up. */
  shows: number;
  /** A board picked with Older/Newer, kept until the agent shows another. */
  picked: boolean;
  sources: boolean;
  /** How numbers print, from describe_data. */
  format: { readonly locale?: string; readonly currency?: string } | null;
  /** Whether the server also serves its board page at the URL. */
  page: boolean;
};

declare module 'claude-code' {
  interface PluginState {
    showboard: { pane: ShowboardPane }
  }
}
