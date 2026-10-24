import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildable, buildDecision, intakeGate } from '../src/build'
import type { Issue } from '../src/github'
import { healthy, releaseLock, seenUnchanged, takeLock } from '../src/main'
import type { State } from '../src/state'

const tmp = () => mkdtempSync(path.join(tmpdir(), 'updater-'))

const accepted = (n: number, extra: string[] = []): Issue => ({
  number: n,
  title: 't',
  body: '',
  url: 'u',
  state: 'OPEN',
  author: { login: 'Eemelinen' },
  labels: ['harness-retro', 'updater:accepted', ...extra].map((name) => ({ name })),
  comments: [],
  createdAt: '2026-10-24T08:00:00Z',
  updatedAt: '2026-10-24T08:00:00Z',
})

describe('build', () => {
  const base = { mode: 'full', accepted: 1, buildsToday: 0, maxPerDay: 4, gate: 'updater:accepted' }

  it('builds an accepted issue only in full mode, behind the gate and the daily cap', () => {
    expect(buildDecision(base).build).toBe(true)
    expect(buildDecision({ ...base, mode: 'triage' })).toEqual({
      build: false,
      reason: 'mode triage does not build',
    })
    expect(buildDecision({ ...base, accepted: 0 }).build).toBe(false)
    expect(buildDecision({ ...base, buildsToday: 4 }).reason).toMatch(/maxPerDay 4/)
  })

  it('refuses to start the harness loop while its intake is not gated', () => {
    expect(buildDecision({ ...base, gate: undefined }).reason).toMatch(/retro.intakeLabel is unset/)
    const dir = tmp()
    writeFileSync(
      path.join(dir, 'harness.config.json'),
      JSON.stringify({ retro: { intake: true } }),
    )
    expect(intakeGate(dir)).toBeUndefined()
    writeFileSync(
      path.join(dir, 'harness.config.json'),
      JSON.stringify({ retro: { intakeLabel: 'updater:accepted' } }),
    )
    expect(intakeGate(dir)).toBe('updater:accepted')
  })

  it('counts accepted issues that are not queued yet', () => {
    expect(
      buildable([accepted(1), accepted(2, ['harness-retro:queued'])]).map((i) => i.number),
    ).toEqual([1])
  })
})

describe('state and health', () => {
  it('is healthy while cycles finish, or while a long cycle is still running', () => {
    const now = Date.parse('2026-10-25T12:00:00Z')
    const s = (lastOk?: string, lastStart?: string): State => ({
      cycle: { lastOk, lastStart },
      triage: [],
      builds: [],
    })
    expect(healthy(s('2026-10-25T11:40:00Z'), now, 10, false)).toBe(true)
    expect(healthy(s('2026-10-25T10:00:00Z'), now, 10, false)).toBe(false)
    expect(healthy(s('2026-10-25T08:00:00Z', '2026-10-25T09:00:00Z'), now, 10, true)).toBe(true)
    expect(healthy(s(undefined, '2026-10-25T01:00:00Z'), now, 10, true)).toBe(false)
  })

  it('waits in observe mode until a logged issue changes', () => {
    const state: State = {
      cycle: {},
      triage: [
        {
          issue: 1,
          title: 't',
          at: '2026-10-25T10:00:00Z',
          verdict: 'accepted',
          kind: 'harness',
          reason: 'r',
          posted: false,
        },
      ],
      builds: [],
    }
    expect(seenUnchanged(state, { ...accepted(1), updatedAt: '2026-10-25T09:00:00Z' })).toBe(true)
    expect(seenUnchanged(state, { ...accepted(1), updatedAt: '2026-10-25T11:00:00Z' })).toBe(false)
  })

  it('lets one cycle hold the lock at a time', () => {
    const dir = tmp()
    mkdirSync(dir, { recursive: true })
    expect(takeLock(dir)).toBe(true)
    writeFileSync(path.join(dir, 'cycle.lock'), '1') // pid 1 is alive: another cycle
    expect(takeLock(dir)).toBe(false)
    releaseLock(dir)
    expect(takeLock(dir)).toBe(true)
    writeFileSync(path.join(dir, 'cycle.lock'), '99999999') // a pid that is gone
    expect(takeLock(dir)).toBe(true)
  })
})
