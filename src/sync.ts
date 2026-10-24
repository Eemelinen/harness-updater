/**
 * The updater's own clones in the data volume: the harness repository (triage reads it, the build
 * runs its loop) and each consumer (triage reads it). They are the updater's alone, so a sync
 * resets them to the remote default branch; ignored files (node_modules, `.harness/` traces) stay.
 * Your checkouts are only ever mounted read-only and never synced.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { log, must, sh } from './run'

export const harnessDir = (dataDir: string) => path.join(dataDir, 'harness')
export const consumerDir = (dataDir: string, repo: string) =>
  path.join(dataDir, 'consumers', repo.replace('/', '__'))

/** Clones `repo` into `dir`, or resets the clone there to `origin/<branch>`. */
export function syncClone(repo: string, dir: string, branch: string) {
  const url = `https://github.com/${repo}.git`
  if (!existsSync(path.join(dir, '.git'))) {
    mkdirSync(path.dirname(dir), { recursive: true })
    must('git', ['clone', '--quiet', '--branch', branch, url, dir])
    log(`cloned ${repo}`)
    return
  }
  must('git', ['fetch', '--quiet', '--prune', 'origin'], { cwd: dir })
  must('git', ['checkout', '--quiet', '-B', branch, `origin/${branch}`], { cwd: dir })
  must('git', ['reset', '--quiet', '--hard', `origin/${branch}`], { cwd: dir })
  // Untracked leftovers go; ignored files (node_modules, .harness traces) stay.
  sh('git', ['clean', '-fdq'], { cwd: dir })
}

export function lockfileHash(dir: string): string | undefined {
  const file = path.join(dir, 'pnpm-lock.yaml')
  return existsSync(file)
    ? createHash('sha256').update(readFileSync(file)).digest('hex')
    : undefined
}

/**
 * Syncs the harness clone and installs its dependencies when its lockfile changed; returns the
 * lockfile hash to remember.
 */
export function syncHarness(
  dataDir: string,
  repo: string,
  installedHash?: string,
): string | undefined {
  const dir = harnessDir(dataDir)
  syncClone(repo, dir, 'main')
  const hash = lockfileHash(dir)
  if (hash !== installedHash || !existsSync(path.join(dir, 'node_modules'))) {
    log('installing the harness clone’s dependencies')
    must('pnpm', ['install', '--frozen-lockfile'], { cwd: dir, timeoutMs: 10 * 60_000 })
  }
  return hash
}
