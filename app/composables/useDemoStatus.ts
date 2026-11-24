export interface DemoStatus {
  demo: boolean
  lastReset: string | null
  docsUrl: string | null
}

export function useDemoStatus() {
  const status = useState<DemoStatus | null>('demo-status', () => null)
  async function load() {
    if (status.value) return status.value
    try {
      status.value = await $fetch<DemoStatus>('/api/v1/demo/status')
    } catch {
      status.value = { demo: false, lastReset: null, docsUrl: null }
    }
    return status.value
  }
  return { status, load }
}
