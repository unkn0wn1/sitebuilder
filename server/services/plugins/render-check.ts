// Install-time render check. 3a accepts the package. 3b replaces this body.
import type { PluginManifest } from '../../../shared/plugins/manifest'

export interface RenderCheckInput {
  manifest: PluginManifest
  files: { path: string; bytes: Buffer }[]
}

export function testRenderPlugin(_input: RenderCheckInput): { ok: true } | { ok: false; path: string; message: string } {
  return { ok: true }
}
