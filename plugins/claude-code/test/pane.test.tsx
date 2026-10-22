import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

// A Showboard that answers from memory: one board on screen, with a headline number, bars, a
// note and a button. Nothing sits beneath the plugin, so these hooks stand for the engine.

const BOARD = {
  id: 'b_1',
  title: 'Revenue by region',
  at: '2026-10-22T08:00:00.000Z',
  spec: {
    root: 'root',
    elements: {
      root: { type: 'Grid', props: { columns: 1 }, children: ['m', 'bars', 'note', 'go'] },
      m: { type: 'Metric', props: { label: 'Revenue', dataset: 'totals', field: 'revenue', format: 'currency' } },
      bars: { type: 'BarChart', props: { dataset: 'regions', x: 'region', y: ['revenue'], title: 'By region', format: 'currency' } },
      note: { type: 'Note', props: { text: '- **North** leads.', tone: 'good' } },
      go: { type: 'ActionButton', props: { label: 'Open North', action: 'open_region', input: { region: 'North' } } },
    },
  },
  datasets: {
    totals: { name: 'totals', columns: [{ name: 'revenue', type: 'number' }], rows: [{ revenue: 1410 }], truncated: false, origin: 'select sum(amount) as revenue from orders', at: '2026-10-22T08:00:00.000Z' },
    regions: {
      name: 'regions',
      columns: [{ name: 'region', type: 'text' }, { name: 'revenue', type: 'number' }],
      rows: [{ region: 'North', revenue: 870 }, { region: 'South', revenue: 540 }],
      truncated: false,
      origin: 'select region, sum(amount) as revenue from orders group by region',
      at: '2026-10-22T08:00:00.000Z',
    },
  },
}

/** /board, typed at the prompt of a fullscreen terminal. */
const BOARD_COMMAND = { command: 'board', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

const PANE = {
  plugin: 'showboard',
  component: 'Pane',
  requestId: 'showboard',
  props: { title: 'Board', isFocused: false, bodyColumns: 48, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

function showboard(on: On, calls: string[], toasts: string[]) {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'board' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.every', () => ({ deny: 'no timers in tests' }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  // The folder's .mcp.json starts Showboard on port 4799.
  on('fs.read', () => ({ value: JSON.stringify({ mcpServers: { showboard: { command: 'npx', args: ['-y', 'showboard', 'mcp', '--port', '4799'] } } }) }))
  on('http.fetch', (_, e) => {
    calls.push(e.url)
    const ok = (body: unknown) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } })
    const path = e.url.replace('http://127.0.0.1:4799', '')
    if (path.startsWith('/health')) return ok({ ok: true, board: 'b_1', shows: 1, page: true })
    if (path === '/tools/describe_data') return ok({ ok: true, content: JSON.stringify({ format: { locale: 'en-US', currency: 'USD' } }) })
    if (path === '/boards/b_1') return ok(BOARD)
    if (path === '/boards') return ok([{ id: 'b_1', title: BOARD.title, at: BOARD.at }])
    if (path === '/tools/ui_act') return ok({ ok: false, content: JSON.stringify({ error: 'No browser has the app open, so nothing is on screen yet.' }) })
    return { value: { status: 404, ok: false, headers: {}, text: '{}' } }
  })
}

test('the pane draws the board on screen, on every surface', async ($, on) => {
  const calls: string[] = []
  showboard(on, calls, [])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(BOARD_COMMAND)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Revenue by region/ }))?.text).toBe('Revenue by region')
    expect((await ui.find({ type: 'Text', text: /\$1,410/ }))?.text).toContain('$1,410')
    expect((await ui.find({ type: 'Text', text: /North\s+█+.*\$870/ }))?.text).toMatch(/North/)
    expect((await ui.find({ type: 'Text', text: /North leads/ }))?.text).toContain('North leads.')
    expect((await ui.find({ type: 'Button', key: 'action-1' }))?.props).toMatchObject({ label: 'Open North' })
    await ui.unmount()
  }
  expect(calls.every(url => url.startsWith('http://127.0.0.1:4799/'))).toBe(true)
})

test("a board's button runs the app's action and says what happened", async ($, on) => {
  const toasts: string[] = []
  showboard(on, [], toasts)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(BOARD_COMMAND)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'action-1' })
  expect(toasts).toEqual(['Open North: No browser has the app open, so nothing is on screen yet.'])
  await ui.unmount()
})
