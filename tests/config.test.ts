import { describe, expect, it } from 'vitest'

import { loadConfig, parseFileConfig, parseMode } from '../src/config'

describe('config', () => {
  it('fills in every default and reads the mode from the environment', () => {
    const cfg = loadConfig({
      UPDATER_CONFIG: '/nonexistent.json',
      UPDATER_DATA: '/data',
      UPDATER_HOST_PROJECTS: '/h',
    })
    expect(cfg).toMatchObject({
      owner: 'Eemelinen',
      harnessRepo: 'Eemelinen/harness',
      consumers: null,
      hostProjects: '/h',
      mode: 'observe',
      dataDir: '/data',
      triage: { maxPerCycle: 3, maxBudgetUsd: 2 },
      build: { maxPerDay: 4 },
    })
  })

  it('rejects an unknown mode and a bad repository name', () => {
    expect(() => parseMode('yolo')).toThrow(/observe, triage, full/)
    expect(() => parseFileConfig({ harnessRepo: 'not a repo' })).toThrow(/invalid/)
  })
})
