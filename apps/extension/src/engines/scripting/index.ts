import { cmdDragAndDrop, cmdPressKey, cmdUploadFile } from '../cdp/actions.js';
import { cmdClearMarks, cmdSnapshot } from '../snapshot/index.js';
import {
  cmdEvaluate,
  cmdGetContent,
  cmdGetElements,
  cmdGetText,
  cmdScreenshot,
  cmdWaitFor,
} from './content.js';
import { cmdClick, cmdClickAt, cmdHover, cmdScroll, cmdSelect, cmdType } from './dom.js';
import {
  cmdIframeClick,
  cmdIframeClickAt,
  cmdIframeGetElements,
  cmdIframeGetText,
} from './iframe.js';
import {
  cmdCloseTab,
  cmdGetTabs,
  cmdGetUrl,
  cmdGoBack,
  cmdGoForward,
  cmdNavigate,
  cmdNewTab,
  cmdReload,
  cmdSwitchTab,
} from './navigation.js';
import type { CommandRequest, CommandResult } from './types.js';

export type { CommandRequest, CommandResult } from './types.js';

export async function executeCommand(command: CommandRequest): Promise<CommandResult> {
  if (!command || typeof command.action !== 'string' || !command.action.trim()) {
    return { success: false, error: 'Invalid command: missing action' };
  }

  const params =
    command.params && typeof command.params === 'object' && !Array.isArray(command.params)
      ? command.params
      : {};

  switch (command.action) {
    case 'navigate':
      return await cmdNavigate(params);
    case 'click':
      return await cmdClick(params);
    case 'type':
      return await cmdType(params);
    case 'scroll':
      return await cmdScroll(params);
    case 'screenshot':
      return await cmdScreenshot(params);
    case 'get_content':
      return await cmdGetContent(params);
    case 'get_text':
      return await cmdGetText(params);
    case 'get_tabs':
      return await cmdGetTabs();
    case 'evaluate':
      return await cmdEvaluate(params);
    case 'get_elements':
      return await cmdGetElements(params);
    case 'wait_for':
      return await cmdWaitFor(params);
    case 'new_tab':
      return await cmdNewTab(params);
    case 'close_tab':
      return await cmdCloseTab(params);
    case 'switch_tab':
      return await cmdSwitchTab(params);
    case 'hover':
      return await cmdHover(params);
    case 'click_at':
      return await cmdClickAt(params);
    case 'select':
      return await cmdSelect(params);
    case 'get_url':
      return await cmdGetUrl(params);
    case 'go_back':
      return await cmdGoBack(params);
    case 'go_forward':
      return await cmdGoForward(params);
    case 'reload':
      return await cmdReload(params);
    case 'iframe_click_at':
      return await cmdIframeClickAt(params);
    case 'iframe_get_elements':
      return await cmdIframeGetElements(params);
    case 'iframe_get_text':
      return await cmdIframeGetText(params);
    case 'iframe_click':
      return await cmdIframeClick(params);
    case 'snapshot':
      return await cmdSnapshot(params);
    case 'clear_marks':
      return await cmdClearMarks(params);
    case 'press_key':
      return await cmdPressKey(params);
    case 'drag_and_drop':
      return await cmdDragAndDrop(params);
    case 'upload_file':
      return await cmdUploadFile(params);
    default:
      return { success: false, error: `Unknown action: ${command.action}` };
  }
}
