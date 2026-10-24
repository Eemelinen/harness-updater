/**
 * The survey: which repositories use the harness, and how. Deterministic facts only (no model),
 * gathered each cycle and handed to every triage session as a table, so a verdict can say per
 * consumer whether an issue affects it.
 *
 * Facts come from each consumer's default branch on GitHub (package.json, harness.config.json, the
 * newest CI run, its open retro issues) and, for projects on this machine, from the read-only mount
 * of their checkout (`.harness/runs.jsonl`).
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { defaultBranchCi, listIssues, listRepos, repoFile } from './github'

export const PACKAGE = '@eemelinen/harness'

export interface Consumer {
  repo: string
  defaultBranch: string
  /** The package specifier, e.g. `github:Eemelinen/harness#v0.3.1`. */
  pin?: string
  /** The pinned version without the `v`, when the pin names a release tag. */
  version?: string
  update: { auto: boolean; canary: boolean }
  merge: string
  retro: { intake: boolean; every: number; onQueueEmpty: boolean }
  guardRules: number
  allowedTools: number
  ci?: string
  openRetroIssues: number
  /** From the checkout on this machine, when it is mounted. */
  local?: {
    runs: number
    lastRun?: { ts: string; feature: string; outcome: string; harness?: string }
    versions: Record<string, number>
  }
  /** What could not be read (missing files, invalid JSON). */
  problems: string[]
}

type Json = Record<string, unknown>
const obj = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/** The package specifier of the harness in a package.json, if it depends on it. */
export function harnessPin(packageJson: unknown): string | undefined {
  const pkg = obj(packageJson)
  const spec = obj(pkg.devDependencies)[PACKAGE] ?? obj(pkg.dependencies)[PACKAGE]
  return typeof spec === 'string' ? spec : undefined
}

export function pinnedVersion(pin: string | undefined): string | undefined {
  return pin ? /#v?(\d+\.\d+\.\d+)$/.exec(pin)?.[1] : undefined
}

/** Counts and outcomes from a project's runs.jsonl. */
export function localRuns(text: string): NonNullable<Consumer['local']> {
  const records = text
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [
          JSON.parse(line) as { ts: string; feature: string; outcome: string; harness?: string },
        ]
      } catch {
        return []
      }
    })
  const versions: Record<string, number> = {}
  for (const r of records) versions[r.harness ?? '?'] = (versions[r.harness ?? '?'] ?? 0) + 1
  const last = records.at(-1)
  return {
    runs: records.length,
    lastRun: last && {
      ts: last.ts,
      feature: last.feature,
      outcome: last.outcome,
      harness: last.harness,
    },
    versions,
  }
}

/** The facts the survey derives from a consumer's files (pure; the I/O is in survey()). */
export function consumerFacts(
  repo: string,
  defaultBranch: string,
  packageJson: unknown,
  harnessConfig: unknown,
): Omit<Consumer, 'ci' | 'openRetroIssues' | 'local'> {
  const problems: string[] = []
  if (harnessConfig === undefined) problems.push('no harness.config.json on the default branch')
  const config = obj(harnessConfig)
  const update = obj(config.update)
  const retro = obj(config.retro)
  const guard = obj(config.guard)
  const pin = harnessPin(packageJson)
  return {
    repo,
    defaultBranch,
    pin,
    version: pinnedVersion(pin),
    update: { auto: update.auto === true, canary: update.canary !== false },
    merge: typeof config.merge === 'string' ? config.merge : 'wait',
    retro: {
      intake: retro.intake === true,
      every: typeof retro.every === 'number' ? retro.every : 0,
      onQueueEmpty: retro.onQueueEmpty === true,
    },
    guardRules: arr(guard.bash).length + arr(guard.paths).length,
    allowedTools: arr(config.allowedTools).length,
    problems,
  }
}

function parseJson(text: string | undefined, what: string, problems: string[]): unknown {
  if (text === undefined) return undefined
  try {
    return JSON.parse(text)
  } catch {
    problems.push(`${what} is not valid JSON`)
    return undefined
  }
}

/**
 * The consumers: the configured list, or every non-archived repository of the owner whose
 * default-branch package.json depends on the harness (the harness repository itself excluded).
 */
export function survey(s: {
  owner: string
  harnessRepo: string
  consumers: string[] | null
  hostProjects: string
}): Consumer[] {
  const repos = listRepos(s.owner).filter((r) => r.nameWithOwner !== s.harnessRepo)
  const wanted = s.consumers ? repos.filter((r) => s.consumers!.includes(r.nameWithOwner)) : repos
  const out: Consumer[] = []
  for (const r of wanted) {
    const problems: string[] = []
    const pkg = parseJson(repoFile(r.nameWithOwner, 'package.json'), 'package.json', problems)
    if (!harnessPin(pkg)) continue
    const config = parseJson(
      repoFile(r.nameWithOwner, 'harness.config.json'),
      'harness.config.json',
      problems,
    )
    const facts = consumerFacts(r.nameWithOwner, r.defaultBranch, pkg, config)
    const runsFile = path.join(
      s.hostProjects,
      r.nameWithOwner.split('/')[1]!,
      '.harness',
      'runs.jsonl',
    )
    let openRetroIssues = 0
    try {
      openRetroIssues = listIssues(r.nameWithOwner, 'harness-retro', 'open').length
    } catch {
      problems.push('could not list its retro issues')
    }
    out.push({
      ...facts,
      problems: [...problems, ...facts.problems],
      ci: defaultBranchCi(r.nameWithOwner, r.defaultBranch),
      openRetroIssues,
      local: existsSync(runsFile) ? localRuns(readFileSync(runsFile, 'utf8')) : undefined,
    })
  }
  return out
}

/** The survey as a Markdown table for triage prompts and `updater status`. */
export function surveyTable(consumers: Consumer[]): string {
  if (consumers.length === 0) return '_No repository uses the harness._'
  const rows = consumers.map((c) =>
    [
      c.repo,
      c.version ? `v${c.version}` : (c.pin ?? '?'),
      c.update.auto ? `auto${c.update.canary ? ', canary' : ''}` : 'by hand',
      c.merge,
      c.retro.intake ? 'yes' : 'no',
      c.ci ?? '?',
      String(c.openRetroIssues),
      c.local
        ? `${c.local.runs} runs; last ${c.local.lastRun?.outcome ?? '?'} on v${c.local.lastRun?.harness ?? '?'} (${c.local.lastRun?.ts.slice(0, 16) ?? '?'})`
        : 'not on this machine',
      c.problems.join('; ') || '—',
    ].join(' | '),
  )
  return [
    '| repo | harness | updates | merge | retro intake | CI | open retro issues | local runs | problems |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r} |`),
  ].join('\n')
}
