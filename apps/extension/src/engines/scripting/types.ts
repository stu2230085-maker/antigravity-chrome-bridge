export interface CommandResult {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface CommandRequest {
  id?: string;
  action: string;
  params?: Record<string, unknown>;
}
