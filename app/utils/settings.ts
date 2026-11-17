import type { SiteSettings } from '#shared/settings'

export interface SettingsPayload {
  name: string
  primaryDomain: string | null
  settings: SiteSettings
  secretsSet: Record<string, boolean>
  mail: { transport: 'gmail' | 'outbox' | 'none'; googleConnected: boolean; googleAccount: string | null; from: string | null }
  xaiOauth: { enabled: boolean; connected: boolean; account: string | null }
}

export function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}
