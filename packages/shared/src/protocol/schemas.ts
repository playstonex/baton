/**
 * Zod runtime schemas for the WebSocket protocol — the single source of truth
 * for message validation at the daemon boundary.
 *
 * ## Why this exists
 *
 * Before this file, ClientMessage/DaemonMessage were plain TS interfaces with
 * zero runtime validation. A malformed message from an old or buggy client
 * would sail past `JSON.parse` and crash deep inside the agent manager. These
 * schemas reject bad messages at the wire boundary instead, with a structured
 * error the client can act on.
 *
 * ## Compatibility contract (Protocol vs Feature)
 *
 * - **Protocol layer is append-only forever.** Never remove a field, never make
 *   an optional field required, never narrow a type. New message variants are
 *   added as new union members. Bump PROTOCOL_VERSION only on a breaking change.
 * - **Features may require a newer peer.** Gate new behavior on the peer's
 *   advertised capabilities (see `supports()` in handshake.ts). Each gate is
 *   tagged `// COMPAT(<name>)` with a removal condition; `rg "COMPAT\("` lists
 *   the entire back-compat cleanup backlog.
 *
 * ## Strategy
 *
 * Schemas live alongside the existing TS interfaces (which remain the canonical
 * types consumed by app/mobile/cli). When the protocol stabilizes, the
 * interfaces can be derived via `z.infer<typeof XSchema>` and the hand-written
 * ones deleted — but that's a separate migration to avoid a big-bang change.
 *
 * @see handshake.ts for capability flags and the version negotiation
 */

import { z } from 'zod';
import type { ClientMessage, DaemonMessage } from './index.js';

// ── Primitive helpers ─────────────────────────────────────────────

/** Record<string, unknown> — used for tool args and arbitrary payloads. */
const record = z.record(z.string(), z.unknown());

// ── Handshake schemas ─────────────────────────────────────────────

const helloSchema = z.object({
  type: z.literal('hello'),
  version: z.number().default(2),
  channels: z.array(z.number()).default([0, 1, 2]),
  sessionId: z.string().optional(),
  capabilities: z.record(z.string(), z.boolean()).optional(),
});

const pingSchema = z.object({
  type: z.literal('ping'),
});

const pongSchema = z.object({
  type: z.literal('pong'),
});

const welcomeSchema = z.object({
  type: z.literal('welcome'),
  version: z.number(),
  sessionId: z.string(),
  clientId: z.string().optional(), // COMPAT(clientId): v2.2 — accurate name for sessionId
  agents: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      status: z.string(),
      projectPath: z.string(),
    }),
  ),
  serverTime: z.number(),
  features: z.record(z.string(), z.boolean()).optional(),
});

// ── Client → Daemon message schemas ───────────────────────────────

const terminalInputSchema = z.object({
  type: z.literal('terminal_input'),
  sessionId: z.string().min(1),
  data: z.string(),
});

const chatInputSchema = z.object({
  type: z.literal('chat_input'),
  sessionId: z.string().min(1),
  content: z.string(),
  model: z.string().optional(),
  messageId: z.string().optional(),
});

const steerInputSchema = z.object({
  type: z.literal('steer_input'),
  sessionId: z.string().min(1),
  content: z.string(),
});

const cancelTurnSchema = z.object({
  type: z.literal('cancel_turn'),
  sessionId: z.string().min(1),
});

const approveInputSchema = z.object({
  type: z.literal('approve_input'),
  sessionId: z.string().min(1),
  reason: z.string().optional(),
});

const rejectInputSchema = z.object({
  type: z.literal('reject_input'),
  sessionId: z.string().min(1),
  reason: z.string().optional(),
});

const modelListRequestSchema = z.object({
  type: z.literal('model_list_request'),
  sessionId: z.string().min(1),
});

const modelSelectSchema = z.object({
  type: z.literal('model_select'),
  sessionId: z.string().min(1),
  model: z.string(),
});

const reasoningEffortSelectSchema = z.object({
  type: z.literal('reasoning_effort_select'),
  sessionId: z.string().min(1),
  effort: z.enum(['low', 'medium', 'high']),
});

const thinkingConfigSelectSchema = z.object({
  type: z.literal('thinking_config_select'),
  sessionId: z.string().min(1),
  config: z.object({
    mode: z.enum(['budget', 'level', 'none', 'auto']),
    budget: z.number().optional(),
    level: z.enum(['none', 'auto', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
  }),
});

const accessModeSelectSchema = z.object({
  type: z.literal('access_mode_select'),
  sessionId: z.string().min(1),
  mode: z.enum(['on-request', 'full-access']),
});

const serviceTierSelectSchema = z.object({
  type: z.literal('service_tier_select'),
  sessionId: z.string().min(1),
  tier: z.enum(['default', 'fast']),
});

const gitBranchListRequestSchema = z.object({
  type: z.literal('git_branch_list_request'),
  sessionId: z.string().min(1),
});

const gitBranchSelectSchema = z.object({
  type: z.literal('git_branch_select'),
  sessionId: z.string().min(1),
  branch: z.string(),
});

const gitStatusRequestSchema = z.object({
  type: z.literal('git_status_request'),
  sessionId: z.string().min(1),
});

const gitCommitSchema = z.object({
  type: z.literal('git_commit'),
  sessionId: z.string().min(1),
  message: z.string(),
});

const gitPushSchema = z.object({
  type: z.literal('git_push'),
  sessionId: z.string().min(1),
});

const gitPullSchema = z.object({
  type: z.literal('git_pull'),
  sessionId: z.string().min(1),
});

const gitCreateBranchSchema = z.object({
  type: z.literal('git_create_branch'),
  sessionId: z.string().min(1),
  name: z.string(),
});

const controlSchema = z.object({
  type: z.literal('control'),
  action: z.string().min(1),
  sessionId: z.string().optional(),
  payload: record.optional(),
});

export const clientMessageSchema: z.ZodType<ClientMessage> = z.union([
  helloSchema,
  pingSchema,
  terminalInputSchema,
  chatInputSchema,
  steerInputSchema,
  cancelTurnSchema,
  approveInputSchema,
  rejectInputSchema,
  modelListRequestSchema,
  modelSelectSchema,
  reasoningEffortSelectSchema,
  thinkingConfigSelectSchema,
  accessModeSelectSchema,
  serviceTierSelectSchema,
  gitBranchListRequestSchema,
  gitBranchSelectSchema,
  gitStatusRequestSchema,
  gitCommitSchema,
  gitPushSchema,
  gitPullSchema,
  gitCreateBranchSchema,
  controlSchema,
]) as z.ZodType<ClientMessage>;

// ── Daemon → Client message schemas ───────────────────────────────

const terminalOutputSchema = z.object({
  type: z.literal('terminal_output'),
  sessionId: z.string(),
  data: z.string(),
  seq: z.number().int().nonnegative().optional(), // COMPAT(sessionResume)
});

const historyReplaySchema = z.object({
  type: z.literal('history_replay'),
  sessionId: z.string(),
  output: z.string(),
});

// ParsedEvent is a discriminated union by `type` and is defined across many
// variants in types/index.ts. We accept any object with a `type` string here —
// the event itself is produced by the daemon's own parser, so we trust our own
// output. Tighter event validation can be layered in incrementally.
const parsedEventSchema: z.ZodType<Record<string, unknown>> = z
  .object({
    type: z.string(),
  })
  .passthrough();

const parsedEventMessageSchema = z.object({
  type: z.literal('parsed_event'),
  sessionId: z.string(),
  event: parsedEventSchema,
  seq: z.number().int().nonnegative().optional(), // COMPAT(sessionResume)
});

const eventHistoryMessageSchema = z.object({
  type: z.literal('event_history'),
  sessionId: z.string(),
  events: z.array(parsedEventSchema),
});

const statusUpdateSchema = z.object({
  type: z.literal('status_update'),
  sessionId: z.string(),
  status: z.string(),
  seq: z.number().int().nonnegative().optional(), // COMPAT(sessionResume)
});

const agentListSchema = z.object({
  type: z.literal('agent_list'),
  agents: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      status: z.string(),
      projectPath: z.string(),
      mode: z.enum(['pty', 'sdk']).optional(),
      // COMPAT(sessionMeta): optional since v2.2 — older clients ignore them.
      title: z.string().optional(),
      startedAt: z.string().optional(),
      lastActivityAt: z.string().optional(),
      stoppedAt: z.string().optional(),
      archivedAt: z.string().optional(),
    }),
  ),
});

const permissionRequestSchema = z.object({
  type: z.literal('permission_request'),
  sessionId: z.string(),
  requestId: z.string(),
  tool: z.string(),
  action: z.string(),
  description: z.string(),
});

const sessionOwnershipSchema = z.object({
  type: z.literal('session_ownership'),
  sessionId: z.string(),
  owner: z.enum(['local', 'remote']),
  claimedBy: z.string(),
});

const healthScoreSchema = z.object({
  type: z.literal('health_score'),
  score: z.number(),
  metrics: z.object({
    successRate: z.number(),
    avgLatencyMs: z.number(),
    activeAgents: z.number(),
    errorCount24h: z.number(),
  }),
});

const accessModeMessageSchema = z.object({
  type: z.literal('access_mode'),
  mode: z.enum(['on-request', 'full-access']),
});

const resumeReplySchema = z.object({
  type: z.literal('resume_reply'),
  sessionId: z.string(),
  fromSeq: z.number().int().nonnegative(),
  toSeq: z.number().int().nonnegative(),
  currentSeq: z.number().int().nonnegative(),
  gap: z.boolean().optional(),
});

const modelListSchema = z.object({
  type: z.literal('model_list'),
  sessionId: z.string(),
  models: z.array(z.string()),
  selected: z.string().optional(),
});

const gitBranchListSchema = z.object({
  type: z.literal('git_branch_list'),
  sessionId: z.string(),
  branches: z.array(z.string()),
  currentBranch: z.string(),
});

const gitStatusSchema = z.object({
  type: z.literal('git_status'),
  sessionId: z.string(),
  status: z.string(),
  diff: z.string(),
  projectPath: z.string(),
});

const gitResultSchema = z.object({
  type: z.literal('git_result'),
  action: z.string(),
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
  sessionId: z.string().optional(),
  operation: z.string().optional(),
});

const ackSchema = z.object({
  type: z.literal('ack'),
  status: z.enum(['ok', 'error']),
  messageId: z.string(),
  error: z.string().optional(),
});

const errorSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
  code: z.string().optional(),
  replyToMessageId: z.string().optional(),
});

export const daemonMessageSchema: z.ZodType<DaemonMessage> = z.union([
  welcomeSchema,
  pongSchema,
  terminalOutputSchema,
  historyReplaySchema,
  parsedEventMessageSchema,
  eventHistoryMessageSchema,
  statusUpdateSchema,
  agentListSchema,
  permissionRequestSchema,
  sessionOwnershipSchema,
  healthScoreSchema,
  accessModeMessageSchema,
  resumeReplySchema,
  modelListSchema,
  gitBranchListSchema,
  gitStatusSchema,
  gitResultSchema,
  ackSchema,
  errorSchema,
]) as z.ZodType<DaemonMessage>;

// ── Boundary validators ───────────────────────────────────────────

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Validate a raw incoming client message. Returns a discriminated result
 * instead of throwing so callers can branch cleanly. The error string is
 * safe to echo back to the client.
 */
export function parseClientMessage(raw: unknown): ParseResult<ClientMessage> {
  const parsed = clientMessageSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, error: formatZodError(parsed.error, raw) };
}

/**
 * Validate a raw outgoing daemon message before it hits the wire. Used at the
 * transport boundary to guarantee clients never receive malformed frames.
 */
export function parseDaemonMessage(raw: unknown): ParseResult<DaemonMessage> {
  const parsed = daemonMessageSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, error: formatZodError(parsed.error, raw) };
}

/**
 * Render a ZodError as a human-readable string. For union failures (the common
 * case for protocol messages), pick the candidate schema whose `type` literal
 * matches the input's `type` — that's the user's likely intent and yields the
 * most useful error (e.g. "config.mode: Invalid option" instead of a useless
 * "(root): Invalid input").
 */
function formatZodError(err: z.ZodError, raw: unknown): string {
  const issues = err.issues as Array<z.ZodIssue & { errors?: z.ZodIssue[][] }>;
  const unionIssue = issues.find((i) => i.code === 'invalid_union' && i.errors?.length);
  if (unionIssue && unionIssue.errors) {
    const inputType =
      typeof raw === 'object' && raw !== null ? (raw as { type?: unknown }).type : undefined;
    const candidates = unionIssue.errors;
    // The candidate that matched the input's `type` literal is the user's
    // intent. It produces NO issue on the `type` path (because the literal
    // matched); every other candidate produces a type-mismatch issue there.
    // So: pick the candidate with no `type`-path issue; fall back to first.
    const best = inputType
      ? (candidates.find((sub) => !sub.some((iss) => iss.path[0] === 'type')) ?? candidates[0])
      : candidates[0];
    return `invalid message: ${best.map(formatIssue).join('; ')}`;
  }
  return `invalid message: ${issues.map(formatIssue).join('; ')}`;
}

function formatIssue(i: z.ZodIssue): string {
  const path = i.path.length > 0 ? i.path.join('.') : '(root)';
  return `${path}: ${i.message}`;
}
