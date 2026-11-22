import { presetsView } from '../../../services/agent/admin'
import { defineApi, requireActor } from '../../../utils/api'

export default defineApi((event) => presetsView(requireActor(event)))
