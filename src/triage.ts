/**
 * Triage: one read-only Claude session per harness issue decides whether it is worth building.
 *
 * - Candidates: the owner's open retro issues (quarantine issues carry the retro label too) that
 *   have no verdict yet, were reopened after a rejection, or got a new comment since their verdict.
 *   An issue the harness loop already queued is left alone.
 * - The session reads the issue as data, the survey of consumers, the harness clone and the
 *   consumer clones, and answers with a schema-checked verdict.
 * - Applying it: a comment with the reasoning and a per-consumer table, an `updater:<verdict>`
 *   label (the harness intake builds only `updater:accepted`, `retro.intakeLabel`), a refined
 *   feature block when the session wrote one, and closing a rejected issue as not planned. A
 *   quarantine issue is never closed: that would lift the quarantine and let a bad release spread,
 *   so a rejection there becomes needs-human.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { QUARANTINE_LABEL } from '@eemelinen/harness'
import { z } from 'zod'

import { closeIssue, comment, editBody, editLabels, hasLabel, type Issue } from './github'
import { log, sh } from './run'

export const RETRO_LABEL = 'harness-retro'
export const QUEUED_LABEL = `${RETRO_LABEL}:queued`
export const VERDICT_LABELS = [
  'updater:accepted',
  'updater:rejected',
  'updater:needs-human',
] as const
const VERDICT_MARKER = 'updater-verdict'

export const verdictSchema = z.object({
  verdict: z.enum(['accepted', 'rejected', 'needs-human']),
  kind: z.enum(['harness', 'project', 'duplicate', 'fixed', 'not-reproducible', 'unclear']),
  reason: z.string().min(1),
  duplicateOf: z.number().int().positive().optional(),
  fixedBy: z.string().min(1).optional(),
  consumers: z.array(
    z.object({ repo: z.string().min(1), affected: z.boolean(), why: z.string().min(1) }),
  ),
  feature: z
    .object({
      title: z.string().min(1),
      user_visible_behavior: z.string().min(1),
      verification: z.array(z.string().regex(/^(L1|L2|L3): \S/)).min(1),
    })
    .optional(),
})

export type Verdict = z.infer<typeof verdictSchema>

const verdictComments = (issue: Issue) =>
  issue.comments.filter((c) => c.body.includes(`<!-- ${VERDICT_MARKER} `))

/**
 * Should this (owner-filtered, open) issue be triaged now? Yes without a verdict, when a rejected
 * one is open again, or when someone commented after the last verdict. Never while queued.
 */
export function needsTriage(issue: Issue): boolean {
  if (issue.state !== 'OPEN' || hasLabel(issue, QUEUED_LABEL)) return false
  const label = VERDICT_LABELS.find((l) => hasLabel(issue, l))
  if (!label) return true
  if (label === 'updater:rejected') return true
  const last = verdictComments(issue).at(-1)
  if (!last) return true
  return issue.comments.some(
    (c) => c.createdAt > last.createdAt && !c.body.includes(`<!-- ${VERDICT_MARKER} `),
  )
}

export function candidates(issues: Issue[], max: number): Issue[] {
  return issues
    .filter((i) => hasLabel(i, RETRO_LABEL) && needsTriage(i))
    .sort((a, b) => a.number - b.number)
    .slice(0, max)
}

export const isQuarantine = (issue: Issue) => hasLabel(issue, QUARANTINE_LABEL)

const FEATURE_BLOCK = /```json harness-feature\r?\n[\s\S]*?\r?\n```/

/** The issue body with its feature block replaced (or appended) by the refined one. */
export function withFeature(body: string, feature: NonNullable<Verdict['feature']>): string {
  const block = [
    '```json harness-feature',
    JSON.stringify({ ...feature, safety: /"safety":\s*true/.test(body) }, null, 2),
    '```',
  ].join('\n')
  return FEATURE_BLOCK.test(body)
    ? body.replace(FEATURE_BLOCK, block)
    : `${body.trimEnd()}\n\n${block}\n`
}

export type Action =
  | { kind: 'comment'; body: string }
  | { kind: 'labels'; add: string[]; remove: string[] }
  | { kind: 'body'; body: string }
  | { kind: 'close' }

export function verdictComment(issue: Issue, v: Verdict, effective: Verdict['verdict']): string {
  const heading = {
    accepted: '✅ **Accepted** — the harness loop will build it.',
    rejected: '🚫 **Rejected** — closed as not planned. Reopen it to have it triaged again.',
    'needs-human': '🙋 **Needs a human** — not built until you decide.',
  }[effective]
  const lines = [
    `**harness-updater triage** (${v.kind}): ${heading}`,
    '',
    v.reason,
    ...(v.duplicateOf ? ['', `Duplicate of #${v.duplicateOf}.`] : []),
    ...(v.fixedBy ? ['', `Already fixed by ${v.fixedBy}.`] : []),
    ...(effective !== v.verdict
      ? [
          '',
          `The session rejected it, but this is a quarantine issue: closing it would lift the quarantine of ${issue.title.match(/v\d+\.\d+\.\d+/)?.[0] ?? 'the release'}. Close it as not planned yourself if it is a false alarm.`,
        ]
      : []),
    ...(v.feature ? ['', `The feature block was refined: **${v.feature.title}**.`] : []),
  ]
  if (v.consumers.length > 0) {
    lines.push('', '| consumer | affected | why |', '| --- | --- | --- |')
    for (const c of v.consumers)
      lines.push(`| ${c.repo} | ${c.affected ? 'yes' : 'no'} | ${c.why.replace(/\|/g, '\\|')} |`)
  }
  lines.push(
    '',
    'Comment on this issue to have it triaged again.',
    '',
    `<!-- ${VERDICT_MARKER} ${JSON.stringify({ verdict: effective, kind: v.kind, at: new Date().toISOString() })} -->`,
  )
  return lines.join('\n')
}

/** What a verdict does to the issue, in order. */
export function verdictActions(issue: Issue, v: Verdict): Action[] {
  const effective: Verdict['verdict'] =
    v.verdict === 'rejected' && isQuarantine(issue) ? 'needs-human' : v.verdict
  const label = `updater:${effective}`
  const actions: Action[] = [
    { kind: 'comment', body: verdictComment(issue, v, effective) },
    {
      kind: 'labels',
      add: hasLabel(issue, label) ? [] : [label],
      remove: VERDICT_LABELS.filter((l) => l !== label && hasLabel(issue, l)),
    },
  ]
  if (effective === 'accepted' && v.feature)
    actions.push({ kind: 'body', body: withFeature(issue.body, v.feature) })
  if (effective === 'rejected') actions.push({ kind: 'close' })
  return actions
}

export function applyActions(repo: string, issue: number, actions: Action[]) {
  for (const a of actions) {
    if (a.kind === 'comment') comment(repo, issue, a.body)
    else if (a.kind === 'labels') editLabels(repo, issue, a.add, a.remove)
    else if (a.kind === 'body') editBody(repo, issue, a.body)
    else closeIssue(repo, issue, 'not planned')
  }
}

const PROMPT_FILE = path.resolve(import.meta.dirname, '..', 'prompts', 'triage.md')

export function triagePrompt(s: {
  issue: Issue
  harnessRepo: string
  surveyTable: string
  dataDir: string
  hostProjects: string
}): string {
  const { issue } = s
  const issueText = [
    `#${issue.number} ${issue.title} (${issue.url})`,
    `labels: ${issue.labels.map((l) => l.name).join(', ')}`,
    '',
    issue.body,
    ...issue.comments.flatMap((c) => ['', `--- comment ${c.createdAt} ---`, c.body]),
  ].join('\n')
  const vars: Record<string, string> = {
    HARNESS_REPO: s.harnessRepo,
    HARNESS_DIR: path.join(s.dataDir, 'harness'),
    CONSUMERS_DIR: path.join(s.dataDir, 'consumers'),
    HOST_PROJECTS: s.hostProjects,
    SURVEY: s.surveyTable,
    QUARANTINE: isQuarantine(issue) ? 'yes' : 'no',
    // Fenced as data; a fence inside the issue cannot end it.
    ISSUE: issueText.replace(/~~~~/g, '~ ~ ~ ~'),
  }
  return readFileSync(PROMPT_FILE, 'utf8').replace(
    /\{\{(\w+)\}\}/g,
    (_, k: string) => vars[k] ?? '',
  )
}

/** Read-only tools for the session; anything else is denied without a prompt. */
export const TRIAGE_ALLOWED = [
  'Read',
  'Grep',
  'Glob',
  // Every part of a chained command must match, so `cd … && git log` needs cd too.
  'Bash(cd *)',
  'Bash(ls*)',
  'Bash(head *)',
  'Bash(tail *)',
  'Bash(wc *)',
  'Bash(git tag*)',
  'Bash(git log*)',
  'Bash(git show*)',
  'Bash(git diff*)',
  'Bash(git grep*)',
  'Bash(gh issue view*)',
  'Bash(gh issue list*)',
  'Bash(gh pr view*)',
  'Bash(gh pr list*)',
  'Bash(gh pr diff*)',
  'Bash(gh release list*)',
  'Bash(gh release view*)',
]

/**
 * The verdict schema for `--json-schema`. Without zod's `$schema` line: Claude Code rejects the
 * draft 2020-12 meta-schema reference ("no schema with key or ref").
 */
export function verdictJsonSchema(): Record<string, unknown> {
  const { $schema: _metaSchema, ...schema } = z.toJSONSchema(verdictSchema)
  return schema
}

export function triageArgs(
  prompt: string,
  t: { model: string; effort?: string; maxTurns: number; maxBudgetUsd: number },
): string[] {
  return [
    '-p',
    prompt,
    '--model',
    t.model,
    ...(t.effort ? ['--effort', t.effort] : []),
    '--max-turns',
    String(t.maxTurns),
    '--max-budget-usd',
    String(t.maxBudgetUsd),
    '--permission-mode',
    'dontAsk',
    '--permission-prompts',
    'none',
    '--tools',
    'Read,Grep,Glob,Bash',
    '--allowedTools',
    ...TRIAGE_ALLOWED,
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(verdictJsonSchema()),
  ]
}

export function parseVerdict(stdout: string): {
  verdict?: Verdict
  costUsd: number
  error?: string
} {
  let result: {
    structured_output?: unknown
    total_cost_usd?: number
    is_error?: boolean
    result?: string
  }
  try {
    result = JSON.parse(stdout) as typeof result
  } catch {
    return { costUsd: 0, error: `no JSON result: ${stdout.slice(0, 300)}` }
  }
  const parsed = verdictSchema.safeParse(result.structured_output)
  return parsed.success
    ? { verdict: parsed.data, costUsd: result.total_cost_usd ?? 0 }
    : {
        costUsd: result.total_cost_usd ?? 0,
        error: result.is_error ? String(result.result) : 'the verdict does not match the schema',
      }
}

/** Runs the triage session for one issue; the raw result is kept under logs/. */
export function runTriage(
  prompt: string,
  t: {
    model: string
    effort?: string
    maxTurns: number
    maxBudgetUsd: number
    wallClockMin: number
  },
  dataDir: string,
  issue: number,
): ReturnType<typeof parseVerdict> {
  log(`triage #${issue}: session (${t.model}, ≤${t.maxTurns} turns, ≤$${t.maxBudgetUsd})`)
  const r = sh('claude', triageArgs(prompt, t), {
    cwd: dataDir,
    timeoutMs: t.wallClockMin * 60_000,
  })
  const logDir = path.join(dataDir, 'logs')
  mkdirSync(logDir, { recursive: true })
  writeFileSync(
    path.join(logDir, `triage-${issue}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
    r.out || r.err,
  )
  const parsed = parseVerdict(r.out)
  // A session that failed to start writes its reason to stderr and nothing to stdout.
  if (!parsed.verdict && !r.out)
    return { ...parsed, error: `exit ${r.code}: ${r.err.slice(0, 500)}` }
  return parsed
}
