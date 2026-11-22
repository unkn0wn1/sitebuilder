// Compiled plugin blocks for the process. renderPageHtml does not read the database.
import type { ComputedField, PluginHead } from '../../../shared/plugins/manifest'
import type { CompiledTemplate } from '../../../shared/plugins/template'
import type { ComputedValue } from '../../../shared/plugins/compute'

export interface PluginBlockRuntime {
  storedType: string
  pluginId: string
  css: string
  head: PluginHead[]
  csp: { img: string[]; frame: string[]; connect: string[]; font: string[] }
  settings: Record<string, unknown>
  computed: ComputedField[]
  imageSlots?: Record<string, { width: number; height: number }>
  render: CompiledTemplate
}

let current = new Map<string, PluginBlockRuntime>()

export function replacePluginRuntimes(blocks: readonly PluginBlockRuntime[]): void {
  const next = new Map<string, PluginBlockRuntime>()
  for (const block of blocks) next.set(block.storedType, block)
  current = next
}

export function clearPluginRuntimes(): void {
  current = new Map()
}

export function getPluginRuntime(storedType: string): PluginBlockRuntime | undefined {
  return current.get(storedType)
}

export type { ComputedValue }
