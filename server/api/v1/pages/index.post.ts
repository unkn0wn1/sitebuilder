import { z } from 'zod'
import { createPage } from '../../../services/pages'
import { defineApi, parseBody, requireActor } from '../../../utils/api'

const schema = z.object({ title: z.string().trim().min(1).max(120), template: z.string().min(1).max(64), parentId: z.string().max(64).nullish(), slug: z.string().max(80).optional() })

export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  const { page, doc } = createPage(ctx, actor, await parseBody(event, schema))
  return { page, doc, revision: page.draftRevision }
})
