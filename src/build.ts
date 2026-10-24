/**
 * Build: the harness repository's own loop builds the accepted issues. The updater only decides
 * when: in `full` mode, when an accepted issue is not queued yet, within `build.maxPerDay`, and only
 * if the harness config gates its intake on `updater:accepted` (`retro.intakeLabel`). Without that
 * gate the loop would also build issues the triage never accepted, so the updater refuses to start
 * it. One `harness loop --once` per cycle: it queues one issue, builds it, opens the PR and waits for
 * the merge like any loop run.
 */
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { hasLabel, type Issue } from './github'
import { log } from './run'
import { QUEUED_LABEL } from './triage'

export const ACCEPTED = 'updater:accepted'

export const buildable = (issues: Issue[]) =>
  issues.filter((i) => i.state === 'OPEN' && hasLabel(i, ACCEPTED) && !hasLabel(i, QUEUED_LABEL))

/** The harness clone's `retro.intakeLabel`, if its config sets one. */
export function intakeGate(harnessDir: string): string | undefined {
  const file = path.join(harnessDir, 'harness.config.json')
  if (!existsSync(file)) return undefined
  const config = JSON.parse(readFileSync(file, 'utf8')) as { retro?: { intakeLabel?: unknown } }
  return typeof config.retro?.intakeLabel === 'string' ? config.retro.intakeLabel : undefined
}

export function buildDecision(s: {
  mode: string
  accepted: number
  buildsToday: number
  maxPerDay: number
  gate: string | undefined
}): { build: boolean; reason: string } {
  if (s.mode !== 'full') return { build: false, reason: `mode ${s.mode} does not build` }
  if (s.accepted === 0) return { build: false, reason: 'no accepted issue waits' }
  if (s.gate !== ACCEPTED)
    return {
      build: false,
      reason: `the harness config does not gate its intake on ${ACCEPTED} (retro.intakeLabel is ${s.gate ?? 'unset'}); not starting its loop`,
    }
  if (s.buildsToday >= s.maxPerDay)
    return {
      build: false,
      reason: `${s.buildsToday} builds in the last 24 h (build.maxPerDay ${s.maxPerDay})`,
    }
  return { build: true, reason: `${s.accepted} accepted issue(s) wait` }
}

let current: ReturnType<typeof spawn> | undefined

/** Asks a running loop to finish its current session and stop (the harness driver's SIGINT). */
export function stopBuild() {
  current?.kill('SIGINT')
}

/** Runs `harness loop --once` in the harness clone; its output goes to the log file and stdout. */
export function runBuild(harnessDir: string, logFile: string): Promise<number> {
  mkdirSync(path.dirname(logFile), { recursive: true })
  const out = createWriteStream(logFile, { flags: 'a' })
  log(`build: harness loop --once in ${harnessDir}; log ${logFile}`)
  return new Promise((resolve) => {
    current = spawn(process.execPath, ['bin/harness.mjs', 'loop', '--once'], {
      cwd: harnessDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    for (const stream of [current.stdout, current.stderr]) {
      stream?.on('data', (chunk: Buffer) => {
        out.write(chunk)
        process.stdout.write(chunk)
      })
    }
    current.on('close', (code) => {
      current = undefined
      out.end()
      resolve(code ?? 1)
    })
  })
}
