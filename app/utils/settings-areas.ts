// The settings areas, shared by the Settings grid and the navigation on each area's page.
import type { Action } from '#shared/roles'
import type { IconName } from '../components/ui/Icon.vue'

export const SETTINGS_AREAS: { to: string; label: string; note: string; need: Action; icon: IconName }[] = [
  { to: '/settings/general', label: 'General', note: 'Site name, domain, and how page titles are written.', need: 'settings.manage', icon: 'settings' },
  { to: '/settings/workflow', label: 'Workflow', note: 'Whether someone can approve their own changes.', need: 'settings.manage', icon: 'approvals' },
  { to: '/settings/integrations', label: 'Integrations', note: 'Cloudflare token and Google Workspace email.', need: 'settings.manage', icon: 'link' },
  { to: '/settings/ai', label: 'AI', note: 'Provider, key, caps, and a test call.', need: 'settings.manage', icon: 'sparkles' },
  { to: '/settings/tracking', label: 'Tracking', note: 'Google Analytics, Tag Manager, Plausible and Cookiebot.', need: 'settings.manage', icon: 'search' },
  { to: '/settings/seo', label: 'SEO and redirects', note: 'Indexing, the default social image, and address redirects.', need: 'settings.manage', icon: 'globe' },
  { to: '/settings/security', label: 'Security', note: 'Which embed providers pages may use.', need: 'settings.manage', icon: 'warning' },
  { to: '/settings/users', label: 'Users', note: 'Invite people, change roles, or deactivate an account.', need: 'users.manage', icon: 'users' },
  { to: '/settings/publishing', label: 'Publishing', note: 'Recent releases, activity, and emergency rollback.', need: 'release.read', icon: 'external' },
  { to: '/settings/backups', label: 'Backups', note: 'Stored backups and a button to make one now.', need: 'backups.manage', icon: 'copy' },
  { to: '/settings/system', label: 'System', note: 'Version, disk, queue and recent job failures.', need: 'system.read', icon: 'desktop' },
]
