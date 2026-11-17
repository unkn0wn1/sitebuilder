import { applyResolvedTheme, readThemePreference, resolvedTheme, THEME_STORAGE_KEY, type ThemePreference } from '../utils/theme'

export function useColorMode() {
  const preference = useState<ThemePreference>('sb-theme-preference', () => 'system')
  const systemDark = useState('sb-theme-system-dark', () => false)
  const resolved = computed(() => resolvedTheme(preference.value, systemDark.value))

  function apply() {
    if (!import.meta.client) return
    applyResolvedTheme(resolved.value, document.documentElement)
  }

  function setPreference(next: ThemePreference) {
    preference.value = next
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      /* private mode */
    }
    apply()
  }

  function cycle() {
    const order: ThemePreference[] = ['system', 'light', 'dark']
    setPreference(order[(order.indexOf(preference.value) + 1) % order.length]!)
  }

  onMounted(() => {
    preference.value = readThemePreference(localStorage.getItem(THEME_STORAGE_KEY))
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    systemDark.value = media.matches
    const onChange = (event: MediaQueryListEvent) => {
      systemDark.value = event.matches
      apply()
    }
    media.addEventListener('change', onChange)
    apply()
    onBeforeUnmount(() => media.removeEventListener('change', onChange))
  })

  return { preference, resolved, setPreference, cycle }
}
