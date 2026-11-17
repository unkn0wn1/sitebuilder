import { api, ApiError } from '../utils/api'
import type { Role } from '#shared/roles'

export interface SessionUser {
  id: string
  name: string
  email: string
  role: Role
  isOperator: boolean
}

export interface SessionSite {
  name: string
  primaryDomain: string | null
}

export function useSession() {
  const user = useState<SessionUser | null>('session-user', () => null)
  const site = useState<SessionSite | null>('session-site', () => null)
  const loaded = useState('session-loaded', () => false)

  async function load() {
    try {
      const data = await api<{ user: SessionUser; site: SessionSite }>('/auth/me')
      user.value = data.user
      site.value = data.site
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error
      user.value = null
      site.value = null
    } finally {
      loaded.value = true
    }
  }

  async function login(email: string, password: string) {
    const data = await api<{ user: SessionUser; site?: SessionSite }>('/auth/login', { method: 'POST', body: { email, password } })
    user.value = data.user
    if (data.site) site.value = data.site
    else await load()
    loaded.value = true
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST', body: {} })
    user.value = null
    await navigateTo('/login')
  }

  return { user, site, loaded, load, login, logout }
}
