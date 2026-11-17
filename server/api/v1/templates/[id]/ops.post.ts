import { z } from 'zod'
import { editTemplate } from '../../../../services/templates'
import { defineApi, param, parseBody, requireActor } from '../../../../utils/api'

const schema = z.object({ baseRevision: z.number().int().min(0), ops: z.array(z.object({ op: z.literal('replace'), doc: z.record(z.string(), z.unknown()) }).strict()).length(1) }).strict()

export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  const { baseRevision, ops } = await parseBody(event, schema)
  return editTemplate(ctx, actor, param(event, 'id'), baseRevision, ops[0]!.doc)
})
