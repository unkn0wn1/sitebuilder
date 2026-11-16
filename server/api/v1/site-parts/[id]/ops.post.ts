import { z } from 'zod'
import { editSitePart } from '../../../../services/site-parts'
import { defineApi, param, parseBody, requireActor } from '../../../../utils/api'

// Site parts are small, so the one operation replaces the whole document (validated per kind).
const schema = z.object({ baseRevision: z.number().int().min(0), ops: z.array(z.object({ op: z.literal('replace'), doc: z.record(z.string(), z.unknown()) }).strict()).length(1) }).strict()

export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  const { baseRevision, ops } = await parseBody(event, schema)
  return editSitePart(ctx, actor, param(event, 'id'), baseRevision, ops[0]!.doc)
})
