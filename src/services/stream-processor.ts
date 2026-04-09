import type { StreamEvent } from '../types.js';

function shorten(input: string, maxLen = 180): string {
  if (input.length <= maxLen) return input;
  return `${input.slice(0, maxLen)}...`;
}

function redactSensitive(input: unknown, depth = 0): unknown {
  if (depth > 3) return '[truncated]';
  if (input == null) return input;
  if (typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean') return input;
  if (Array.isArray(input)) return input.slice(0, 10).map((item) => redactSensitive(item, depth + 1));
  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (/(token|password|secret|api[_-]?key|authorization|cookie)/iu.test(k)) out[k] = '[REDACTED]';
      else out[k] = redactSensitive(v, depth + 1);
    }
    return out;
  }
  return '[unsupported]';
}

function summarizeToolInput(input: unknown): string | undefined {
  if (input == null) return undefined;
  if (typeof input === 'string') return shorten(input.trim());
  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    const keyCandidates = ['command', 'query', 'path', 'pattern', 'prompt', 'url', 'name'];
    for (const key of keyCandidates) {
      const value = obj[key];
      if (typeof value === 'string' && value.trim()) return `${key}: ${shorten(value.trim())}`;
    }
    try {
      const json = JSON.stringify(redactSensitive(obj));
      if (!json || json === '{}' || json === '[]') return undefined;
      return shorten(json);
    } catch { return undefined; }
  }
  return undefined;
}

function extractSkillName(toolName: unknown, input: unknown): string | undefined {
  if (toolName !== 'Skill') return undefined;
  if (!input || typeof input !== 'object') return undefined;
  const obj = input as Record<string, unknown>;
  const raw =
    (typeof obj.skillName === 'string' && obj.skillName) ||
    (typeof obj.skill === 'string' && obj.skill) ||
    (typeof obj.name === 'string' && obj.name) ||
    (typeof obj.command === 'string' && obj.command) ||
    '';
  if (!raw) return undefined;
  const matched = raw.match(/\/([A-Za-z0-9._-]+)/);
  if (matched && matched[1]) return matched[1];
  return raw.replace(/^\/+/, '').trim() || undefined;
}

export class ClawStreamProcessor {
  private readonly emit: (event: StreamEvent) => void;
  private readonly turnId: string;

  private readonly BUF_MAIN = '__main__';
  private readonly streamBufs = new Map<string, { text: string; think: string }>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly FLUSH_MS = 100;
  private readonly FLUSH_CHARS = 200;
  private fullTextAccumulator = '';
  private activeTopLevelToolUseId: string | null = null;
  private activeSkillToolUseId: string | null = null;
  private readonly activeNestedToolByParent = new Map<string, { toolUseId: string; toolName: string }>();
  private readonly taskToolUseIds = new Set<string>();
  private readonly pendingGenericInput = new Map<number, { toolUseId: string; inputJson: string; resolved: boolean; parentToolUseId: string | null; isNested: boolean; toolName: string }>();
  private readonly pendingSkillInput = new Map<number, { toolUseId: string; inputJson: string; resolved: boolean; parentToolUseId: string | null; isNested: boolean }>();
  private readonly pendingTaskInput = new Map<number, { toolUseId: string; inputJson: string; resolved: boolean }>();
  private readonly pendingAskUserInput = new Map<number, { toolUseId: string; inputJson: string; resolved: boolean; parentToolUseId: string | null; isNested: boolean }>();
  private readonly pendingTodoInput = new Map<number, { toolUseId: string; inputJson: string; resolved: boolean; parentToolUseId: string | null; isNested: boolean }>();
  private readonly sdkTaskIdToToolUseId = new Map<string, string>();
  private readonly activeSubAgentToolsByTask = new Map<string, Set<string>>();
  private readonly backgroundTaskToolUseIds = new Set<string>();

  constructor(emit: (event: StreamEvent) => void, turnId: string) {
    this.emit = emit;
    this.turnId = turnId;
  }

  private getBuf(key: string): { text: string; think: string } {
    let b = this.streamBufs.get(key);
    if (!b) { b = { text: '', think: '' }; this.streamBufs.set(key, b); }
    return b;
  }

  flushBuffers(): void {
    for (const [key, buf] of this.streamBufs) {
      const pid = key === this.BUF_MAIN ? undefined : key;
      if (buf.text) {
        this.emit({ eventType: 'text_delta', text: buf.text, parentToolUseId: pid, turnId: this.turnId });
        buf.text = '';
      }
      if (buf.think) {
        this.emit({ eventType: 'thinking_delta', text: buf.think, parentToolUseId: pid, turnId: this.turnId });
        buf.think = '';
      }
    }
    this.flushTimer = null;
  }

  private scheduleFlush(): void {
    let maxLen = 0;
    for (const buf of this.streamBufs.values()) {
      maxLen = Math.max(maxLen, buf.text.length, buf.think.length);
    }
    if (maxLen >= this.FLUSH_CHARS) {
      if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
      this.flushBuffers();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushBuffers(), this.FLUSH_MS);
    }
  }

  private emitToolUseEnd(toolUseId: string, parentToolUseId?: string | null): void {
    this.emit({ eventType: 'tool_use_end', toolUseId, parentToolUseId: parentToolUseId || undefined, turnId: this.turnId });
  }

  processMessage(message: any): void {
    const type = message.type as string;

    if (type === 'stream_event') {
      this.processStreamEvent(message);
      return;
    }

    if (type === 'tool_progress') {
      const pid = message.parent_tool_use_id ?? null;
      this.emit({
        eventType: 'tool_progress',
        toolName: message.tool_name,
        toolUseId: message.tool_use_id,
        parentToolUseId: pid || undefined,
        isNested: pid !== null,
        elapsedSeconds: message.elapsed_time_seconds,
        turnId: this.turnId,
      });
      return;
    }

    if (type === 'tool_use_summary') {
      const ids = Array.isArray(message.preceding_tool_use_ids)
        ? message.preceding_tool_use_ids.filter((id: unknown): id is string => typeof id === 'string')
        : [];
      for (const id of ids) {
        if (this.taskToolUseIds.has(id) && !this.backgroundTaskToolUseIds.has(id)) {
          this.cleanupTaskTools(id);
          this.emit({ eventType: 'task_notification', taskId: id, taskStatus: 'completed', taskSummary: '', turnId: this.turnId });
        }
        this.taskToolUseIds.delete(id);
        this.backgroundTaskToolUseIds.delete(id);
        this.emitToolUseEnd(id);
        if (this.activeTopLevelToolUseId === id) this.activeTopLevelToolUseId = null;
      }
      return;
    }

    if (type === 'system') {
      if (this.processSystemMessage(message)) return;
    }

    if ((type === 'assistant' || type === 'user') && message.parent_tool_use_id && this.taskToolUseIds.has(message.parent_tool_use_id)) {
      if (this.processSubAgentMessage(message)) return;
    }

    if (type === 'user') {
      this.processUserMessage(message);
      return;
    }

    if (type === 'assistant') {
      this.processAssistantMessage(message);
    }
  }

  private processStreamEvent(message: any): void {
    const parentToolUseId = message.parent_tool_use_id === undefined ? null : message.parent_tool_use_id;
    const isNested = parentToolUseId !== null;
    const event = message.event;

    if (event?.type === 'content_block_start') {
      const block = event.content_block;
      if (block?.type === 'tool_use') {
        this.handleToolUseStart(block, parentToolUseId, isNested, event.index);
      } else if (block?.type === 'text') {
        this.handleTextBlockStart(parentToolUseId, isNested);
      }
    } else if (event?.type === 'content_block_delta') {
      this.handleContentBlockDelta(event, parentToolUseId);
    } else if (event?.type === 'content_block_stop') {
      const pid = parentToolUseId || undefined;
      if (pid) {
        const buf = this.streamBufs.get(pid);
        if (buf && (buf.text || buf.think)) {
          this.flushBuffers();
        }
      }
    }
  }

  private handleToolUseStart(block: any, parentToolUseId: string | null, isNested: boolean, blockIndex?: number): void {
    const isInsideSkill = !isNested && this.activeSkillToolUseId && block.name !== 'Skill';
    const effectiveIsNested = isNested || !!isInsideSkill;
    const effectiveParentToolUseId = isInsideSkill ? this.activeSkillToolUseId : parentToolUseId;

    if (!effectiveIsNested && this.activeTopLevelToolUseId && this.activeTopLevelToolUseId !== block.id) {
      if (!this.taskToolUseIds.has(this.activeTopLevelToolUseId)) {
        this.emitToolUseEnd(this.activeTopLevelToolUseId);
      }
      if (this.activeTopLevelToolUseId === this.activeSkillToolUseId) this.activeSkillToolUseId = null;
    }
    if (!effectiveIsNested) this.activeTopLevelToolUseId = block.id || null;

    if (effectiveIsNested && effectiveParentToolUseId) {
      const prev = this.activeNestedToolByParent.get(effectiveParentToolUseId);
      if (prev && prev.toolUseId !== block.id) {
        this.emitToolUseEnd(prev.toolUseId, effectiveParentToolUseId);
      }
      this.activeNestedToolByParent.set(effectiveParentToolUseId, { toolUseId: block.id || '', toolName: block.name });
    }

    let toolInputSummary: string | undefined;
    if (block.input) toolInputSummary = summarizeToolInput(block.input);

    this.emit({
      eventType: 'tool_use_start',
      toolName: block.name,
      toolUseId: block.id,
      parentToolUseId: effectiveParentToolUseId || undefined,
      isNested: effectiveIsNested,
      skillName: extractSkillName(block.name, block.input),
      toolInputSummary,
      turnId: this.turnId,
    });

    if (block.name === 'Skill' && block.id) {
      this.activeSkillToolUseId = block.id;
      if (typeof blockIndex === 'number') {
        this.pendingSkillInput.set(blockIndex, { toolUseId: block.id, inputJson: '', resolved: false, parentToolUseId, isNested });
      }
    }
    if (block.name === 'AskUserQuestion' && block.id && typeof blockIndex === 'number') {
      this.pendingAskUserInput.set(blockIndex, { toolUseId: block.id, inputJson: '', resolved: false, parentToolUseId, isNested });
    }
    if (block.name === 'TodoWrite' && block.id && typeof blockIndex === 'number') {
      this.pendingTodoInput.set(blockIndex, { toolUseId: block.id, inputJson: '', resolved: false, parentToolUseId, isNested });
    }
    if ((block.name === 'Task' || block.name === 'Agent') && block.id) {
      this.taskToolUseIds.add(block.id);
      this.emit({
        eventType: 'task_start',
        toolUseId: block.id,
        taskDescription: typeof block.input?.description === 'string' ? block.input.description : undefined,
        turnId: this.turnId,
      });
      if (typeof blockIndex === 'number') {
        this.pendingTaskInput.set(blockIndex, { toolUseId: block.id, inputJson: '', resolved: false });
      }
    }
    if (block.name && !['Skill', 'Task', 'Agent', 'AskUserQuestion', 'TodoWrite'].includes(block.name) && typeof blockIndex === 'number') {
      this.pendingGenericInput.set(blockIndex, {
        toolUseId: block.id || '',
        inputJson: '',
        resolved: false,
        parentToolUseId: effectiveParentToolUseId,
        isNested: effectiveIsNested,
        toolName: block.name,
      });
    }
  }

  private handleTextBlockStart(parentToolUseId: string | null, isNested: boolean): void {
    if (!isNested && this.activeTopLevelToolUseId) {
      if (!this.taskToolUseIds.has(this.activeTopLevelToolUseId)) {
        this.emitToolUseEnd(this.activeTopLevelToolUseId);
      }
      this.activeTopLevelToolUseId = null;
      this.activeSkillToolUseId = null;
    }
    if (isNested && parentToolUseId) {
      const prev = this.activeNestedToolByParent.get(parentToolUseId);
      if (prev) {
        this.emitToolUseEnd(prev.toolUseId, parentToolUseId);
        this.activeNestedToolByParent.delete(parentToolUseId);
      }
    }
  }

  private handleContentBlockDelta(event: any, parentToolUseId: string | null): void {
    const delta = event.delta;
    if (delta?.type === 'text_delta' && delta.text) {
      const key = parentToolUseId || this.BUF_MAIN;
      this.getBuf(key).text += delta.text;
      if (key === this.BUF_MAIN) this.fullTextAccumulator += delta.text;
      this.scheduleFlush();
    } else if (delta?.type === 'thinking_delta' && delta.thinking) {
      const key = parentToolUseId || this.BUF_MAIN;
      this.getBuf(key).think += delta.thinking;
      this.scheduleFlush();
    } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
      const blockIndex = event.index;
      if (typeof blockIndex === 'number') {
        this.handleInputJsonDelta(blockIndex, delta.partial_json);
      }
    }
  }

  private handleInputJsonDelta(blockIndex: number, partialJson: string): void {
    const MAX = 10240;

    const pendingSkill = this.pendingSkillInput.get(blockIndex);
    if (pendingSkill && !pendingSkill.resolved) {
      pendingSkill.inputJson += partialJson;
      const m = pendingSkill.inputJson.match(/"skill"\s*:\s*"([^"]+)"/);
      if (m) {
        pendingSkill.resolved = true;
        this.pendingSkillInput.delete(blockIndex);
        this.emit({ eventType: 'tool_progress', toolName: 'Skill', toolUseId: pendingSkill.toolUseId, parentToolUseId: pendingSkill.parentToolUseId || undefined, isNested: pendingSkill.isNested, skillName: m[1], turnId: this.turnId });
      }
      if (pendingSkill.inputJson.length >= MAX) this.pendingSkillInput.delete(blockIndex);
    }

    const pendingAsk = this.pendingAskUserInput.get(blockIndex);
    if (pendingAsk && !pendingAsk.resolved) {
      pendingAsk.inputJson += partialJson;
      if (pendingAsk.inputJson.includes('"question')) {
        try {
          const parsed = JSON.parse(pendingAsk.inputJson);
          if (parsed.question || parsed.questions) {
            pendingAsk.resolved = true;
            this.pendingAskUserInput.delete(blockIndex);
            this.emit({ eventType: 'tool_progress', toolName: 'AskUserQuestion', toolUseId: pendingAsk.toolUseId, parentToolUseId: pendingAsk.parentToolUseId || undefined, isNested: pendingAsk.isNested, toolInput: parsed, turnId: this.turnId });
          }
        } catch {}
      }
      if (pendingAsk.inputJson.length >= MAX) this.pendingAskUserInput.delete(blockIndex);
    }

    const pendingTodo = this.pendingTodoInput.get(blockIndex);
    if (pendingTodo && !pendingTodo.resolved) {
      pendingTodo.inputJson += partialJson;
      if (pendingTodo.inputJson.includes('"todos"')) {
        try {
          const parsed = JSON.parse(pendingTodo.inputJson);
          if (Array.isArray(parsed.todos)) {
            pendingTodo.resolved = true;
            this.pendingTodoInput.delete(blockIndex);
            this.emit({ eventType: 'todo_update', todos: parsed.todos, turnId: this.turnId });
          }
        } catch {}
      }
      if (pendingTodo.inputJson.length >= MAX) this.pendingTodoInput.delete(blockIndex);
    }

    const pendingTask = this.pendingTaskInput.get(blockIndex);
    if (pendingTask && !pendingTask.resolved) {
      pendingTask.inputJson += partialJson;
      const d = pendingTask.inputJson.match(/"description"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (d) {
        pendingTask.resolved = true;
        this.pendingTaskInput.delete(blockIndex);
        this.emit({ eventType: 'task_start', toolUseId: pendingTask.toolUseId, taskDescription: d[1].replace(/\\"/g, '"').slice(0, 200), turnId: this.turnId });
      }
      if (pendingTask.inputJson.length >= MAX) this.pendingTaskInput.delete(blockIndex);
    }

    const pendingGeneric = this.pendingGenericInput.get(blockIndex);
    if (pendingGeneric && !pendingGeneric.resolved) {
      pendingGeneric.inputJson += partialJson;
      if (pendingGeneric.inputJson.length >= MAX) {
        pendingGeneric.resolved = true;
        this.pendingGenericInput.delete(blockIndex);
        return;
      }
      const trimmed = pendingGeneric.inputJson.trimEnd();
      if (trimmed.endsWith('}')) {
        try {
          const parsed = JSON.parse(pendingGeneric.inputJson);
          const summary = summarizeToolInput(parsed);
          if (summary) {
            pendingGeneric.resolved = true;
            this.pendingGenericInput.delete(blockIndex);
            this.emit({
              eventType: 'tool_progress',
              toolName: pendingGeneric.toolName,
              toolUseId: pendingGeneric.toolUseId,
              parentToolUseId: pendingGeneric.parentToolUseId || undefined,
              isNested: pendingGeneric.isNested,
              toolInputSummary: summary,
              turnId: this.turnId,
            });
          }
        } catch {}
      }
    }
  }

  private cleanupTaskTools(taskId: string): void {
    const nested = this.activeNestedToolByParent.get(taskId);
    if (nested) {
      this.emitToolUseEnd(nested.toolUseId, taskId);
      this.activeNestedToolByParent.delete(taskId);
    }
    const subTools = this.activeSubAgentToolsByTask.get(taskId);
    if (subTools) {
      for (const toolId of subTools) this.emitToolUseEnd(toolId, taskId);
      this.activeSubAgentToolsByTask.delete(taskId);
    }
  }

  private processSystemMessage(message: any): boolean {
    const st = message.subtype;
    if (st === 'status') {
      this.emit({ eventType: 'status', statusText: message.status?.type || null, turnId: this.turnId });
      return true;
    }
    if (st === 'hook_started') {
      this.emit({ eventType: 'hook_started', hookName: message.hook_name, hookEvent: message.hook_event, turnId: this.turnId });
      return true;
    }
    if (st === 'hook_progress') {
      this.emit({ eventType: 'hook_progress', hookName: message.hook_name, hookEvent: message.hook_event, turnId: this.turnId });
      return true;
    }
    if (st === 'hook_response') {
      this.emit({ eventType: 'hook_response', hookName: message.hook_name, hookEvent: message.hook_event, turnId: this.turnId });
      return true;
    }
    if (st === 'api_retry') {
      this.emit({ eventType: 'status', statusText: `API 重试中 (${message.attempt ?? '?'}/${message.max_retries ?? '?'})`, turnId: this.turnId });
      return true;
    }
    if (st === 'task_started' || st === 'task_progress') {
      if (message.task_id && message.tool_use_id) this.sdkTaskIdToToolUseId.set(message.task_id, message.tool_use_id);
      const desc = message.description || message.summary || '';
      const text = st === 'task_started' ? `Task 启动: ${desc.slice(0, 80)}` : `Task 进度: ${desc.slice(0, 80)}`;
      this.emit({ eventType: 'status', statusText: text, turnId: this.turnId });
      return true;
    }
    if (st === 'task_notification') {
      const tid = message.tool_use_id || this.sdkTaskIdToToolUseId.get(message.task_id) || message.task_id;
      this.emit({ eventType: 'task_notification', taskId: tid, taskStatus: message.status, taskSummary: message.summary, turnId: this.turnId });
      this.cleanupTaskTools(tid);
      this.backgroundTaskToolUseIds.delete(tid);
      if (this.taskToolUseIds.has(tid)) {
        this.taskToolUseIds.delete(tid);
        this.emitToolUseEnd(tid);
        if (this.activeTopLevelToolUseId === tid) this.activeTopLevelToolUseId = null;
      }
      this.sdkTaskIdToToolUseId.delete(message.task_id);
      return true;
    }
    if (st === 'tool_use_summary') {
      const ids = Array.isArray(message.preceding_tool_use_ids) ? message.preceding_tool_use_ids : [];
      for (const id of ids) {
        if (this.taskToolUseIds.has(id) && !this.backgroundTaskToolUseIds.has(id)) {
          this.cleanupTaskTools(id);
          this.emit({ eventType: 'task_notification', taskId: id, taskStatus: 'completed', taskSummary: '', turnId: this.turnId });
        }
        this.taskToolUseIds.delete(id);
        this.backgroundTaskToolUseIds.delete(id);
        this.emitToolUseEnd(id);
        if (this.activeTopLevelToolUseId === id) this.activeTopLevelToolUseId = null;
      }
      return true;
    }
    return false;
  }

  private processSubAgentMessage(message: any): boolean {
    const p = message.parent_tool_use_id;
    if (!p || !this.taskToolUseIds.has(p)) return false;
    const content = message.message?.content;
    if (message.type === 'assistant' && Array.isArray(content)) {
      const prev = this.activeSubAgentToolsByTask.get(p);
      if (prev && prev.size > 0) {
        for (const toolId of prev) this.emitToolUseEnd(toolId, p);
        prev.clear();
      }
      for (const block of content) {
        if (block.type === 'thinking' && block.thinking) {
          this.emit({ eventType: 'thinking_delta', text: block.thinking, parentToolUseId: p, turnId: this.turnId });
        }
        if (block.type === 'text' && block.text) {
          this.emit({ eventType: 'text_delta', text: block.text, parentToolUseId: p, turnId: this.turnId });
        }
        if (block.type === 'tool_use' && block.id) {
          this.emit({
            eventType: 'tool_use_start',
            toolName: block.name || 'unknown',
            toolUseId: block.id,
            parentToolUseId: p,
            isNested: true,
            toolInputSummary: summarizeToolInput(block.input),
            turnId: this.turnId,
          });
          if (!this.activeSubAgentToolsByTask.has(p)) this.activeSubAgentToolsByTask.set(p, new Set());
          this.activeSubAgentToolsByTask.get(p)!.add(block.id);
        }
      }
    }
    if (message.type === 'user') {
      const raw = message.message?.content;
      if (typeof raw === 'string' && raw) {
        this.emit({ eventType: 'text_delta', text: raw, parentToolUseId: p, turnId: this.turnId });
      } else if (Array.isArray(raw)) {
        const activeSub = this.activeSubAgentToolsByTask.get(p);
        for (const block of raw) {
          if (block.type === 'text' && block.text) {
            this.emit({ eventType: 'text_delta', text: block.text, parentToolUseId: p, turnId: this.turnId });
          }
          if (block.type === 'thinking' && block.thinking) {
            this.emit({ eventType: 'thinking_delta', text: block.thinking, parentToolUseId: p, turnId: this.turnId });
          }
          if (block.type === 'tool_result' && block.tool_use_id) {
            this.emitToolUseEnd(block.tool_use_id, p);
            activeSub?.delete(block.tool_use_id);
          }
        }
      }
    }
    return true;
  }

  private isPendingResolved(pendingMap: Map<number, { toolUseId: string; resolved: boolean }>, toolUseId: string): boolean {
    for (const v of pendingMap.values()) if (v.toolUseId === toolUseId && v.resolved) return true;
    return false;
  }

  private processUserMessage(message: any): void {
    const raw = message.message?.content;
    if (!Array.isArray(raw)) return;
    for (const block of raw) {
      if (block.type === 'tool_result' && block.tool_use_id) {
        if (this.taskToolUseIds.has(block.tool_use_id) && !this.backgroundTaskToolUseIds.has(block.tool_use_id)) {
          this.cleanupTaskTools(block.tool_use_id);
          this.emit({ eventType: 'task_notification', taskId: block.tool_use_id, taskStatus: 'completed', taskSummary: '', turnId: this.turnId });
        }
        this.emitToolUseEnd(block.tool_use_id);
        if (this.activeTopLevelToolUseId === block.tool_use_id) {
          this.activeTopLevelToolUseId = null;
          this.activeSkillToolUseId = null;
        }
        this.taskToolUseIds.delete(block.tool_use_id);
        this.backgroundTaskToolUseIds.delete(block.tool_use_id);
        this.activeNestedToolByParent.delete(block.tool_use_id);
        const subTools = this.activeSubAgentToolsByTask.get(block.tool_use_id);
        if (subTools) {
          for (const toolId of subTools) this.emitToolUseEnd(toolId, block.tool_use_id);
          this.activeSubAgentToolsByTask.delete(block.tool_use_id);
        }
      }
    }
  }

  private processAssistantMessage(message: any): void {
    const content = message.message?.content;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (block.type === 'text' && block.text) {
        if (this.activeTopLevelToolUseId && !this.taskToolUseIds.has(this.activeTopLevelToolUseId)) {
          this.emitToolUseEnd(this.activeTopLevelToolUseId);
          this.activeTopLevelToolUseId = null;
          this.activeSkillToolUseId = null;
        }
        this.emit({ eventType: 'text_delta', text: block.text, turnId: this.turnId });
        // Avoid double-counting text already received via stream_event deltas
        if (!this.fullTextAccumulator.endsWith(block.text)) {
          this.fullTextAccumulator += block.text;
        }
      } else if (block.type === 'tool_use' && block.id) {
        this.handleToolUseStart(block, null, false);
      }
    }
    for (const block of content) {
      if (block.type === 'tool_use' && block.id && block.input) {
        if (block.name === 'Skill' && !this.isPendingResolved(this.pendingSkillInput, block.id)) {
          const skillName = extractSkillName(block.name, block.input);
          if (skillName) this.emit({ eventType: 'tool_progress', toolName: 'Skill', toolUseId: block.id, skillName, turnId: this.turnId });
        }
        if ((block.name === 'Task' || block.name === 'Agent') && block.input?.run_in_background === true && !this.backgroundTaskToolUseIds.has(block.id)) {
          this.backgroundTaskToolUseIds.add(block.id);
        }
        if (block.name === 'AskUserQuestion' && !this.isPendingResolved(this.pendingAskUserInput, block.id)) {
          this.emit({ eventType: 'tool_progress', toolName: 'AskUserQuestion', toolUseId: block.id, toolInput: block.input as Record<string, unknown>, turnId: this.turnId });
        }
        if (block.name === 'TodoWrite' && !this.isPendingResolved(this.pendingTodoInput, block.id)) {
          if (Array.isArray(block.input?.todos)) this.emit({ eventType: 'todo_update', todos: block.input.todos, turnId: this.turnId });
        }
      }
    }
    this.pendingSkillInput.clear();
    this.pendingTaskInput.clear();
    this.pendingAskUserInput.clear();
    this.pendingTodoInput.clear();
    this.pendingGenericInput.clear();
    this.sdkTaskIdToToolUseId.clear();
  }

  cleanup(): void {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    this.flushBuffers();
    if (this.activeTopLevelToolUseId) {
      if (!this.taskToolUseIds.has(this.activeTopLevelToolUseId)) this.emitToolUseEnd(this.activeTopLevelToolUseId);
      this.activeTopLevelToolUseId = null;
      this.activeSkillToolUseId = null;
    }
    for (const id of this.taskToolUseIds) {
      if (!this.backgroundTaskToolUseIds.has(id)) {
        this.cleanupTaskTools(id);
        this.emit({ eventType: 'task_notification', taskId: id, taskStatus: 'completed', taskSummary: '', turnId: this.turnId });
      }
      this.emitToolUseEnd(id);
    }
    this.taskToolUseIds.clear();
    for (const [parentId, nested] of this.activeNestedToolByParent) this.emitToolUseEnd(nested.toolUseId, parentId);
    this.activeNestedToolByParent.clear();
    for (const [taskId, subTools] of this.activeSubAgentToolsByTask) {
      for (const toolId of subTools) this.emitToolUseEnd(toolId, taskId);
    }
    this.activeSubAgentToolsByTask.clear();
  }

  getFullText(): string {
    return this.fullTextAccumulator;
  }
}
