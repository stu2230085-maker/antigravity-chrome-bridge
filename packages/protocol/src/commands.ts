import { z } from 'zod';

// ============================================================================
// Action names (25 v1 actions preserved 100%)
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
] as const;

export const CommandActionSchema = z.enum(COMMAND_ACTIONS);
export type CommandAction = z.infer<typeof CommandActionSchema>;

// ============================================================================
// Common parameter schemas
// ============================================================================

const TabTargetParams = z.object({
  tabId: z.number().int().positive().optional(),
});

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

export const ClickParamsSchema = TabTargetParams.extend({
  selector: z.string().min(1),
  allFrames: z.boolean().optional(),
});

export const ClickAtParamsSchema = TabTargetParams.extend({
  x: z.number(),
  y: z.number(),
  allFrames: z.boolean().optional(),
});

export const TypeParamsSchema = TabTargetParams.extend({
  selector: z.string().min(1),
  text: z.string(),
  clear: z.boolean().optional(),
  allFrames: z.boolean().optional(),
});

export const HoverParamsSchema = TabTargetParams.extend({
  selector: z.string().min(1),
  allFrames: z.boolean().optional(),
});

export const SelectParamsSchema = TabTargetParams.extend({
  selector: z.string().min(1),
  value: z.string(),
});

export const ScrollDirectionSchema = z.enum(['up', 'down', 'left', 'right']);

export const ScrollParamsSchema = TabTargetParams.extend({
  x: z.number().optional(),
  y: z.number().optional(),
  selector: z.string().optional(),
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
