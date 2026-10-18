import { z } from "zod"

// Server-only configuration. Nothing here is exposed to the browser bundle and
// no variable grants permissions by itself.
const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  // Schema-owner connection. The running app uses it ONLY for the presenter
  // demo reset/checkpoint (server/domain/presenter.ts), and only when
  // AGEOS_DEMO_MODE=true; every request path uses DATABASE_URL (RLS role).
  DATABASE_URL_MIGRATIONS: z.string().min(1).optional(),
  AGEOS_SESSION_SECRET: z.string().min(32),
  AGEOS_DEMO_ACCESS_CODE: z.string().min(6),
  AGEOS_DEMO_MODE: z.enum(["true", "false"]).default("true"),
  AGEOS_ASSISTANT_MODE: z.enum(["scripted"]).default("scripted"),
  AGEOS_CONNECTOR_MODE: z.enum(["simulated"]).default("simulated"),
  AGEOS_DEPLOYMENT_PROFILE: z.enum(["local", "preview"]).default("local"),
  AGEOS_STORAGE_DIR: z.string().default(".data/private-files"),
  AGEOS_ASSISTANT_MAX_STEPS: z.coerce.number().int().positive().default(24),
  AGEOS_ASSISTANT_MAX_REQUESTS_PER_MINUTE: z.coerce
    .number()
    .int()
    .positive()
    .default(30),
})

export type ServerEnv = z.infer<typeof EnvSchema>

let cached: ServerEnv | undefined

export function env(): ServerEnv {
  if (!cached) cached = EnvSchema.parse(process.env)
  return cached
}

export const isDemoMode = () => env().AGEOS_DEMO_MODE === "true"
