export type Snap = {
  tokens?: number
  window: number
  percent?: number
  limits: { kind: string; percentUsed: number; resetsAt?: string }[]
  usd?: number
}

// the window autocompact measures against (the model's, or a smaller autoCompactWindow) and where it fires
export type Compact = { window: number; threshold?: number }

export type Level = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
// session: what the session's own setting sent on the last main-loop step; picked: the buttons', sent in its place;
// guess: the settings' effortLevel for the model, shown until the first step says
export type Effort = { session?: Level; picked?: Level; guess?: Level }

declare module 'claude-code' {
  interface PluginState {
    'usage-status': { snap: Snap | null; compact: Compact | null; effort: Effort; tick: number }
  }
}
