// Load installed plugins once the database is open. A bad plugin is disabled and does not stop listen.
import { AppError } from '../services/errors'
import { bootPlugins } from '../services/plugins/load'
import { getDbHandle } from '../utils/state'

export default defineNitroPlugin((nitro) => {
  if (import.meta.prerender) return
  let started = false
  const timer = setInterval(() => {
    if (started) return
    try {
      const { db } = getDbHandle()
      started = true
      clearInterval(timer)
      void bootPlugins(db).catch(() => {
        console.error(JSON.stringify({ level: 'error', msg: 'plugins did not load' }))
      })
    } catch (error) {
      if (error instanceof AppError && error.code === 'not_set_up') return
      started = true
      clearInterval(timer)
      console.error(JSON.stringify({ level: 'error', msg: 'plugins did not load' }))
    }
  }, 20)
  nitro.hooks.hook('close', () => clearInterval(timer))
})
