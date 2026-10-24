/**
 * One cycle: sync the clones, survey the consumers, triage new issues, build accepted ones. The
 * daemon runs a cycle every `pollMinutes`; a lock file keeps a manual `updater once` from running
 * beside it. A failing cycle is recorded and retried next time, never fatal.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { buildable, buildDecision, intakeGate, runBuild, stopBuild } from './build'
import type { UpdaterConfig } from './config'
import { listIssues, ownIssues, type Issue } from './github'
import { log } from './run'
import { buildsToday, readState, writeState, type State } from './state'
import { survey, surveyTable } from './survey'
import { consumerDir, harnessDir, syncClone, syncHarness } from './sync'
import {
  applyActions,
  candidates,
  RETRO_LABEL,
  runTriage,
  triagePrompt,
  verdictActions,
  type Action,
} from './triage'

const lockFile = (dataDir: string) => path.join(dataDir, 'cycle.lock')

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Takes the cycle lock; false when another live process holds it. */
export function takeLock(dataDir: string): boolean {
  const file = lockFile(dataDir)
  if (existsSync(file)) {
    const pid = Number(readFileSync(file, 'utf8'))
    if (pid && pid !== process.pid && alive(pid)) return false
  }
  writeFileSync(file, String(process.pid))
  return true
}

export const releaseLock = (dataDir: string) => rmSync(lockFile(dataDir), { force: true })

/** In observe mode nothing is posted, so an issue unchanged since its last logged verdict waits. */
export function seenUnchanged(state: State, issue: Issue): boolean {
  return state.triage.some((t) => t.issue === issue.number && !t.posted && t.at >= issue.updatedAt)
}

const describe = (a: Action) =>
  a.kind === 'labels'
    ? `labels +[${a.add.join(', ')}] -[${a.remove.join(', ')}]`
    : a.kind === 'comment'
      ? 'comment'
      : a.kind === 'body'
        ? 'replace the feature block'
        : 'close as not planned'

export async function cycle(cfg: UpdaterConfig): Promise<void> {
  const state = readState(cfg.dataDir)
  state.cycle.lastStart = new Date().toISOString()
  writeState(cfg.dataDir, state)
  log(`cycle (${cfg.mode})`)

  state.harnessLockfile = syncHarness(cfg.dataDir, cfg.harnessRepo, state.harnessLockfile)

  const consumers = survey(cfg)
  for (const c of consumers) {
    try {
      syncClone(c.repo, consumerDir(cfg.dataDir, c.repo), c.defaultBranch)
    } catch (error) {
      c.problems.push(`clone failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  state.survey = { at: new Date().toISOString(), consumers }
  log(
    `survey: ${consumers.map((c) => `${c.repo} v${c.version ?? '?'}`).join(', ') || 'no consumers'}`,
  )
  writeState(cfg.dataDir, state)

  const open = ownIssues(listIssues(cfg.harnessRepo, RETRO_LABEL, 'open'), cfg.owner)
  const todo = candidates(
    cfg.mode === 'observe' ? open.filter((i) => !seenUnchanged(state, i)) : open,
    cfg.triage.maxPerCycle,
  )
  for (const issue of todo) {
    const prompt = triagePrompt({
      issue,
      harnessRepo: cfg.harnessRepo,
      surveyTable: surveyTable(consumers),
      dataDir: cfg.dataDir,
      hostProjects: cfg.hostProjects,
    })
    const result = runTriage(prompt, cfg.triage, cfg.dataDir, issue.number)
    if (!result.verdict) {
      log(`triage #${issue.number}: no verdict (${result.error}); it is tried again next cycle`)
      continue
    }
    const v = result.verdict
    const actions = verdictActions(issue, v)
    log(`triage #${issue.number}: ${v.verdict} (${v.kind}) — ${v.reason.slice(0, 200)}`)
    const posted = cfg.mode !== 'observe'
    if (posted) applyActions(cfg.harnessRepo, issue.number, actions)
    else log(`  observe mode, would: ${actions.map(describe).join('; ')}`)
    state.triage.push({
      issue: issue.number,
      title: issue.title,
      at: new Date().toISOString(),
      verdict: v.verdict,
      kind: v.kind,
      reason: v.reason,
      posted,
      costUsd: result.costUsd,
    })
    writeState(cfg.dataDir, state)
  }

  const accepted = buildable(ownIssues(listIssues(cfg.harnessRepo, RETRO_LABEL, 'open'), cfg.owner))
  const decision = buildDecision({
    mode: cfg.mode,
    accepted: accepted.length,
    buildsToday: buildsToday(state, Date.now()),
    maxPerDay: cfg.build.maxPerDay,
    gate: intakeGate(harnessDir(cfg.dataDir)),
  })
  if (decision.build) {
    const started = Date.now()
    const logFile = path.join(
      cfg.dataDir,
      'logs',
      `build-${new Date().toISOString().replace(/[:.]/g, '-')}.log`,
    )
    const code = await runBuild(harnessDir(cfg.dataDir), logFile)
    state.builds.push({
      at: new Date(started).toISOString(),
      issues: accepted.map((i) => i.number),
      code,
      minutes: Math.round((Date.now() - started) / 60_000),
      log: logFile,
    })
    log(`build finished with code ${code}`)
  } else if (accepted.length > 0) {
    log(`build skipped: ${decision.reason}`)
  }
  state.cycle.lastOk = new Date().toISOString()
  state.cycle.lastError = undefined
  writeState(cfg.dataDir, state)
}

/** One cycle under the lock; false when another process is mid-cycle. */
export async function once(cfg: UpdaterConfig): Promise<boolean> {
  if (!takeLock(cfg.dataDir)) {
    log('another cycle is running; skipped')
    return false
  }
  try {
    await cycle(cfg)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log(`cycle failed: ${message}`)
    const state = readState(cfg.dataDir)
    state.cycle.lastError = `${new Date().toISOString()} ${message.slice(0, 1000)}`
    writeState(cfg.dataDir, state)
  } finally {
    releaseLock(cfg.dataDir)
  }
  return true
}

export async function daemon(cfg: UpdaterConfig): Promise<void> {
  let stopping = false
  const stop = () => {
    log('stopping after this cycle')
    stopping = true
    stopBuild()
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  log(`harness-updater: ${cfg.mode} mode, every ${cfg.pollMinutes} min, data ${cfg.dataDir}`)
  while (!stopping) {
    await once(cfg)
    const until = Date.now() + cfg.pollMinutes * 60_000
    while (!stopping && Date.now() < until) await sleep(5_000)
  }
}

/** Healthy while cycles finish, or while one is still running (a build can take hours). */
export function healthy(state: State, now: number, pollMinutes: number, locked: boolean): boolean {
  const recent = (iso: string | undefined, ms: number) => Boolean(iso && now - Date.parse(iso) < ms)
  if (recent(state.cycle.lastOk, 3 * pollMinutes * 60_000)) return true
  return locked && recent(state.cycle.lastStart, 6 * 3_600_000)
}

export function lockHeld(dataDir: string): boolean {
  const file = lockFile(dataDir)
  if (!existsSync(file)) return false
  const pid = Number(readFileSync(file, 'utf8'))
  return Boolean(pid && alive(pid))
}
