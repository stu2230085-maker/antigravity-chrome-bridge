import { z } from 'zod';

// ============================================================================
// WebSocket Control & Data Messages (v1 + v2 session metadata)
// ============================================================================

export const KeepaliveMessageSchema = z.object({
  type: z.literal('keepalive'),
  timestamp: z.number().optional(),
  sessionId: z.string().optional(),
});

export const KeepaliveAckMessageSchema = z.object({
  type: z.literal('keepalive_ack'),
  timestamp: z.number().optional(),
});

export const PingMessageSchema = z.object({
  type: z.literal('ping'),
  timestamp: z.number().optional(),
  sessionId: z.string().optional(),
});

export const PongMessageSchema = z.object({
  type: z.literal('pong'),
  timestamp: z.number(),
});

export const BridgeReadyMessageSchema = z.object({
  type: z.literal('bridge_ready'),
  timestamp: z.number(),
  sessionId: z.string().optional(),
});

export const HelloMessageSchema = z.object({
  type: z.literal('hello'),
  sessionId: z.string().min(1).optional(),
  profile: z.string().min(1).optional(),
  version: z.string().optional(),
  userAgent: z.string().optional(),
  timestamp: z.number().optional(),
  token: z.string().optional(),
});

export type HelloMessage = z.infer<typeof HelloMessageSchema>;

/**
 * Command envelope sent from Server -> Extension over WebSocket.
 */
export const WsCommandEnvelopeSchema = z.object({
  id: z.string().min(1),
  action: z.string().min(1),
  params: z.record(z.unknown()).default({}),
  sessionId: z.string().optional(),
});

export type WsCommandEnvelope = z.infer<typeof WsCommandEnvelopeSchema>;

/**
 * Command response sent from Extension -> Server over WebSocket.
 * Allows passthrough fields from v1 extension responses (url, tabId, text, etc.).
 */
export const WsCommandResponseSchema = z
  .object({
    id: z.string().min(1),
    success: z.boolean(),
    error: z.string().optional(),
    sessionId: z.string().optional(),
  })
  .passthrough();

export type WsCommandResponse = z.infer<typeof WsCommandResponseSchema>;

export const ExtensionToServerMessageSchema = z.union([
  KeepaliveMessageSchema,
  PingMessageSchema,
  HelloMessageSchema,
  WsCommandResponseSchema,
]);

export type ExtensionToServerMessage = z.infer<typeof ExtensionToServerMessageSchema>;

export const ServerToExtensionMessageSchema = z.union([
  BridgeReadyMessageSchema,
  PongMessageSchema,
  KeepaliveAckMessageSchema,
  WsCommandEnvelopeSchema,
]);

export type ServerToExtensionMessage = z.infer<typeof ServerToExtensionMessageSchema>;

// ============================================================================
// HTTP API v2 Types (Sessions & Traces)
// ============================================================================

export const SessionSummarySchema = z.object({
  sessionId: z.string(),
  profile: z.string(),
  connectedAt: z.number(),
  lastSeenAt: z.number(),
  remoteAddress: z.string().optional(),
  version: z.string().optional(),
  active: z.boolean(),
});

export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const TraceEntrySchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  action: z.string(),
  startedAt: z.number(),
  durationMs: z.number(),
  success: z.boolean(),
  error: z.string().optional(),
});

export type TraceEntry = z.infer<typeof TraceEntrySchema>;

// ============================================================================
// HTTP API v2 Batch Execution Schemas
// ============================================================================

export const BatchStepSchema = z.object({
  action: z.string().min(1),
  params: z.record(z.unknown()).optional(),
  delayMs: z.number().int().min(0).optional(),
});

export type BatchStep = z.infer<typeof BatchStepSchema>;

export const BatchRequestSchema = z.object({
  steps: z.array(BatchStepSchema).min(1),
  stopOnError: z.boolean().optional(),
  sessionId: z.string().min(1).optional(),
});

export type BatchRequest = z.infer<typeof BatchRequestSchema>;

export const BatchStepResultSchema = z.object({
  index: z.number().int().min(0),
  action: z.string(),
  success: z.boolean(),
  id: z.string().optional(),
  durationMs: z.number().min(0),
  result: z.record(z.unknown()).optional(),
  error: z.string().optional(),
});

export type BatchStepResult = z.infer<typeof BatchStepResultSchema>;

export const BatchResponseSchema = z.object({
  success: z.boolean(),
  completedSteps: z.number().int().min(0),
  totalSteps: z.number().int().min(0),
  durationMs: z.number().min(0),
  results: z.array(BatchStepResultSchema),
});

export type BatchResponse = z.infer<typeof BatchResponseSchema>;

// ============================================================================
// HTTP API v2 Saved Workflows Schemas
// ============================================================================

export const SavedWorkflowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  steps: z.array(BatchStepSchema).min(1),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type SavedWorkflow = z.infer<typeof SavedWorkflowSchema>;

export const WorkflowUpsertSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  steps: z.array(BatchStepSchema).min(1),
});

export type WorkflowUpsertInput = z.infer<typeof WorkflowUpsertSchema>;

export const WorkflowRunRequestSchema = z.object({
  sessionId: z.string().min(1).optional(),
  stopOnError: z.boolean().optional(),
});

export type WorkflowRunRequest = z.infer<typeof WorkflowRunRequestSchema>;

// ============================================================================
// Snapshot & Telemetry Data Schemas
// ============================================================================

export const ElementRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export type ElementRect = z.infer<typeof ElementRectSchema>;

export const SnapshotElementSchema = z.object({
  ref: z.string(),
  role: z.string(),
  tagName: z.string(),
  label: z.string(),
  text: z.string(),
  value: z.string().optional(),
  placeholder: z.string().optional(),
  href: z.string().optional(),
  checked: z.boolean().optional(),
  disabled: z.boolean().optional(),
  visible: z.boolean(),
  rect: ElementRectSchema,
});

export type SnapshotElement = z.infer<typeof SnapshotElementSchema>;

export const ConsoleLogEntrySchema = z.object({
  level: z.enum(['error', 'warn', 'info', 'log']),
  text: z.string(),
  timestamp: z.number(),
  url: z.string().optional(),
  lineNumber: z.number().optional(),
});

export type ConsoleLogEntry = z.infer<typeof ConsoleLogEntrySchema>;

export const NetworkLogEntrySchema = z.object({
  requestId: z.string(),
  url: z.string(),
  method: z.string(),
  status: z.number().optional(),
  statusText: z.string().optional(),
  type: z.string().optional(),
  failed: z.boolean().optional(),
  errorText: z.string().optional(),
  timestamp: z.number(),
});

export type NetworkLogEntry = z.infer<typeof NetworkLogEntrySchema>;
