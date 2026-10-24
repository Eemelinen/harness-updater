/** Process helpers: one place that spawns git, gh and node. */
import { spawnSync } from 'node:child_process'

export interface ShResult {
  code: number
  out: string
  err: string
}

export function sh(
  command: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; input?: string; env?: NodeJS.ProcessEnv } = {},
): ShResult {
  const res = spawnSync(command, args, {
    cwd: opts.cwd,
    encoding: 'utf8',
    input: opts.input,
    timeout: opts.timeoutMs,
    env: opts.env ?? process.env,
    maxBuffer: 64 * 1024 * 1024,
  })
  return {
    code: res.status ?? 1,
    out: (res.stdout ?? '').trim(),
    err: (res.error?.message ?? res.stderr ?? '').trim(),
  }
}

export function must(command: string, args: string[], opts: Parameters<typeof sh>[2] = {}): string {
  const r = sh(command, args, opts)
  if (r.code !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${r.err || r.out}`)
  return r.out
}

export const log = (line: string) =>
  console.log(`[updater ${new Date().toISOString().slice(0, 19).replace('T', ' ')}] ${line}`)
