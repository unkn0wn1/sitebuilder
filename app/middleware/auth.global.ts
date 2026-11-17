export default defineNuxtRouteMiddleware(async (to) => {
  const { user, loaded, load } = useSession()
  if (!loaded.value) {
    try {
      await load()
    } catch {
      if (to.path !== '/login') return navigateTo({ path: '/login', query: { next: to.fullPath } })
      return
    }
  }
  if (to.path === '/login') {
    if (user.value) return navigateTo('/pages')
    return
  }
  if (!user.value) return navigateTo({ path: '/login', query: { next: to.fullPath } })
})
