// Fails when a tracked file holds something that looks like a token. The repository is public;
// tokens belong in .env (gitignored) only. Runs in pnpm check and the pre-commit hook.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const patterns = [
  ['GitHub token', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/],
  ['Anthropic key or OAuth token', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  [
    'token assignment',
    /^\s*(GH_TOKEN|GITHUB_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY)=\S+/m,
  ],
]
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean)
const hits = []
for (const file of files) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  for (const [name, pattern] of patterns) if (pattern.test(text)) hits.push(`${file}: ${name}`)
}
if (hits.length > 0) {
  console.error(`secrets:check: token-like content in tracked files:\n  ${hits.join('\n  ')}`)
  process.exit(1)
}
console.log(`secrets:check: ${files.length} files clean`)
