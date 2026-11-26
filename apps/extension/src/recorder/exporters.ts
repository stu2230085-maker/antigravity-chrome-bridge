import type { RecordedStep } from './types.js';

interface BatchExportStep {
  action: string;
  params: Record<string, unknown>;
}

interface BatchWorkflowExport {
  name: string;
  steps: BatchExportStep[];
}

function toBatchStep(step: RecordedStep): BatchExportStep {
  switch (step.action) {
    case 'navigate':
      return {
        action: 'navigate',
        params: { url: step.url ?? '' },
      };
    case 'click':
      return {
        action: 'click',
        params: { selector: step.selector ?? '' },
      };
    case 'type':
      return {
        action: 'type',
        params: {
          selector: step.selector ?? '',
          text: step.text ?? '',
        },
      };
    case 'select':
      return {
        action: 'select',
        params: {
          selector: step.selector ?? '',
          value: step.value ?? '',
        },
      };
    case 'press_key':
      return {
        action: 'press_key',
        params: {
          key: step.key ?? '',
          ...(step.selector ? { selector: step.selector } : {}),
        },
      };
  }
}

export function exportToBatchJson(steps: RecordedStep[], name = 'Recorded Workflow'): string {
  const workflow: BatchWorkflowExport = {
    name,
    steps: steps.map(toBatchStep),
  };
  return JSON.stringify(workflow, null, 2);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function exportToCliScript(steps: RecordedStep[]): string {
  const lines: string[] = ['#!/usr/bin/env bash', 'set -euo pipefail', ''];

  for (const step of steps) {
    switch (step.action) {
      case 'navigate':
        lines.push(`agb nav ${shellQuote(step.url ?? '')}`);
        break;
      case 'click':
        lines.push(`agb click ${shellQuote(step.selector ?? '')}`);
        break;
      case 'type':
        lines.push(`agb type ${shellQuote(step.selector ?? '')} ${shellQuote(step.text ?? '')}`);
        break;
      case 'select': {
        const selectorJson = JSON.stringify(step.selector ?? '');
        const valueJson = JSON.stringify(step.value ?? '');
        const code = `(() => { const el = document.querySelector(${selectorJson}); if (!el) throw new Error('Element not found'); el.value = ${valueJson}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`;
        lines.push(`agb eval ${shellQuote(code)}`);
        break;
      }
      case 'press_key': {
        const targetFlag = step.selector ? ` --target ${shellQuote(step.selector)}` : '';
        lines.push(`agb key ${shellQuote(step.key ?? '')}${targetFlag}`);
        break;
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

export function exportToSdkCode(steps: RecordedStep[]): string {
  const lines: string[] = [
    "import { AntigravityBridgeClient } from '@antigravity-bridge/sdk';",
    '',
    'const bridge = new AntigravityBridgeClient();',
    '',
    'async function run(): Promise<void> {',
  ];

  for (const step of steps) {
    switch (step.action) {
      case 'navigate':
        lines.push(`  await bridge.navigate(${JSON.stringify(step.url ?? '')});`);
        break;
      case 'click':
        lines.push(`  await bridge.click(${JSON.stringify(step.selector ?? '')});`);
        break;
      case 'type':
        lines.push(
          `  await bridge.type(${JSON.stringify(step.selector ?? '')}, ${JSON.stringify(step.text ?? '')});`,
        );
        break;
      case 'select':
        lines.push(
          `  await bridge.select(${JSON.stringify(step.selector ?? '')}, ${JSON.stringify(step.value ?? '')});`,
        );
        break;
      case 'press_key':
        if (step.selector) {
          lines.push(
            `  await bridge.pressKey(${JSON.stringify(step.key ?? '')}, { selector: ${JSON.stringify(step.selector)} });`,
          );
        } else {
          lines.push(`  await bridge.pressKey(${JSON.stringify(step.key ?? '')});`);
        }
        break;
    }
  }

  lines.push('}', '', 'void run();', '');
  return lines.join('\n');
}
