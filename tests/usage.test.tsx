import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'usage-status',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 160, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const STEP = { turnId: 't', index: 0, model: 'claude-opus-5', messageCount: 1 } as const

// a 1M model with autoCompactWindow 400000: the plain figures say 1M, the breakdown 400k
const breakdown = { rawMaxTokens: 400_000, autoCompactThreshold: 367_000 }
const SETTINGS = { modelSettings: { 'claude-opus-5': { autoCompactWindow: 400_000, effortLevel: 'high' } } }

type On = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[1]

function engine(on: On, context: { tokens?: number; window: number; percent?: number }) {
  const sent: unknown[] = []
  const live = { context }
  mock.clock(on)
  mock.store(on)
  on('ui.status', () => ({ value: undefined }) as never)
  on('session.usage', (_, args) => ({
    value: { startedAt: 0, context: args?.breakdown ? { ...live.context, breakdown } : live.context, rateLimits: [], cost: { usd: 5.64 } },
  }) as never)
  on('session.model', () => ({ value: 'claude-opus-5' }) as never)
  on('settings.read', () => ({ value: SETTINGS }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.step', async function* (_, e) {
    sent.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return Object.assign(sent, { live })
}

test('ctx against the autocompact window, and effort buttons that set what is sent', async ($, on) => {
  const sent = engine(on, { tokens: 120_000, window: 1_000_000, percent: 12 })
  const send = async (effort: 'low' | 'high' | 'xhigh' | 'max') => {
    for await (const _ of $.turn.step({ ...STEP, effort })) {
    }
  }
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svg = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(svg).toContain('120k / 400k')
  expect(svg).toContain('>30%<')
  expect(svg).toContain('$5.64')

  // before any reply: the settings' level for the model
  expect((await ui.find({ key: 'effort-high' }))?.props.variant).toBe('primary')

  // the session's own level, once a request shows it
  await send('xhigh')
  expect((await ui.find({ key: 'effort-xhigh' }))?.props.variant).toBe('primary')
  expect((await ui.find({ key: 'effort-high' }))?.props.variant).toBe('secondary')

  // a press picks; the next request carries it
  await ui.press({ key: 'effort-low' })
  expect((await ui.find({ key: 'effort-low' }))?.props.variant).toBe('primary')
  await send('xhigh')
  expect(sent.at(-1)).toBe('low')

  // the app's own picker moving drops the pick
  await send('max')
  expect(sent.at(-1)).toBe('max')
  expect((await ui.find({ key: 'effort-max' }))?.props.variant).toBe('primary')
  await ui.unmount()

  // the terminal: text summary and the same buttons
  const tui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await tui.find({ type: 'Text', text: /ctx 30% of 400k · \$5\.64/ })).toBeDefined()
  await tui.press({ key: 'effort-medium' })
  await send('max')
  expect(sent.at(-1)).toBe('medium')
  await tui.unmount()
})

test('a new session shows ctx before its first reply', async ($, on) => {
  engine(on, { window: 1_000_000 })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svg = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(svg).toContain('0 / 400k')
  expect(svg).toContain('>0%<')
  await ui.unmount()
})

test('the refresh button re-reads usage straight away', async ($, on) => {
  const sent = engine(on, { window: 1_000_000 })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('0 / 400k')

  sent.live.context = { tokens: 200_000, window: 1_000_000, percent: 20 }
  await ui.press({ key: 'refresh' })
  const svg = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(svg).toContain('200k / 400k')
  expect(svg).toContain('>50%<')
  expect((await ui.find({ key: 'effort-high' }))?.props.variant).toBe('primary')
  await ui.unmount()
})
