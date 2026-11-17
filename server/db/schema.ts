// Database schema (SQLite via Drizzle). Portable on purpose: text ids, ISO 8601 text timestamps,
// JSON as text, so a Postgres schema can follow later. See docs/13-data-model.md and ADR 0009.
import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const id = () => text('id').primaryKey()
const siteId = () => text('site_id').notNull().references(() => sites.id)
const createdAt = () => text('created_at').notNull()
const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>()
const bool = (name: string) => integer(name, { mode: 'boolean' })

export const sites = sqliteTable('sites', {
  id: id(),
  name: text('name').notNull(),
  primaryDomain: text('primary_domain'),
  defaultLocale: text('default_locale').notNull().default('en'),
  settings: json<Record<string, unknown>>('settings').notNull().default(sql`'{}'`),
  createdAt: createdAt(),
})

export const users = sqliteTable(
  'users',
  {
    id: id(),
    siteId: siteId(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: text('role', { enum: ['editor', 'approver', 'admin'] }).notNull(),
    isOperator: bool('is_operator').notNull().default(false),
    status: text('status', { enum: ['invited', 'active', 'deactivated'] }).notNull(),
    passwordHash: text('password_hash'),
    createdAt: createdAt(),
    lastLoginAt: text('last_login_at'),
  },
  (t) => [uniqueIndex('users_site_email').on(t.siteId, t.email)],
)

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(), // SHA-256 of the raw token, hex
  siteId: siteId(),
  userId: text('user_id').notNull().references(() => users.id),
  createdAt: createdAt(),
  lastSeenAt: text('last_seen_at').notNull(),
  expiresAt: text('expires_at').notNull(),
})

export const authTokens = sqliteTable('auth_tokens', {
  id: text('id').primaryKey(), // SHA-256 of the raw token, hex
  siteId: siteId(),
  userId: text('user_id').notNull().references(() => users.id),
  purpose: text('purpose', { enum: ['invite', 'reset'] }).notNull(),
  createdAt: createdAt(),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
})

const workflowState = () => text('workflow_state', { enum: ['draft', 'in_review', 'approved', 'published', 'unpublished'] }).notNull().default('draft')
const heads = () => ({
  draftVersionId: text('draft_version_id'),
  publishedVersionId: text('published_version_id'),
  draftRevision: integer('draft_revision').notNull().default(0),
  workflowState: workflowState(),
  wasUnpublished: bool('was_unpublished').notNull().default(false),
})

export const pages = sqliteTable(
  'pages',
  {
    id: id(),
    siteId: siteId(),
    parentId: text('parent_id'),
    slug: text('slug').notNull(),
    path: text('path').notNull(),
    publishedPath: text('published_path'),
    locale: text('locale').notNull().default('en'),
    template: text('template').notNull(),
    title: text('title').notNull(),
    isSystem: bool('is_system').notNull().default(false),
    ...heads(),
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (t) => [index('pages_site_path').on(t.siteId, t.locale, t.path), index('pages_site_state').on(t.siteId, t.workflowState)],
)

export const siteParts = sqliteTable(
  'site_parts',
  {
    id: id(),
    siteId: siteId(),
    kind: text('kind', { enum: ['header', 'footer', 'menu', 'banner'] }).notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    ...heads(),
    createdAt: createdAt(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('site_parts_site_kind_key').on(t.siteId, t.kind, t.key)],
)

export const templates = sqliteTable(
  'templates',
  {
    id: id(),
    siteId: siteId(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    ...heads(),
    createdAt: createdAt(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('templates_site_key').on(t.siteId, t.key)],
)

export const brandPacks = sqliteTable('brand_packs', {
  id: id(),
  siteId: siteId(),
  ...heads(),
  createdAt: createdAt(),
  updatedAt: text('updated_at').notNull(),
})

export const TARGET_TYPES = ['page', 'site_part', 'template', 'brand'] as const
export type VersionTargetType = (typeof TARGET_TYPES)[number]

export const versions = sqliteTable(
  'versions',
  {
    id: id(),
    siteId: siteId(),
    targetType: text('target_type', { enum: TARGET_TYPES }).notNull(),
    targetId: text('target_id').notNull(),
    number: integer('number').notNull(),
    doc: json<Record<string, unknown>>('doc').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    kind: text('kind', { enum: ['autosave', 'ai', 'checkpoint', 'submitted', 'published', 'restored', 'created'] }).notNull(),
    /** "user:<id>" or "ai:<sessionId>", used for autosave coalescing. */
    actorKey: text('actor_key').notNull(),
    authorId: text('author_id').notNull(),
    aiSessionId: text('ai_session_id'),
    summary: text('summary'),
    sealed: bool('sealed').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('versions_target_number').on(t.targetType, t.targetId, t.number)],
)

export const draftOps = sqliteTable(
  'draft_ops',
  {
    id: id(),
    siteId: siteId(),
    targetType: text('target_type', { enum: TARGET_TYPES }).notNull(),
    targetId: text('target_id').notNull(),
    revision: integer('revision').notNull(),
    actorKey: text('actor_key').notNull(),
    userId: text('user_id').notNull(),
    aiSessionId: text('ai_session_id'),
    op: json<Record<string, unknown>>('op').notNull(),
    inverse: json<Record<string, unknown>>('inverse').notNull(),
    touches: json<string[]>('touches').notNull(),
    undoOf: text('undo_of'),
    undoneAt: text('undone_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('draft_ops_target_revision').on(t.targetType, t.targetId, t.revision)],
)

export const reviews = sqliteTable(
  'reviews',
  {
    id: id(),
    siteId: siteId(),
    targetType: text('target_type', { enum: TARGET_TYPES }).notNull(),
    targetId: text('target_id').notNull(),
    versionId: text('version_id').notNull(),
    state: text('state', { enum: ['pending', 'sent_back', 'withdrawn', 'approved', 'published', 'failed'] }).notNull(),
    note: text('note'),
    changeSummary: text('change_summary'),
    submittedBy: text('submitted_by').notNull(),
    decidedBy: text('decided_by'),
    decidedAt: text('decided_at'),
    decisionComment: text('decision_comment'),
    overrideReason: text('override_reason'),
    selfApproved: bool('self_approved').notNull().default(false),
    jobId: text('job_id'),
    createdAt: createdAt(),
  },
  (t) => [index('reviews_site_state').on(t.siteId, t.state)],
)

export const reviewComments = sqliteTable('review_comments', {
  id: id(),
  siteId: siteId(),
  reviewId: text('review_id').notNull().references(() => reviews.id),
  blockId: text('block_id'),
  authorId: text('author_id').notNull(),
  body: text('body').notNull(),
  createdAt: createdAt(),
})

export const media = sqliteTable('media', {
  id: id(),
  siteId: siteId(),
  kind: text('kind', { enum: ['image', 'video', 'svg'] }).notNull(),
  filename: text('filename').notNull(),
  mime: text('mime').notNull(),
  bytes: integer('bytes').notNull(),
  width: integer('width'),
  height: integer('height'),
  sha256: text('sha256').notNull(),
  alt: text('alt'),
  decorative: bool('decorative').notNull().default(false),
  focalX: integer('focal_x'),
  focalY: integer('focal_y'),
  placeholder: text('placeholder'),
  dominantColor: text('dominant_color'),
  status: text('status', { enum: ['processing', 'ready', 'failed'] }).notNull(),
  uploadedBy: text('uploaded_by').notNull(),
  createdAt: createdAt(),
  deletedAt: text('deleted_at'),
})

export const mediaCrops = sqliteTable('media_crops', {
  id: id(),
  siteId: siteId(),
  mediaId: text('media_id').notNull().references(() => media.id),
  ratio: text('ratio').notNull(), // for example "16:9"
  breakpoint: text('breakpoint').notNull().default('all'),
  x: integer('x').notNull(),
  y: integer('y').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  approvedBy: text('approved_by').notNull(),
  approvedAt: text('approved_at').notNull(),
})

export const embeds = sqliteTable('embeds', {
  id: id(),
  siteId: siteId(),
  provider: text('provider').notNull(), // for example "virtuous", "youtube", "tally"
  name: text('name').notNull(),
  config: json<Record<string, unknown>>('config').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
  archivedAt: text('archived_at'),
})

export const redirects = sqliteTable(
  'redirects',
  {
    id: id(),
    siteId: siteId(),
    fromPath: text('from_path').notNull(),
    toPath: text('to_path').notNull(),
    statusCode: integer('status_code').notNull().default(301),
    source: text('source', { enum: ['manual', 'slug_change', 'unpublish'] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('redirects_site_from').on(t.siteId, t.fromPath)],
)

export interface ReleaseManifest {
  pages: Record<string, { versionId: string; path: string }>
  siteParts: Record<string, string>
  brandVersionId: string | null
  theme: string
  bundleId: string
}

export const releases = sqliteTable('releases', {
  id: id(),
  siteId: siteId(),
  kind: text('kind', { enum: ['publish', 'rollback', 'full_render'] }).notNull(),
  state: text('state', { enum: ['building', 'live', 'failed', 'superseded'] }).notNull(),
  manifest: json<ReleaseManifest>('manifest').notNull(),
  createdBy: text('created_by').notNull(),
  reviewId: text('review_id'),
  rolledBackTo: text('rolled_back_to'),
  reason: text('reason'),
  selfApproved: bool('self_approved').notNull().default(false),
  error: text('error'),
  createdAt: createdAt(),
  finishedAt: text('finished_at'),
})

export const JOB_KINDS = ['publish', 'render_preview', 'media_renditions', 'run_checks', 'send_email', 'backup', 'purge_cache', 'bin_cleanup'] as const
export type JobKind = (typeof JOB_KINDS)[number]

export const jobs = sqliteTable(
  'jobs',
  {
    id: id(),
    siteId: siteId(),
    kind: text('kind', { enum: JOB_KINDS }).notNull(),
    lane: text('lane', { enum: ['publish', 'media', 'light'] }).notNull(),
    payload: json<Record<string, unknown>>('payload').notNull(),
    state: text('state', { enum: ['queued', 'running', 'done', 'failed'] }).notNull(),
    runAt: text('run_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(4),
    leaseUntil: text('lease_until'),
    lastError: text('last_error'),
    result: json<Record<string, unknown>>('result'),
    createdBy: text('created_by'),
    createdAt: createdAt(),
    finishedAt: text('finished_at'),
  },
  (t) => [index('jobs_lane_state_run_at').on(t.lane, t.state, t.runAt)],
)

export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: id(),
    siteId: siteId(),
    at: text('at').notNull(),
    actorType: text('actor_type', { enum: ['user', 'ai', 'system'] }).notNull(),
    actorId: text('actor_id'),
    aiSessionId: text('ai_session_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    details: json<Record<string, unknown>>('details'),
  },
  (t) => [index('audit_site_at').on(t.siteId, t.at)],
)

export const aiSessions = sqliteTable('ai_sessions', {
  id: id(),
  siteId: siteId(),
  userId: text('user_id').notNull().references(() => users.id),
  taskType: text('task_type', { enum: ['new_page', 'page_edit', 'template', 'brand_design'] }).notNull(),
  targetType: text('target_type', { enum: ['page', 'template', 'brand'] }).notNull(),
  targetId: text('target_id').notNull(),
  state: text('state', { enum: ['active', 'parked', 'ended'] }).notNull(),
  model: text('model'),
  tokensIn: integer('tokens_in').notNull().default(0),
  tokensOut: integer('tokens_out').notNull().default(0),
  costMicros: integer('cost_micros').notNull().default(0),
  createdAt: createdAt(),
  endedAt: text('ended_at'),
})

export const aiMessages = sqliteTable('ai_messages', {
  id: id(),
  siteId: siteId(),
  sessionId: text('session_id').notNull().references(() => aiSessions.id),
  role: text('role', { enum: ['user', 'assistant', 'tool'] }).notNull(),
  content: json<Record<string, unknown>>('content').notNull(),
  createdAt: createdAt(),
})

export const memoryEntries = sqliteTable('memory_entries', {
  id: id(),
  siteId: siteId(),
  scope: text('scope', { enum: ['site', 'user'] }).notNull(),
  userId: text('user_id'),
  text: text('text').notNull(),
  state: text('state', { enum: ['proposed', 'active'] }).notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
})

export const notifications = sqliteTable('notifications', {
  id: id(),
  siteId: siteId(),
  userId: text('user_id').notNull().references(() => users.id),
  kind: text('kind').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  message: text('message').notNull(),
  readAt: text('read_at'),
  createdAt: createdAt(),
})

export const secrets = sqliteTable(
  'secrets',
  {
    id: id(),
    siteId: siteId(),
    name: text('name').notNull(),
    ciphertext: text('ciphertext').notNull(), // base64: iv (12) + tag (16) + data, AES-256-GCM
    updatedBy: text('updated_by').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('secrets_site_name').on(t.siteId, t.name)],
)

/** One-time Google OAuth state. The nonce is stored here and deleted when the callback runs, so the signed state cannot be replayed. */
export const oauthStates = sqliteTable(
  'oauth_states',
  {
    nonce: text('nonce').primaryKey(),
    siteId: siteId(),
    userId: text('user_id').notNull(),
    purpose: text('purpose').notNull(),
    createdAt: createdAt(),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [index('oauth_states_expires_at').on(t.expiresAt)],
)

