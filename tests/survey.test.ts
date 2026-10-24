import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildsToday, readState, writeState, type State } from '../src/state'
import { consumerFacts, harnessPin, localRuns, pinnedVersion, surveyTable } from '../src/survey'

const tmp = () => mkdtempSync(path.join(tmpdir(), 'updater-'))

describe('survey', () => {
  it('reads the pin and the rollout settings of a consumer', () => {
    const pkg = { devDependencies: { '@eemelinen/harness': 'github:Eemelinen/harness#v0.3.1' } }
    const config = {
      merge: 'auto',
      update: { auto: true },
      retro: { intake: true, every: 3 },
      guard: { bash: [{}, {}], paths: [{}] },
      allowedTools: ['a', 'b'],
    }
    expect(consumerFacts('Eemelinen/metsavahti', 'main', pkg, config)).toEqual({
      repo: 'Eemelinen/metsavahti',
      defaultBranch: 'main',
      pin: 'github:Eemelinen/harness#v0.3.1',
      version: '0.3.1',
      update: { auto: true, canary: true },
      merge: 'auto',
      retro: { intake: true, every: 3, onQueueEmpty: false },
      guardRules: 3,
      allowedTools: 2,
      problems: [],
    })
    expect(consumerFacts('o/r', 'main', pkg, undefined).problems).toEqual([
      'no harness.config.json on the default branch',
    ])
  })

  it('tells a consumer from a repository that does not use the harness', () => {
    expect(harnessPin({ dependencies: { '@eemelinen/harness': 'link:../harness' } })).toBe(
      'link:../harness',
    )
    expect(harnessPin({ devDependencies: { zod: '4' } })).toBeUndefined()
    expect(pinnedVersion('link:../harness')).toBeUndefined()
  })

  it('summarises a local runs.jsonl by harness version', () => {
    const text = [
      JSON.stringify({
        ts: '2026-10-24T07:00:00Z',
        feature: 'F-010',
        outcome: 'merged',
        harness: '0.3.0',
      }),
      'broken line',
      JSON.stringify({
        ts: '2026-10-24T09:00:00Z',
        feature: 'harness',
        outcome: 'updated',
        harness: '0.3.1',
      }),
    ].join('\n')
    expect(localRuns(text)).toEqual({
      runs: 2,
      lastRun: {
        ts: '2026-10-24T09:00:00Z',
        feature: 'harness',
        outcome: 'updated',
        harness: '0.3.1',
      },
      versions: { '0.3.0': 1, '0.3.1': 1 },
    })
  })

  it('prints a table row per consumer', () => {
    const facts = consumerFacts(
      'o/r',
      'main',
      { devDependencies: { '@eemelinen/harness': 'github:x#v0.3.1' } },
      {},
    )
    const table = surveyTable([{ ...facts, ci: 'success', openRetroIssues: 1 }])
    expect(table).toContain(
      '| o/r | v0.3.1 | by hand | wait | no | success | 1 | not on this machine | — |',
    )
    expect(surveyTable([])).toMatch(/No repository/)
  })
})

describe('state', () => {
  it('round-trips the state and counts builds of the last 24 hours', () => {
    const dir = tmp()
    const now = Date.parse('2026-10-25T12:00:00Z')
    const state: State = {
      cycle: { lastOk: '2026-10-25T11:55:00Z' },
      triage: [],
      builds: [
        { at: '2026-10-25T10:00:00Z', issues: [1], code: 0, minutes: 30, log: 'l' },
        { at: '2026-10-24T10:00:00Z', issues: [2], code: 0, minutes: 30, log: 'l' },
      ],
    }
    writeState(dir, state)
    expect(readState(dir)).toEqual(state)
    expect(buildsToday(state, now)).toBe(1)
    expect(readState(tmp())).toEqual({ cycle: {}, triage: [], builds: [] })
  })
})
