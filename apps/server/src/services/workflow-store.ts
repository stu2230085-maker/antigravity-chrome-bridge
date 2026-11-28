import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  type SavedWorkflow,
  SavedWorkflowSchema,
  type WorkflowUpsertInput,
} from '@antigravity-bridge/protocol';

export class WorkflowStore {
  private readonly workflows = new Map<string, SavedWorkflow>();
  private readonly filePath?: string;

  constructor(filePath?: string) {
    const trimmed = filePath?.trim();
    this.filePath = trimmed && trimmed.length > 0 ? trimmed : undefined;
    this.loadFromDisk();
  }

  list(): SavedWorkflow[] {
    return Array.from(this.workflows.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): SavedWorkflow | undefined {
    return this.workflows.get(id);
  }

  save(input: WorkflowUpsertInput): { workflow: SavedWorkflow; created: boolean } {
    const now = Date.now();
    const id = input.id?.trim() || `wf-${crypto.randomUUID()}`;
    const existing = this.workflows.get(id);

    const workflow: SavedWorkflow = {
      id,
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      steps: input.steps,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    this.workflows.set(id, workflow);
    this.persistToDisk();
    return { workflow, created: !existing };
  }

  delete(id: string): boolean {
    const removed = this.workflows.delete(id);
    if (removed) {
      this.persistToDisk();
    }
    return removed;
  }

  clear(): void {
    this.workflows.clear();
    this.persistToDisk();
  }

  get size(): number {
    return this.workflows.size;
  }

  private loadFromDisk(): void {
    if (!this.filePath || !existsSync(this.filePath)) {
      return;
    }

    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsedJson: unknown = JSON.parse(raw);
      if (Array.isArray(parsedJson)) {
        for (const item of parsedJson) {
          const parsed = SavedWorkflowSchema.safeParse(item);
          if (parsed.success) {
            this.workflows.set(parsed.data.id, parsed.data);
          }
        }
      }
    } catch {
      // Ignore unreadable/corrupt workflow store file on startup
    }
  }

  private persistToDisk(): void {
    if (!this.filePath) {
      return;
    }

    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(this.list(), null, 2), 'utf8');
    renameSync(tmpPath, this.filePath);
  }
}
