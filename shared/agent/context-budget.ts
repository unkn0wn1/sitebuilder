// How much an AI agent may have to load from us, and the limits strict MCP clients enforce.
// Decided 22 Nov 2026: target models have at least 256k tokens of context, and everything an agent loads from us
// (server instructions, the tool list, guides and recipes, its rules, behaviours and soul.md) must fit in 128k tokens,
// leaving the other half for the conversation and tool results. tests/agent-mcp.test.ts holds the real text to these.

/** Smallest context window we design for. */
export const MIN_CONTEXT_TOKENS = 256_000
/** Everything an agent loads from us, together. */
export const AGENT_LOAD_BUDGET_TOKENS = 128_000
/**
 * Characters per token used to turn budgets into character limits. English prose is about 4 characters a token,
 * JSON schemas and ids nearer 3, so 3 is the cautious figure: a limit in characters never undercounts tokens.
 */
export const CHARS_PER_TOKEN = 3

/** Per-item budgets in tokens. They add up to AGENT_LOAD_BUDGET_TOKENS. */
export const AGENT_BUDGET_TOKENS = {
  /** MCP initialize instructions. Also capped by strict clients (SERVER_INSTRUCTIONS_ESSENTIALS_MAX_CHARS). */
  serverInstructions: 4_000,
  /** The whole tools/list reply: every name, description, input schema and annotation. */
  toolList: 48_000,
  /** Every guide and recipe resource, including the full instructions (prompts reuse the recipe text). */
  guides: 18_000,
  /** get_site / sitebuilder://you for one token, including all its rules at their largest. */
  rules: 10_000,
  /** Ready-made behaviours (not built yet; reserved). */
  behaviours: 12_000,
  /** soul.md, the admin-edited AI personality (not built yet; reserved, comments stripped before counting). */
  soul: 16_000,
  /** Unallocated, so one item can grow without re-planning. */
  headroom: 20_000,
} as const

export const budgetChars = (tokens: number) => tokens * CHARS_PER_TOKEN

// Strict clients. These are limits other people's software enforces, not ours.
/** Claude Code cuts every tool description and the server instructions at 2048 characters. */
export const TOOL_DESCRIPTION_MAX_CHARS = 2048
/** The instructions may be longer, but their first part must stand alone within Claude Code's 2048 characters. */
export const SERVER_INSTRUCTIONS_ESSENTIALS_MAX_CHARS = 2048
/**
 * Codex keeps about 1000 bytes of a plugin-installed server's tool description (OpenAI function descriptions: 1024
 * characters). So the first line of every description (what the tool is and does) must fit in 1000 bytes by itself.
 */
export const TOOL_SUMMARY_MAX_BYTES = 1000

/** Saved rules on one token, as compact JSON (get_site pretty-prints them, about a third longer). Leaves the rest of the rules budget for the other get_site fields. */
export const AGENT_RULES_MAX_CHARS = 18_000
