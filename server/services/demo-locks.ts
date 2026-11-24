// Path locks for the public demo. Official catalogue install may be allowed later.
// Do not edit plugin modules from this file. GET catalogue routes are left alone.

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

/** A refusal message for a mutating demo request, or null when the request may continue. */
export function demoMutationRefusal(method: string, path: string): string | null {
  const verb = method.toUpperCase()
  if (SAFE.has(verb)) return null
  const bare = path.split('?')[0] ?? path
  // Every mutating path under /api/v1/plugins, including a future /api/v1/plugins/repository/install.
  if (bare === '/api/v1/plugins' || bare.startsWith('/api/v1/plugins/')) return 'Plugin installs are turned off on the public demo.'
  if (bare === '/api/v1/ai' || bare.startsWith('/api/v1/ai/')) return 'AI calls are turned off on the public demo.'
  if (bare.startsWith('/api/v1/settings/ai')) return 'AI settings are turned off on the public demo.'
  if (bare.startsWith('/api/v1/settings/mail')) return 'Mail settings are turned off on the public demo.'
  if (bare.startsWith('/api/v1/agent/tokens') || bare.startsWith('/api/v1/agent/webhook')) return 'Agent tokens and webhooks are turned off on the public demo.'
  if (bare === '/api/v1/users' || bare.startsWith('/api/v1/users/')) return 'User changes are turned off on the public demo.'
  if (bare === '/api/v1/backups' || bare.startsWith('/api/v1/backups/')) return 'Backups are turned off on the public demo.'
  if (bare.startsWith('/api/v1/settings/secrets')) return 'Secrets are turned off on the public demo.'
  if (bare.includes('/suggest-alt')) return 'AI suggestions are turned off on the public demo.'
  return null
}
