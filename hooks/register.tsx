import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Compact, Effort, Level, Snap } from '../types'

const snap = atom({ plugin: 'usage-status', key: 'snap' } as const, null)
const compact = atom({ plugin: 'usage-status', key: 'compact' } as const, null)
const effort = atom({ plugin: 'usage-status', key: 'effort' } as const, {} as Effort)
// bumped by the refresh button so the band redraws even when nothing it reads changed
const tick = atom({ plugin: 'usage-status', key: 'tick' } as const, 0)

const LEVELS: readonly Level[] = ['low', 'medium', 'high', 'xhigh', 'max']
const SHORT: Record<Level, string> = { low: 'low', medium: 'med', high: 'high', xhigh: 'xhigh', max: 'max' }
const isLevel = (v: unknown): v is Level => typeof v === 'string' && (LEVELS as readonly string[]).includes(v)

const k = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e5 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : `${n}`)
const tone = (p: number) => (p >= 85 ? '#e5534b' : p >= 60 ? '#d9a33a' : '#57b77a')

const left = (iso: string | undefined, now: number) => {
  if (!iso) return undefined
  const m = Math.max(0, Math.round((Date.parse(iso) - now) / 60000))
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m}m`
}

const ICON = {
  gauge: 'M2 12a6 6 0 1 1 12 0M8 12l3-3.5',
  cal: 'M3.5 3h9a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-8A1.5 1.5 0 0 1 3.5 3zM2 7h12M5 1.5v3M11 1.5v3',
  coin: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM9.8 6.2C9.4 5.6 8.8 5.4 8 5.4c-1 0-1.6.5-1.6 1.2 0 1.8 3.4.8 3.4 2.6 0 .8-.7 1.4-1.8 1.4-.8 0-1.5-.3-1.9-.9M8 4v8',
  ctx: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 2v6h6',
}

type Item = { icon: keyof typeof ICON } | { text: string; strong?: boolean } | { bar: number }

// ponytail: approx glyph widths for 15px semibold sans, scaled to FS; nudge if a pill crowds or gaps
const GW: Record<string, number> = {
  ' ': 4, '.': 4, '/': 5.5, '%': 12, M: 12, '↻': 11, '·': 4.5, k: 7.5, h: 8, m: 12.5, d: 8.3, c: 6.8, t: 4.8, x: 7.2, $: 8.2,
}
const FS = 13
const tw = (s: string, strong?: boolean) => [...s].reduce((w, c) => w + (GW[c] ?? 8.1), 0) * (FS / 15) * (strong ? 1.04 : 1)
const BAR = 56, PH = 30, GAP = 8
const FG = '#ececec', DIM = '#9a9a9a'
const FONT = "system-ui,-apple-system,'Segoe UI',sans-serif"

const pill = (x: number, color: string, items: Item[]) => {
  const mid = PH / 2
  let cx = x + 11
  let out = ''
  for (const it of items) {
    if ('icon' in it) {
      out += `<g transform="translate(${cx} ${mid - 7}) scale(.875)" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${ICON[it.icon]}"/></g>`
      cx += 14 + 7
    } else if ('text' in it) {
      out += `<text x="${cx}" y="${mid + 4.5}" fill="${it.strong ? FG : DIM}" font-weight="${it.strong ? 650 : 500}">${it.text}</text>`
      cx += tw(it.text, it.strong) + 7
    } else {
      const f = it.bar > 0 ? Math.max(4, Math.min(BAR, (it.bar / 100) * BAR)) : 0
      out += `<rect x="${cx}" y="${mid - 2}" width="${BAR}" height="4" rx="2" fill="#ffffff" fill-opacity=".12"/>`
      if (f) out += `<rect x="${cx}" y="${mid - 2}" width="${f}" height="4" rx="2" fill="${tone(it.bar)}"/>`
      cx += BAR + 8
    }
  }
  const w = Math.ceil(cx - x + 4)
  return { w, svg: `<rect x="${x}" y="0" width="${w}" height="${PH}" rx="${PH / 2}" fill="${color}" fill-opacity=".14"/>${out}` }
}

const tray = (s: Snap, now: number) => {
  const pills: { color: string; items: Item[] }[] = [
    // tokens are absent until a session's first reply: the pill shows 0 until then
    {
      color: '#3fc1d6',
      items: [{ icon: 'ctx' }, { bar: s.percent ?? 0 }, { text: `${Math.round(s.percent ?? 0)}%`, strong: true }, { text: `${k(s.tokens ?? 0)} / ${k(s.window)}` }],
    },
  ]
  for (const r of s.limits) {
    const isFive = r.kind === 'five_hour', isWeek = r.kind === 'seven_day'
    const eta = left(r.resetsAt, now)
    pills.push({
      color: isFive ? '#4cc98d' : isWeek ? '#a68bff' : '#f0a050',
      items: [
        { icon: isFive ? 'gauge' : isWeek ? 'cal' : 'coin' },
        { text: isFive ? '5h' : isWeek ? '7d' : '$' },
        { bar: r.percentUsed },
        { text: `${Math.round(r.percentUsed)}%`, strong: true },
        ...(eta ? [{ text: `↻ ${eta}` }] : []),
      ],
    })
  }
  if (s.usd !== undefined) pills.push({ color: '#f2c14e', items: [{ icon: 'coin' }, { text: `$${s.usd.toFixed(2)}`, strong: true }] })

  let body = '', x = 0
  for (const p of pills) {
    const r = pill(x, p.color, p.items)
    body += r.svg
    x += r.w + GAP
  }
  const W = Math.ceil(x - GAP)
  return { W, H: PH, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${PH}" viewBox="0 0 ${W} ${PH}" font-family="${FONT}" font-size="${FS}">${body}</svg>` }
}

const toSnap = (c: { tokens?: number; window: number; percent?: number }, rl: Snap['limits'], usd?: number): Snap => ({
  tokens: c.tokens, window: c.window, percent: c.percent, limits: rl, usd,
})

// limits are account-wide: cache the last reading so a fresh process shows them before its first reply
async function limitsFor($: EngineInterface, fresh: Snap['limits']) {
  if (fresh.length) {
    await $.store.set('limits', fresh)
    return fresh
  }
  const now = await $.clock.now()
  const cached = ((await $.store.get('limits')) ?? []) as Snap['limits']
  return cached.filter(r => !r.resetsAt || Date.parse(r.resetsAt) > now)
}

// the plain usage figures measure against the model's window; the breakdown knows the autocompact one
async function refreshCompact($: EngineInterface) {
  const b = (await $.session.usage({ breakdown: 'summary' })).context.breakdown
  if (!b) return
  const c: Compact = b.autoCompactThreshold === undefined ? { window: b.rawMaxTokens } : { window: b.rawMaxTokens, threshold: b.autoCompactThreshold }
  await update($, compact, () => c)
}

type ModelSettings = Record<string, { autoCompactWindow?: unknown; effortLevel?: unknown } | undefined>

// what decides the window and the default effort: the model and its settings. Cheap to read, so a
// timer compares it and runs the breakdown (a local estimate) only when it moved
async function fingerprint($: EngineInterface) {
  const model = await $.session.model()
  const all = (await $.settings.read()) as { autoCompactWindow?: unknown; effortLevel?: unknown; modelSettings?: ModelSettings }
  const own = all.modelSettings?.[model]
  const level = own?.effortLevel ?? all.effortLevel
  return { key: JSON.stringify([model, all.autoCompactWindow, own?.autoCompactWindow]), guess: isLevel(level) ? level : undefined }
}

const against = (s: Snap, c: Compact | null): Snap => {
  if (!c) return s
  return { ...s, window: c.window, percent: s.tokens === undefined ? undefined : Math.min(100, (s.tokens / c.window) * 100) }
}

let watch: { cancel: () => void } | undefined
let seen = ''

async function recheck($: EngineInterface) {
  const f = await fingerprint($)
  if (f.key === seen) return
  seen = f.key
  await refreshCompact($)
  await update($, effort, prev => (f.guess ? { ...prev, guess: f.guess } : prev))
}

// the refresh button: re-read usage, limits, the compaction window and the settings' effort now
async function refreshAll($: EngineInterface) {
  const u = await $.session.usage()
  const s = toSnap(u.context, await limitsFor($, u.rateLimits), u.cost?.usd)
  await update($, snap, () => s)
  await refreshCompact($)
  const f = await fingerprint($)
  seen = f.key
  await update($, effort, prev => (f.guess ? { ...prev, guess: f.guess } : prev))
  await update($, tick, n => n + 1)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    $.ui.status(undefined) // clear v1's status-line text
    const u = await $.session.usage()
    const s = toSnap(u.context, await limitsFor($, u.rateLimits), u.cost?.usd)
    await update($, snap, () => s)
    const result = await next(e)
    await refreshCompact($)
    const f = await fingerprint($)
    seen = f.key
    await update($, effort, prev => (f.guess ? { ...prev, guess: f.guess } : prev))
    // a model switch or a settings edit (autoCompactWindow) shows within 30s, reply or not
    watch?.cancel()
    watch = $.clock.every(30_000, () => void recheck($))
    return result
  })
  on('session.measure', async ($, e, next) => {
    const s = toSnap(e.context, await limitsFor($, e.rateLimits), e.cost?.usd)
    await update($, snap, () => s)
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await refreshCompact($)
    return next(e)
  })

  // sends the picked level on each main-loop request; a change to the session's own
  // setting (the app's picker, /effort) drops the pick
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined || e.effort === undefined) return yield* next(e)
    const own = isLevel(e.effort) ? e.effort : undefined
    const now = await update($, effort, prev => {
      const isChangedElsewhere = own !== undefined && prev.session !== undefined && prev.session !== own
      const kept: Effort = prev.guess ? { guess: prev.guess } : {}
      if (own) kept.session = own
      if (prev.picked && !isChangedElsewhere) kept.picked = prev.picked
      return kept
    })
    return yield* next(now.picked === undefined ? e : { ...e, effort: now.picked })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const raw = await read($, snap)
    if (e.props.hasSurvey || raw === null) return next(e)
    const s = against(raw, await read($, compact))
    await read($, tick)
    const { session, picked, guess } = await read($, effort)
    const level = picked ?? session ?? guess
    const pick = (to: Level) => update($, effort, prev => ({ ...prev, picked: to }))
    const refresh = () => refreshAll($)

    if (e.surface === 'desktop') {
      const { Box, Button, Svg, Text } = $.ui.resolve({ component: e.component, surface: e.surface })
      const { W, H, svg } = tray(s, await $.clock.now())
      return (
        <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={2} rowGap={1}>
          <Svg source={svg} width={W} height={H} alt="Context, usage limits and cost" />
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Text dimColor>effort</Text>
            {LEVELS.map(l => (
              <Button key={`effort-${l}`} label={SHORT[l]} variant={l === level ? 'primary' : 'secondary'} dimColor={l !== level} onPress={() => pick(l)} />
            ))}
            <Button key="refresh" label="↻" variant="secondary" dimColor onPress={refresh} />
          </Box>
        </Box>
      )
    }

    // terminal: plain text (the band draws on terminal and desktop only)
    if (e.surface !== 'terminal') return next(e)
    const { Box, Button, Text } = $.ui.resolve({ component: e.component, surface: e.surface })
    const parts = [
      `ctx ${Math.round(s.percent ?? 0)}% of ${k(s.window)}`,
      ...s.limits.map(r => `${r.kind === 'five_hour' ? '5h' : r.kind === 'seven_day' ? '7d' : r.kind} ${Math.round(r.percentUsed)}%`),
      s.usd === undefined ? undefined : `$${s.usd.toFixed(2)}`,
    ].filter(Boolean)
    return (
      <Box paddingX={1} flexDirection="row" flexWrap="wrap" justifyContent="space-between" columnGap={2}>
        <Text dimColor>{parts.join(' · ')}</Text>
        <Box flexDirection="row" gap={1}>
          <Text dimColor>effort</Text>
          {LEVELS.map(l => (
            <Button key={`effort-${l}`} label={SHORT[l]} plain dimColor={l !== level} onPress={() => pick(l)} />
          ))}
          <Button key="refresh" label="↻" plain dimColor onPress={refresh} />
        </Box>
      </Box>
    )
  })
}
