// Marks Claude Code's onboarding as done and the data volume's clones as trusted, so headless
// sessions (triage, the harness loop) start without the first-run dialogs.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const file = path.join(homedir(), '.claude.json')
const config = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
const data = process.env.UPDATER_DATA ?? '/data'
config.hasCompletedOnboarding = true
config.projects ??= {}
for (const dir of [data, path.join(data, 'harness')])
  config.projects[dir] = { ...config.projects[dir], hasTrustDialogAccepted: true }
writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`)
