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
