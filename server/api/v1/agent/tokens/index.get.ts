import { agentGatewayEnabled } from '../../../../utils/agent'
import { agentsPaused, listAgentTokens } from '../../../../services/agent/tokens'
import { defineApi, requireActor } from '../../../../utils/api'

export default defineApi((event, ctx) => ({
  tokens: listAgentTokens(ctx, requireActor(event)),
  gatewayEnabled: agentGatewayEnabled(),
  allPaused: agentsPaused(ctx),
}))
