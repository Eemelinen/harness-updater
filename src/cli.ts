/**
 * `updater <command>` (in the container: `docker compose exec updater updater <command>`).
 *
 *   updater run              the daemon: a cycle every pollMinutes (the container's command)
 *   updater once             one cycle now
 *   updater status           mode, last cycle, the survey, recent verdicts and builds
 *   updater survey           survey the consumers and print the table (no triage)
 *   updater triage <n>       triage one issue and print the verdict; --apply posts it
 *   updater health           exit 0 while cycles finish (the container healthcheck)
 */
import { loadConfig } from './config'
import { listIssues, ownIssues, viewIssue } from './github'
import { daemon, healthy, lockHeld, once } from './main'
import { buildsToday, readState } from './state'
import { survey, surveyTable } from './survey'
import { applyActions, runTriage, triagePrompt, verdictActions } from './triage'

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  const cfg = loadConfig()
  switch (command) {
    case 'run':
      await daemon(cfg)
      return 0
    case 'once':
      return (await once(cfg)) ? 0 : 1
    case 'status': {
      const s = readState(cfg.dataDir)
      console.log(`mode ${cfg.mode} · data ${cfg.dataDir}`)
      console.log(`last cycle: started ${s.cycle.lastStart ?? '-'}, ok ${s.cycle.lastOk ?? '-'}`)
      if (s.cycle.lastError) console.log(`last error: ${s.cycle.lastError}`)
      console.log(
        `\nsurvey (${s.survey?.at ?? 'never'}):\n${surveyTable(s.survey?.consumers ?? [])}`,
      )
      console.log('\nrecent verdicts:')
      for (const t of s.triage.slice(-10))
        console.log(
          `  #${t.issue} ${t.verdict} (${t.kind})${t.posted ? '' : ' [logged only]'} ${t.at.slice(0, 16)} — ${t.title}`,
        )
      console.log(
        `\nbuilds in the last 24 h: ${buildsToday(s, Date.now())} of ${cfg.build.maxPerDay}`,
      )
      for (const b of s.builds.slice(-5))
        console.log(
          `  ${b.at.slice(0, 16)} exit ${b.code}, ${b.minutes} min, issues ${b.issues.join(', ')} — ${b.log}`,
        )
      return 0
    }
    case 'survey':
      console.log(surveyTable(survey(cfg)))
      return 0
    case 'triage': {
      const n = Number(rest[0])
      if (!n) throw new Error('usage: updater triage <issue number> [--apply]')
      const [issue] = ownIssues([viewIssue(cfg.harnessRepo, n)], cfg.owner)
      if (!issue)
        throw new Error(`#${n} was not opened by ${cfg.owner}; the updater does not triage it`)
      const consumers = readState(cfg.dataDir).survey?.consumers ?? survey(cfg)
      const result = runTriage(
        triagePrompt({
          issue,
          harnessRepo: cfg.harnessRepo,
          surveyTable: surveyTable(consumers),
          dataDir: cfg.dataDir,
          hostProjects: cfg.hostProjects,
        }),
        cfg.triage,
        cfg.dataDir,
        n,
      )
      if (!result.verdict) throw new Error(`no verdict: ${result.error}`)
      console.log(JSON.stringify(result.verdict, null, 2))
      const actions = verdictActions(issue, result.verdict)
      if (rest.includes('--apply') && cfg.mode !== 'observe') {
        applyActions(cfg.harnessRepo, n, actions)
        console.log(`applied: ${actions.map((a) => a.kind).join(', ')}`)
      } else {
        console.log(
          `not applied (${cfg.mode} mode${rest.includes('--apply') ? '' : ', no --apply'}): ${actions.map((a) => a.kind).join(', ')}`,
        )
      }
      return 0
    }
    case 'health':
      return healthy(readState(cfg.dataDir), Date.now(), cfg.pollMinutes, lockHeld(cfg.dataDir))
        ? 0
        : 1
    case 'issues':
      for (const i of ownIssues(listIssues(cfg.harnessRepo, 'harness-retro', 'open'), cfg.owner))
        console.log(`#${i.number} [${i.labels.map((l) => l.name).join(', ')}] ${i.title}`)
      return 0
    default:
      console.error('usage: updater <run|once|status|survey|triage <n> [--apply]|health|issues>')
      return 1
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    console.error(`updater: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  },
)
