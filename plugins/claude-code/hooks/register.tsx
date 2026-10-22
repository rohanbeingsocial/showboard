import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ShowboardPane } from '../types'
import { boardToText, INKS, type Block, type Ink, type Line, type TextBoard } from './board-text.js'

// The board Showboard shows last, in a pane beside the chat, drawn as text. Showboard runs
// beside Claude Code (its MCP server, or an app that mounts it); this pane asks it every
// couple of seconds what is on screen, and right after Claude calls draw, recipe or
// show_board. A new board opens the pane where the terminal has room for it; /board opens
// it anywhere.

const PANE = 'showboard'
const POLL_MS = 2000
/** Rows kept per dataset: a pane draws a dozen table rows and a few hundred chart points. */
const MAX_ROWS = 2000
const BOARD_TOOL = /^mcp__.+__(draw|recipe|show_board)$/
const THEME: Partial<Record<Ink, string>> = { accent: 'claude', good: 'success', bad: 'error', warn: 'warning', info: 'suggestion' }

const INITIAL: ShowboardPane = { url: 'http://127.0.0.1:4710', online: false, board: null, shows: -1, picked: false, sources: false, format: null, page: false }
const pane = atom({ plugin: 'showboard', key: 'pane' } as const, INITIAL)

type Health = { ok: boolean; board: string | null; shows: number; page?: boolean }

/** When the poll under way started: one at a time, unless one has hung past STUCK_MS. */
let pollingSince = 0
const STUCK_MS = 5000

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'board', description: "Show Showboard's boards in a pane beside the chat" })
    const given = typeof options.url === 'string' ? options.url.trim() : ''
    const url = (given || (await fromMcpJson($)) || INITIAL.url).replace(/\/$/, '')
    await update($, pane, s => ({ ...s, url }))
    void poll($, false)
    $.clock.every(POLL_MS, () => void poll($, true))

    return next(e)
  })

  on('command.run', { command: 'board' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Board' })
    await poll($, false, true)

    return { text: 'Showboard pane opened.' }
  })

  // Right after a board tool runs, catch up at once instead of on the next poll: a few local
  // requests, made before the result goes back to Claude.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (BOARD_TOOL.test(String(e.tool))) await poll($, true, true)

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const s = await read($, pane)
    const width = Math.max(24, e.props.bodyColumns || 60)
    const color = (ink?: Ink) => (ink && ink !== 'muted' ? (THEME[ink] ?? INKS[ink]) : undefined)
    const line = (l: Line) => (
      <Text wrap="truncate">
        {l.length ? l.map(span => <Text color={color(span.ink)} bold={span.bold} dimColor={span.dim || span.ink === 'muted'}>{span.text}</Text>) : ' '}
      </Text>
    )

    if (!s.board) {
      return (
        <Box flexDirection="column">
          <Text bold color="claude">Showboard</Text>
          <Text dimColor>{s.online ? 'No boards yet. Ask Claude to show you something.' : `Waiting for Showboard at ${s.url}.`}</Text>
          {s.online ? null : <Text dimColor>It starts with Claude Code once this folder has it (showboard init), or with showboard serve.</Text>}
        </Box>
      )
    }

    const board = s.board as unknown as TextBoard
    const blocks: Block[] = boardToText(board, { width, format: s.format ?? {}, sources: s.sources })
    const status = [when(board.at), s.picked ? 'an older board' : '', s.online ? '' : 'Showboard is not answering'].filter(Boolean).join(' · ')
    let button = 0

    return (
      <Box flexDirection="column">
        <Text bold wrap="truncate">{board.title}</Text>
        <Text dimColor wrap="truncate">{status || ' '}</Text>
        <Text> </Text>
        {blocks.map(block =>
          block.kind === 'text' ? (
            <Box flexDirection="column">{block.lines.map(line)}</Box>
          ) : (
            <Button key={`action-${++button}`} label={block.label} onPress={() => void act($, s.url, block)} />
          ),
        )}
        <Text> </Text>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Button key="older" label="Older" onPress={() => void step($, 1)} />
          <Button key="newer" label="Newer" onPress={() => void step($, -1)} />
          <Button key="sources" label={s.sources ? 'Hide sources' : 'Sources'} onPress={() => void update($, pane, p => ({ ...p, sources: !p.sources }))} />
          {s.page ? <Link href={s.url} label="Open in browser" /> : null}
        </Box>
      </Box>
    )
  })
}

/**
 * Catches up with the board on screen; `announce` opens the pane for one shown since. The
 * timer's polls wait their turn; one a person or a tool call asked for goes at once.
 */
async function poll($: EngineInterface, announce: boolean, now = false): Promise<void> {
  const started = Date.now()
  if (!now && started - pollingSince < STUCK_MS) return
  pollingSince = started
  try {
    const s = (await $.state.get({ plugin: 'showboard', key: 'pane' })).value ?? INITIAL
    const health: Health | null = await getJson($, `${s.url}/health?pane=claude-code`)
    if (!health?.ok) {
      if (s.online) await update($, pane, p => ({ ...p, online: false }))
      return
    }
    const format = s.online && s.format ? s.format : await readFormat($, s.url)
    const page = health.page === true
    if (health.shows === s.shows && s.board) {
      if (!s.online) await update($, pane, p => ({ ...p, online: true, format, page }))
      return
    }
    // The board on screen; before any is shown, the newest one saved.
    const saved: { id: string }[] | null = health.board ? null : await getJson($, `${s.url}/boards`)
    const id = health.board ?? saved?.[0]?.id
    const board: TextBoard | null = id ? await getJson($, `${s.url}/boards/${encodeURIComponent(id)}`) : null
    const fresh = s.shows >= 0 && health.shows > s.shows
    await update($, pane, p => ({ ...p, online: true, format, page, shows: health.shows, ...(board ? { board: trim(board), picked: false } : {}) }))
    if (announce && fresh && board) await $.ui.open({ id: PANE, title: 'Board' })
  } catch {
    // A poll the session no longer wants (it ended, or the mod reloaded); the next one tries again.
  } finally {
    if (pollingSince === started) pollingSince = 0
  }
}

/** Older (1) or newer (-1) among the saved boards. */
async function step($: EngineInterface, by: number): Promise<void> {
  const s = (await $.state.get({ plugin: 'showboard', key: 'pane' })).value ?? INITIAL
  const list: { id: string }[] | null = await getJson($, `${s.url}/boards`)
  if (!list?.length) return
  const at = list.findIndex(b => b.id === (s.board as { id?: string } | null)?.id)
  const target = list[Math.min(list.length - 1, Math.max(0, (at < 0 ? 0 : at) + by))]!
  const board: TextBoard | null = await getJson($, `${s.url}/boards/${encodeURIComponent(target.id)}`)
  if (board) await update($, pane, p => ({ ...p, board: trim(board), picked: target.id !== list[0]!.id }))
}

/** A board's button: the app's action, run in its browser tab through ui_act. */
async function act($: EngineInterface, url: string, block: Extract<Block, { kind: 'action' }>): Promise<void> {
  try {
    const res = await $.http.fetch(`${url}/tools/ui_act`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: block.action, input: block.input }) })
    const out = JSON.parse(res.text) as { ok?: boolean; content?: string }
    const result = JSON.parse(out.content ?? '{}') as { error?: string }
    $.ui.toast(out.ok ? `${block.label}: done in the app` : `${block.label}: ${result.error ?? 'did not run'}`)
  } catch (err) {
    $.ui.toast(`${block.label}: ${(err as Error).message}`)
  }
}

/**
 * A JSON answer from Showboard, or null. Untyped: Anthropic's plugin directory refuses a type
 * argument on a call that passes `$`, so each caller declares the type it reads.
 */
async function getJson($: EngineInterface, url: string): Promise<any> {
  try {
    const res = await $.http.fetch(url)
    return res.ok ? JSON.parse(res.text) : null
  } catch {
    return null
  }
}

/** How the board page prints numbers, which describe_data reports. */
async function readFormat($: EngineInterface, url: string): Promise<ShowboardPane['format']> {
  try {
    const res = await $.http.fetch(`${url}/tools/describe_data`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    const out = JSON.parse(res.text) as { content?: string }
    return (JSON.parse(out.content ?? '{}') as { format?: ShowboardPane['format'] }).format ?? {}
  } catch {
    return {}
  }
}

/** Where this folder's Showboard answers, from the server .mcp.json starts. */
async function fromMcpJson($: EngineInterface): Promise<string | null> {
  try {
    const config = JSON.parse(await $.fs.read('.mcp.json')) as { mcpServers?: Record<string, { args?: string[] }> }
    for (const [name, server] of Object.entries(config.mcpServers ?? {})) {
      const args = server.args ?? []
      if (name !== 'showboard' && !args.some(a => a.includes('showboard'))) continue
      const flag = (f: string) => {
        const i = args.indexOf(f)
        return i >= 0 ? args[i + 1] : undefined
      }
      return flag('--url') ?? `http://127.0.0.1:${flag('--port') ?? 4710}`
    }
  } catch {
    // No .mcp.json here, or one that is not JSON.
  }
  return null
}

/** The board as JSON the pane can keep, each dataset cut to MAX_ROWS rows. */
function trim(board: TextBoard): ShowboardPane['board'] {
  const datasets = Object.fromEntries(Object.entries(board.datasets).map(([name, d]) => [name, d.rows.length > MAX_ROWS ? { ...d, rows: d.rows.slice(0, MAX_ROWS), truncated: true } : d]))
  return JSON.parse(JSON.stringify({ ...board, datasets })) as ShowboardPane['board']
}

function when(at: string): string {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ')
  }
}
