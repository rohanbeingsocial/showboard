import { Board, BoardList } from "showboard/react";

export function BoardPage() {
  return (
    <div className="board-page">
      <Board
        className="board"
        empty={
          <div className="hint">
            <h2>Nothing on the board yet</h2>
            <p>
              Open Claude Code in <code>examples/sales-demo</code> and ask something like
            </p>
            <blockquote>Show me my best-selling product of 2026, and how it compares with last year.</blockquote>
          </div>
        }
      />
      <aside className="history">
        <h3>Earlier boards</h3>
        <BoardList />
      </aside>
    </div>
  );
}
