export type RecordedAction = 'navigate' | 'click' | 'type' | 'select' | 'press_key';

export interface RecordedStep {
  timestamp: number;
  action: RecordedAction;
  selector?: string;
  text?: string;
  value?: string;
  key?: string;
  url?: string;
  label?: string;
}

export type ExportFormat = 'batch_json' | 'cli_script' | 'sdk_code';

export interface CommandFeedItem {
  id: string;
  action: string;
  success: boolean;
  durationMs: number;
  timestamp: number;
  error?: string;
  source?: 'ws' | 'sidepanel';
}

export interface RecorderState {
  isRecording: boolean;
  recordingTabId: number | null;
  steps: RecordedStep[];
}
