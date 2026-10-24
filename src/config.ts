/**
 * The updater's settings: `updater.config.json` (committed, no secrets) plus the environment
 * (`.env` in Docker: tokens, the mode, the data directory). Every key has a default.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

export const modes = ['observe', 'triage', 'full'] as const
export type Mode = (typeof modes)[number]

const fileSchema = z.object({
  /** GitHub account whose repositories use the harness; only its issues and comments count. */
  owner: z.string().min(1).default('Eemelinen'),
  harnessRepo: z
    .string()
    .regex(/^[\w.-]+\/[\w.-]+$/)
    .default('Eemelinen/harness'),
  /** `owner/name` of each consumer; null discovers them from the owner's repositories. */
  consumers: z
    .array(z.string().regex(/^[\w.-]+\/[\w.-]+$/))
    .nullable()
    .default(null),
  /** Where the projects of this machine live, mounted read-only for their traces. */
  hostProjects: z.string().min(1).default('/home/eemeli/projects'),
  pollMinutes: z.number().positive().default(10),
  triage: z
    .object({
      model: z.string().min(1).default('claude-opus-5-5'),
      effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
      maxTurns: z.number().int().positive().default(40),
      maxBudgetUsd: z.number().positive().default(2),
      wallClockMin: z.number().positive().default(20),
      maxPerCycle: z.number().int().positive().default(3),
    })
    .prefault({}),
  build: z
    .object({
      maxPerDay: z.number().int().nonnegative().default(4),
    })
    .prefault({}),
})

export type FileConfig = z.infer<typeof fileSchema>

export interface UpdaterConfig extends FileConfig {
  mode: Mode
  /** The container's volume: clones, state, logs. */
  dataDir: string
}

export function parseFileConfig(raw: unknown): FileConfig {
  const parsed = fileSchema.safeParse(raw)
  if (!parsed.success)
    throw new Error(`updater.config.json is invalid:\n${z.prettifyError(parsed.error)}`)
  return parsed.data
}

export function parseMode(value: string | undefined): Mode {
  const mode = (value ?? 'observe').trim()
  if (!(modes as readonly string[]).includes(mode))
    throw new Error(`UPDATER_MODE must be one of ${modes.join(', ')} (got ${mode})`)
  return mode as Mode
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): UpdaterConfig {
  const file = env.UPDATER_CONFIG ?? path.resolve(import.meta.dirname, '..', 'updater.config.json')
  const raw: unknown = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  const fromFile = parseFileConfig(raw)
  return {
    ...fromFile,
    hostProjects: env.UPDATER_HOST_PROJECTS ?? fromFile.hostProjects,
    mode: parseMode(env.UPDATER_MODE),
    dataDir: path.resolve(env.UPDATER_DATA ?? 'data'),
  }
}
