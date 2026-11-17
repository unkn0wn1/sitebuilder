/**
 * Deep-clone JSON-shaped values, including Vue reactive proxies.
 * structuredClone() cannot clone those proxies, which leaves admin saves
 * stuck on "Saving…" with a DataCloneError.
 */
export function cloneDraft<T>(value: T): T {
  if (value === undefined) return value
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'could not be cloned'
    throw new Error(`Could not copy this draft (${reason}).`)
  }
}
