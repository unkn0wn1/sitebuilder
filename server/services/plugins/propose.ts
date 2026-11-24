// An agent proposes a plugin. A person approves it. Rules and always-allow cannot install it.
import { and, eq } from 'drizzle-orm'
import type { AgentRule } from '../../../shared/agent/rules'
import { newId } from '../../../shared/ids'
import { ArchiveError, writeTarGz } from '../../../shared/plugins/archive'
import { pluginProposals } from '../../db/schema'
import { audit } from '../audit'
import { tokenRules, type SignedInAgent } from '../agent/tokens'
import { inTx, iso, type ServiceCtx } from '../context'
import { AppError } from '../errors'
import { preparePluginArchive } from './install'

const TEXT_ONLY = 'Upload this plugin from Settings, Plugins. The agent tool accepts text files only.'
const NEXT_STEPS = 'Nothing is installed until a person approves it on Settings, Plugins. Rules and always-allow cannot install it.'
const MAX_BYTES = 512 * 1024
const MAX_FILES = 32
const TEXT_EXT = /\.(json|html|css|svg)$/

function denyAllRule(rules: AgentRule[]): AgentRule | undefined {
  const scoped = (rule: AgentRule) => !!(rule.targets.pageTemplates?.length || rule.targets.pagePaths?.length || rule.targets.siteParts?.length)
  return rules.find((rule) => rule.result === 'deny' && rule.actions === '*' && !scoped(rule))
}

function packFiles(files: Record<string, string>): Buffer {
  const entries = Object.entries(files)
  if (entries.length > MAX_FILES) {
    throw new AppError('validation_failed', 'This plugin has more than 32 files. The agent tool accepts at most 32.', [{ path: 'files', message: 'This plugin has more than 32 files. The agent tool accepts at most 32.' }])
  }
  let total = 0
  const packed: { path: string; bytes: Buffer }[] = []
  for (const [path, text] of entries) {
    if (!TEXT_EXT.test(path)) {
      throw new AppError('validation_failed', TEXT_ONLY, [{ path, message: TEXT_ONLY }])
    }
    const bytes = Buffer.from(text, 'utf8')
    total += bytes.length
    packed.push({ path, bytes })
  }
  if (total > MAX_BYTES) {
    throw new AppError('validation_failed', 'This plugin is over 512 KiB. The agent tool accepts at most 512 KiB of text.', [{ path: 'files', message: 'This plugin is over 512 KiB. The agent tool accepts at most 512 KiB of text.' }])
  }
  try {
    return writeTarGz(packed)
  } catch (error) {
    if (error instanceof ArchiveError) throw new AppError('validation_failed', error.message, [{ path: error.path, message: error.message }])
    throw error
  }
}

export async function proposePlugin(ctx: ServiceCtx, agent: SignedInAgent, input: { files: Record<string, string>; reason: string }) {
  if (agent.token.access !== 'draft') throw new AppError('forbidden', 'This token is read-only. Ask the site owner for a token that can make drafts.')
  const deny = denyAllRule(tokenRules(agent.token))
  if (deny) {
    throw new AppError('rule_denied', `Rule "${deny.label}" on this token does not allow a plugin proposal, so nothing was saved.`, undefined, { ruleId: deny.id })
  }
  const archive = packFiles(input.files)
  const prepared = await preparePluginArchive(archive, null)
  const { manifest, hashed } = prepared
  const waiting = ctx.db
    .select({ id: pluginProposals.id })
    .from(pluginProposals)
    .where(and(eq(pluginProposals.siteId, ctx.siteId), eq(pluginProposals.pluginId, manifest.id), eq(pluginProposals.status, 'pending')))
    .get()
  if (waiting) {
    throw new AppError('conflict', 'A proposal for this plugin is already waiting for a person.', [{ path: 'files', message: 'A proposal for this plugin is already waiting for a person.' }])
  }
  const id = newId('pluginProposal', ctx.now().getTime())
  inTx(ctx, () => {
    ctx.db
      .insert(pluginProposals)
      .values({
        id,
        siteId: ctx.siteId,
        tokenId: agent.token.id,
        agentLabel: agent.token.name,
        status: 'pending',
        archive,
        contentHash: hashed.hex,
        pluginId: manifest.id,
        version: manifest.version,
        reason: input.reason,
        createdAt: iso(ctx),
      })
      .run()
    audit(ctx, agent.actor, 'plugin.proposal_created', { type: 'plugin_proposal', id }, {
      tokenId: agent.token.id,
      proposalId: id,
      pluginId: manifest.id,
      version: manifest.version,
      contentHash: hashed.hex,
      reason: input.reason,
    })
  })
  return {
    proposal_id: id,
    status: 'pending' as const,
    plugin_id: manifest.id,
    version: manifest.version,
    trust: 'Self-installed' as const,
    next_steps: NEXT_STEPS,
  }
}
