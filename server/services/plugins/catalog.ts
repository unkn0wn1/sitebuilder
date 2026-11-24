// Enabled plugin blocks for the editor. Field specs use the same Zod walk as core sections.
import type { BlockRegistry } from '../../../shared/blocks/registry'
import { describeProps, type PluginCatalogBlock } from '../../../app/utils/block-fields'

export function pluginCatalog(registry: BlockRegistry): PluginCatalogBlock[] {
  const blocks: PluginCatalogBlock[] = []
  for (const def of registry.list()) {
    if (!def.plugin) continue
    blocks.push({
      type: def.type,
      label: def.label,
      category: def.category,
      trust: def.plugin.trust === 'official' ? 'Official' : 'Self-installed',
      version: def.version,
      sample: def.sample as Record<string, unknown>,
      imageSlots: def.imageSlots ?? {},
      fields: describeProps(def.props),
    })
  }
  return blocks
}
