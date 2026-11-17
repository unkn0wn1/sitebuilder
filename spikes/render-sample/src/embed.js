// Tiny client island: load the registered Virtuous form when it is close to view.
// The third-party script itself is not part of our JavaScript budget.
const root = document.querySelector('[data-embed="virtuous"]')
if (root instanceof HTMLElement) {
  const load = () => {
    if (root.dataset.loaded) return
    root.dataset.loaded = '1'
    const src = root.dataset.src
    if (!src) return
    const script = document.createElement('script')
    script.src = src
    script.async = true
    if (root.dataset.vform) script.dataset.vform = root.dataset.vform
    if (root.dataset.orgId) script.dataset.orgId = root.dataset.orgId
    script.dataset.isGiving = 'true'
    script.dataset.dependencies = '[]'
    script.onerror = () => {
      const fallback = root.querySelector('.embed-fallback')
      if (fallback) fallback.hidden = false
    }
    root.append(script)
  }
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect()
        load()
      }
    }, { rootMargin: '200px' })
    io.observe(root)
  } else {
    load()
  }
}
