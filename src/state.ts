/**
 * What the updater remembers between cycles, in `<dataDir>/state.json`: the last survey, every
 * verdict, every build and cycle. Written atomically (temp file, then rename), so a container
 * killed mid-write never leaves a broken file.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { Consumer } from './survey'

export interface TriageRecord {
  issue: number
  title: string
  at: string
  verdict: 'accepted' | 'rejected' | 'needs-human'
  kind: string
  reason: string
  /** Whether the verdict was posted (triage/full mode) or only logged (observe). */
  posted: boolean
  costUsd?: number
}

export interface BuildRecord {
  at: string
  issues: number[]
  code: number
  minutes: number
  log: string
}

export interface State {
  cycle: { lastStart?: string; lastOk?: string; lastError?: string }
  survey?: { at: string; consumers: Consumer[] }
  triage: TriageRecord[]
  builds: BuildRecord[]
  /** Hash of the harness clone's lockfile at its last `pnpm install`. */
  harnessLockfile?: string
}

const empty = (): State => ({ cycle: {}, triage: [], builds: [] })

export const stateFile = (dataDir: string) => path.join(dataDir, 'state.json')

export function readState(dataDir: string): State {
  const file = stateFile(dataDir)
  if (!existsSync(file)) return empty()
  try {
    return { ...empty(), ...(JSON.parse(readFileSync(file, 'utf8')) as Partial<State>) }
  } catch {
    return empty()
  }
}

export function writeState(dataDir: string, state: State) {
  mkdirSync(dataDir, { recursive: true })
  const file = stateFile(dataDir)
  const tmp = `${file}.${process.pid}.tmp`
  // Bounded history: the newest 500 verdicts and 200 builds.
  const trimmed: State = {
    ...state,
    triage: state.triage.slice(-500),
    builds: state.builds.slice(-200),
  }
  writeFileSync(tmp, `${JSON.stringify(trimmed, null, 2)}\n`)
  renameSync(tmp, file)
}

/** Builds started in the 24 hours before `now`. */
export function buildsToday(state: State, now: number): number {
  return state.builds.filter((b) => now - Date.parse(b.at) < 24 * 3_600_000).length
}
