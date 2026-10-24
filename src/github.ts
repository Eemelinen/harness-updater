/**
 * Everything the updater reads from or writes to GitHub goes through `gh` here. The harness repo is
 * public, so issues and comments are filtered to the owner's account before anything reads them:
 * the drivers file and comment as the owner, anyone else's text never reaches a session.
 */
import { must, sh } from './run'

export interface Comment {
  author: { login: string }
  body: string
  createdAt: string
  url: string
}

export interface Issue {
  number: number
  title: string
  body: string
  url: string
  state: 'OPEN' | 'CLOSED'
  stateReason?: string
  author: { login: string }
  labels: { name: string }[]
  comments: Comment[]
  createdAt: string
  updatedAt: string
}

const ISSUE_FIELDS =
  'number,title,body,url,state,stateReason,author,labels,comments,createdAt,updatedAt'

export const hasLabel = (issue: Pick<Issue, 'labels'>, name: string) =>
  issue.labels.some((l) => l.name === name)

/** The owner's issues only, each with the owner's comments only. */
export function ownIssues(issues: Issue[], owner: string): Issue[] {
  const mine = (login: string | undefined) => login?.toLowerCase() === owner.toLowerCase()
  return issues
    .filter((i) => mine(i.author?.login))
    .map((i) => ({ ...i, comments: (i.comments ?? []).filter((c) => mine(c.author?.login)) }))
}

export function listIssues(repo: string, label: string, state: 'open' | 'all' = 'open'): Issue[] {
  const out = must('gh', [
    'issue',
    'list',
    '--repo',
    repo,
    '--label',
    label,
    '--state',
    state,
    '--limit',
    '200',
    '--json',
    ISSUE_FIELDS,
  ])
  return JSON.parse(out || '[]') as Issue[]
}

export function viewIssue(repo: string, issue: number): Issue {
  return JSON.parse(
    must('gh', ['issue', 'view', String(issue), '--repo', repo, '--json', ISSUE_FIELDS]),
  ) as Issue
}

export interface RepoInfo {
  nameWithOwner: string
  defaultBranch: string
  archived: boolean
}

export function listRepos(owner: string): RepoInfo[] {
  const out = must('gh', [
    'repo',
    'list',
    owner,
    '--limit',
    '300',
    '--no-archived',
    '--json',
    'nameWithOwner,defaultBranchRef,isArchived',
  ])
  return (
    JSON.parse(out || '[]') as {
      nameWithOwner: string
      defaultBranchRef: { name: string } | null
      isArchived: boolean
    }[]
  )
    .filter((r) => r.defaultBranchRef)
    .map((r) => ({
      nameWithOwner: r.nameWithOwner,
      defaultBranch: r.defaultBranchRef!.name,
      archived: r.isArchived,
    }))
}

/** A file on a repository's default branch, or undefined when it does not exist. */
export function repoFile(repo: string, file: string): string | undefined {
  const r = sh('gh', ['api', `repos/${repo}/contents/${file}`, '--jq', '.content'])
  if (r.code !== 0 || !r.out) return undefined
  return Buffer.from(r.out.replace(/\s/g, ''), 'base64').toString('utf8')
}

/** The newest workflow run on the default branch: `success`, `failure`, `in_progress`, … */
export function defaultBranchCi(repo: string, branch: string): string | undefined {
  const r = sh('gh', [
    'run',
    'list',
    '--repo',
    repo,
    '--branch',
    branch,
    '--limit',
    '1',
    '--json',
    'status,conclusion',
  ])
  if (r.code !== 0) return undefined
  const run = (JSON.parse(r.out || '[]') as { status: string; conclusion: string }[])[0]
  return run ? run.conclusion || run.status : undefined
}

export function comment(repo: string, issue: number, body: string) {
  must('gh', ['issue', 'comment', String(issue), '--repo', repo, '--body', body])
}

export function editLabels(repo: string, issue: number, add: string[], remove: string[]) {
  for (const name of add) ensureLabel(repo, name)
  const args = ['issue', 'edit', String(issue), '--repo', repo]
  for (const name of add) args.push('--add-label', name)
  for (const name of remove) args.push('--remove-label', name)
  if (add.length + remove.length > 0) must('gh', args)
}

export function closeIssue(repo: string, issue: number, reason: 'completed' | 'not planned') {
  must('gh', ['issue', 'close', String(issue), '--repo', repo, '--reason', reason])
}

export function editBody(repo: string, issue: number, body: string) {
  must('gh', ['issue', 'edit', String(issue), '--repo', repo, '--body', body])
}

const LABEL_COLORS: Record<string, string> = {
  'updater:accepted': '0E8A16',
  'updater:rejected': 'B60205',
  'updater:needs-human': 'FBCA04',
}

const ensured = new Set<string>()

function ensureLabel(repo: string, name: string) {
  if (ensured.has(`${repo}:${name}`)) return
  sh('gh', [
    'label',
    'create',
    name,
    '--repo',
    repo,
    '--color',
    LABEL_COLORS[name] ?? 'C5DEF5',
    '--description',
    'Set by harness-updater triage',
    '--force',
  ])
  ensured.add(`${repo}:${name}`)
}
