import { z } from 'zod';

// ============================================================================
// Action names (25 v1 actions + 7 v2 actions = 32 total)
// ============================================================================

export const COMMAND_ACTIONS = [
  'navigate',
  'new_tab',
  'close_tab',
  'switch_tab',
  'go_back',
  'go_forward',
  'reload',
  'get_url',
  'get_tabs',
  'click',
  'click_at',
  'type',
  'hover',
  'select',
  'scroll',
  'get_content',
  'get_text',
  'get_elements',
  'screenshot',
  'iframe_click',
  'iframe_click_at',
  'iframe_get_elements',
  'iframe_get_text',
  'evaluate',
  'wait_for',
  // v2 actions
  'snapshot',
  'clear_marks',
  'press_key',
  'drag_and_drop',
  'upload_file',
  'get_console_logs',
  'get_network_logs',
] as const;

export const CommandActionSchema = z.enum(COMMAND_ACTIONS);
export type CommandAction = z.infer<typeof CommandActionSchema>;

// ============================================================================
// Common parameter schemas
// ============================================================================

const TabTargetParams = z.object({
  tabId: z.number().int().positive().optional(),
});

export const ExecutionEngineSchema = z.enum(['auto', 'scripting', 'cdp']);
export type ExecutionEngine = z.infer<typeof ExecutionEngineSchema>;

export const KeyModifierSchema = z.enum(['Alt', 'Control', 'Meta', 'Shift']);
export type KeyModifier = z.infer<typeof KeyModifierSchema>;

export const ConsoleLogLevelSchema = z.enum(['all', 'error', 'warn', 'info', 'log']);
export type ConsoleLogLevel = z.infer<typeof ConsoleLogLevelSchema>;

// ============================================================================
// Individual Command Param Schemas
// ============================================================================

export const NavigateParamsSchema = TabTargetParams.extend({
  url: z.string().min(1),
});

export const NewTabParamsSchema = z.object({
  url: z.string().optional(),
});

export const CloseTabParamsSchema = TabTargetParams;

export const SwitchTabParamsSchema = z.object({
  tabId: z.number().int().positive(),
});

export const GoBackParamsSchema = TabTargetParams;
export const GoForwardParamsSchema = TabTargetParams;
export const ReloadParamsSchema = TabTargetParams;
export const GetUrlParamsSchema = TabTargetParams;
export const GetTabsParamsSchema = z.object({});

const SelectorOrRefCheck = (val: { selector?: string; ref?: string }) =>
  Boolean(val.selector || val.ref);
const SelectorOrRefMessage = { message: 'Either selector or ref is required' };

export const ClickParamsSchema = TabTargetParams.extend({
  selector: z.string().min(1).optional(),
  ref: z.string().min(1).optional(),
  engine: ExecutionEngineSchema.optional(),
  allFrames: z.boolean().optional(),
}).refine(SelectorOrRefCheck, SelectorOrRefMessage);

export const ClickAtParamsSchema = TabTargetParams.extend({
  x: z.number(),
  y: z.number(),
  allFrames: z.boolean().optional(),
});

export const TypeParamsSchema = TabTargetParams.extend({
  selector: z.string().min(1).optional(),
  ref: z.string().min(1).optional(),
  text: z.string(),
  clear: z.boolean().optional(),
  engine: ExecutionEngineSchema.optional(),
  allFrames: z.boolean().optional(),
}).refine(SelectorOrRefCheck, SelectorOrRefMessage);

export const HoverParamsSchema = TabTargetParams.extend({
  selector: z.string().min(1).optional(),
  ref: z.string().min(1).optional(),
  engine: ExecutionEngineSchema.optional(),
  allFrames: z.boolean().optional(),
}).refine(SelectorOrRefCheck, SelectorOrRefMessage);

export const SelectParamsSchema = TabTargetParams.extend({
  selector: z.string().min(1).optional(),
  ref: z.string().min(1).optional(),
  value: z.string(),
  engine: ExecutionEngineSchema.optional(),
}).refine(SelectorOrRefCheck, SelectorOrRefMessage);

export const ScrollDirectionSchema = z.enum(['up', 'down', 'left', 'right']);

export const ScrollParamsSchema = TabTargetParams.extend({
  x: z.number().optional(),
  y: z.number().optional(),
  selector: z.string().min(1).optional(),
  ref: z.string().min(1).optional(),
  engine: ExecutionEngineSchema.optional(),
  direction: z.union([ScrollDirectionSchema, z.string()]).optional(),
  amount: z.number().optional(),
  allFrames: z.boolean().optional(),
});

export const GetContentParamsSchema = TabTargetParams.extend({
  selector: z.string().optional(),
  allFrames: z.boolean().optional(),
});

export const GetTextParamsSchema = TabTargetParams.extend({
  selector: z.string().optional(),
  allFrames: z.boolean().optional(),
});

export const GetElementsParamsSchema = TabTargetParams.extend({
  selector: z.string().min(1),
  limit: z.number().int().positive().optional(),
  allFrames: z.boolean().optional(),
});

export const ScreenshotParamsSchema = TabTargetParams.extend({
  format: z.enum(['png', 'jpeg']).optional(),
  quality: z.number().int().min(0).max(100).optional(),
  fullPage: z.boolean().optional(),
  selector: z.string().min(1).optional(),
  ref: z.string().min(1).optional(),
  markOverlay: z.boolean().optional(),
});

export const IframeClickParamsSchema = TabTargetParams.extend({
  selector: z.string().min(1),
  frameUrl: z.string().optional(),
});

export const IframeClickAtParamsSchema = TabTargetParams.extend({
  x: z.number(),
  y: z.number(),
  frameUrl: z.string().optional(),
});

export const IframeGetElementsParamsSchema = TabTargetParams.extend({
  selector: z.string().min(1),
  limit: z.number().int().positive().optional(),
  frameUrl: z.string().optional(),
});

export const IframeGetTextParamsSchema = TabTargetParams.extend({
  selector: z.string().optional(),
  frameUrl: z.string().optional(),
});

export const EvaluateParamsSchema = TabTargetParams.extend({
  code: z.string().min(1),
});

export const WaitForParamsSchema = TabTargetParams.extend({
  selector: z.string().min(1),
  timeout: z.number().int().positive().optional(),
});

// ============================================================================
// v2 Command Param Schemas
// ============================================================================

export const SnapshotParamsSchema = TabTargetParams.extend({
  interactiveOnly: z.boolean().optional(),
  markOverlay: z.boolean().optional(),
  maxElements: z.number().int().positive().optional(),
  includeShadowDom: z.boolean().optional(),
  allFrames: z.boolean().optional(),
});

export const ClearMarksParamsSchema = TabTargetParams;

export const PressKeyParamsSchema = TabTargetParams.extend({
  key: z.string().min(1),
  modifiers: z.array(KeyModifierSchema).optional(),
  selector: z.string().min(1).optional(),
  ref: z.string().min(1).optional(),
  text: z.string().optional(),
});

export const DragAndDropParamsSchema = TabTargetParams.extend({
  sourceSelector: z.string().min(1).optional(),
  sourceRef: z.string().min(1).optional(),
  targetSelector: z.string().min(1).optional(),
  targetRef: z.string().min(1).optional(),
  sourceX: z.number().optional(),
  sourceY: z.number().optional(),
  targetX: z.number().optional(),
  targetY: z.number().optional(),
}).refine(
  (val) => {
    const hasSource =
      Boolean(val.sourceSelector || val.sourceRef) ||
      (val.sourceX !== undefined && val.sourceY !== undefined);
    const hasTarget =
      Boolean(val.targetSelector || val.targetRef) ||
      (val.targetX !== undefined && val.targetY !== undefined);
    return hasSource && hasTarget;
  },
  { message: 'Source and target selectors/refs or coordinates are required' },
);

export const UploadFileParamsSchema = TabTargetParams.extend({
  selector: z.string().min(1).optional(),
  ref: z.string().min(1).optional(),
  files: z.array(z.string().min(1)).min(1),
}).refine(SelectorOrRefCheck, SelectorOrRefMessage);

export const GetConsoleLogsParamsSchema = TabTargetParams.extend({
  level: ConsoleLogLevelSchema.optional(),
  limit: z.number().int().positive().optional(),
  clear: z.boolean().optional(),
});

export const GetNetworkLogsParamsSchema = TabTargetParams.extend({
  urlPattern: z.string().min(1).optional(),
  errorsOnly: z.boolean().optional(),
  limit: z.number().int().positive().optional(),
  clear: z.boolean().optional(),
});

// ============================================================================
// Discriminated Union of Commands + Loose v1 Wire Schema
// ============================================================================

export const CommandParamsSchemas = {
  navigate: NavigateParamsSchema,
  new_tab: NewTabParamsSchema,
  close_tab: CloseTabParamsSchema,
  switch_tab: SwitchTabParamsSchema,
  go_back: GoBackParamsSchema,
  go_forward: GoForwardParamsSchema,
  reload: ReloadParamsSchema,
  get_url: GetUrlParamsSchema,
  get_tabs: GetTabsParamsSchema,
  click: ClickParamsSchema,
  click_at: ClickAtParamsSchema,
  type: TypeParamsSchema,
  hover: HoverParamsSchema,
  select: SelectParamsSchema,
  scroll: ScrollParamsSchema,
  get_content: GetContentParamsSchema,
  get_text: GetTextParamsSchema,
  get_elements: GetElementsParamsSchema,
  screenshot: ScreenshotParamsSchema,
  iframe_click: IframeClickParamsSchema,
  iframe_click_at: IframeClickAtParamsSchema,
  iframe_get_elements: IframeGetElementsParamsSchema,
  iframe_get_text: IframeGetTextParamsSchema,
  evaluate: EvaluateParamsSchema,
  wait_for: WaitForParamsSchema,
  snapshot: SnapshotParamsSchema,
  clear_marks: ClearMarksParamsSchema,
  press_key: PressKeyParamsSchema,
  drag_and_drop: DragAndDropParamsSchema,
  upload_file: UploadFileParamsSchema,
  get_console_logs: GetConsoleLogsParamsSchema,
  get_network_logs: GetNetworkLogsParamsSchema,
} as const;

export const TypedCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('navigate'), params: NavigateParamsSchema }),
  z.object({ action: z.literal('new_tab'), params: NewTabParamsSchema.default({}) }),
  z.object({ action: z.literal('close_tab'), params: CloseTabParamsSchema.default({}) }),
  z.object({ action: z.literal('switch_tab'), params: SwitchTabParamsSchema }),
  z.object({ action: z.literal('go_back'), params: GoBackParamsSchema.default({}) }),
  z.object({ action: z.literal('go_forward'), params: GoForwardParamsSchema.default({}) }),
  z.object({ action: z.literal('reload'), params: ReloadParamsSchema.default({}) }),
  z.object({ action: z.literal('get_url'), params: GetUrlParamsSchema.default({}) }),
  z.object({ action: z.literal('get_tabs'), params: GetTabsParamsSchema.default({}) }),
  z.object({ action: z.literal('click'), params: ClickParamsSchema }),
  z.object({ action: z.literal('click_at'), params: ClickAtParamsSchema }),
  z.object({ action: z.literal('type'), params: TypeParamsSchema }),
  z.object({ action: z.literal('hover'), params: HoverParamsSchema }),
  z.object({ action: z.literal('select'), params: SelectParamsSchema }),
  z.object({ action: z.literal('scroll'), params: ScrollParamsSchema.default({}) }),
  z.object({ action: z.literal('get_content'), params: GetContentParamsSchema.default({}) }),
  z.object({ action: z.literal('get_text'), params: GetTextParamsSchema.default({}) }),
  z.object({ action: z.literal('get_elements'), params: GetElementsParamsSchema }),
  z.object({ action: z.literal('screenshot'), params: ScreenshotParamsSchema.default({}) }),
  z.object({ action: z.literal('iframe_click'), params: IframeClickParamsSchema }),
  z.object({ action: z.literal('iframe_click_at'), params: IframeClickAtParamsSchema }),
  z.object({ action: z.literal('iframe_get_elements'), params: IframeGetElementsParamsSchema }),
  z.object({ action: z.literal('iframe_get_text'), params: IframeGetTextParamsSchema.default({}) }),
  z.object({ action: z.literal('evaluate'), params: EvaluateParamsSchema }),
  z.object({ action: z.literal('wait_for'), params: WaitForParamsSchema }),
  z.object({ action: z.literal('snapshot'), params: SnapshotParamsSchema.default({}) }),
  z.object({ action: z.literal('clear_marks'), params: ClearMarksParamsSchema.default({}) }),
  z.object({ action: z.literal('press_key'), params: PressKeyParamsSchema }),
  z.object({ action: z.literal('drag_and_drop'), params: DragAndDropParamsSchema }),
  z.object({ action: z.literal('upload_file'), params: UploadFileParamsSchema }),
  z.object({
    action: z.literal('get_console_logs'),
    params: GetConsoleLogsParamsSchema.default({}),
  }),
  z.object({
    action: z.literal('get_network_logs'),
    params: GetNetworkLogsParamsSchema.default({}),
  }),
]);

export type TypedCommand = z.infer<typeof TypedCommandSchema>;

/**
 * HTTP POST /command request body schema (backward-compatible with v1).
 */
export const HttpCommandRequestSchema = z.object({
  action: z.string().min(1),
  params: z.record(z.unknown()).optional(),
  sessionId: z.string().min(1).optional(),
});

export type HttpCommandRequest = z.infer<typeof HttpCommandRequestSchema>;

export type CommandValidationResult =
  | { ok: true; data: TypedCommand }
  | { ok: false; error: string };

export function validateTypedCommand(
  action: string,
  params: Record<string, unknown> = {},
): CommandValidationResult {
  const parsedAction = CommandActionSchema.safeParse(action);
  if (!parsedAction.success) {
    return {
      ok: false,
      error: `Unknown command action "${action}"`,
    };
  }

  const parsedCommand = TypedCommandSchema.safeParse({
    action: parsedAction.data,
    params,
  });
  if (!parsedCommand.success) {
    const issue = parsedCommand.error.issues[0];
    const field = issue && issue.path.length > 1 ? ` (${issue.path.slice(1).join('.')})` : '';
    return {
      ok: false,
      error: `Invalid parameters for "${action}"${field}: ${issue?.message ?? 'validation failed'}`,
    };
  }

  return { ok: true, data: parsedCommand.data };
}
