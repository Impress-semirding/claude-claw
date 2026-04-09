/**
 * ClaudeAgent — 统一 Agent 运行时封装
 *
 * 职责边界：
 * - 构建并注入 system prompt（含公共层 + Agent 专属层）
 * - 管理 per-agent session 生命周期
 * - 执行 querySession 并消费 stream
 * - 处理 overflow / unrecoverable error 等异常恢复
 * - 通过回调将中间事件暴露给外部（便于外部做 broadcast/persist）
 *
 * 外部（messages.ts 等调度器）只负责：
 * - 准备 AgentEnvironment
 * - 调用 agent.query()
 * - 将返回结果持久化到 DB / WebSocket broadcast
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { getMemoryFiles, getClaudeMds } from './memory.js';
import { querySession } from './claude-session.service.js';
import { appConfig } from '../config.js';
import type { IStreamEvent, StreamEvent, IGroupConfig } from '../types.js';

export interface AgentEnvironment {
  userId: string;
  email: string;
  chatJid: string;
  workspaceDir: string;
  userGlobalPath?: string;
  groupConfig: IGroupConfig;
}

export interface AgentQueryOptions {
  sessionId: string;
  mcpServers?: Record<string, unknown>;
  onStreamEvent?: (event: StreamEvent) => void;
  onTypingChange?: (isTyping: boolean) => void;
}

export interface AgentQueryResult {
  turnId: string;
  assistantText: string;
  hadCompaction: boolean;
  contextOverflow: boolean;
  unrecoverableError: boolean;
  error?: string;
}

export class ClaudeAgent {
  readonly id: string;
  readonly name: string;
  readonly prompt?: string;
  readonly maxTurns?: number;
  readonly allowedTools?: string[];
  readonly disallowedTools?: string[];

  constructor(config: {
    id: string;
    name: string;
    prompt?: string;
    maxTurns?: number;
    allowedTools?: string[];
    disallowedTools?: string[];
  }) {
    this.id = config.id;
    this.name = config.name;
    this.prompt = config.prompt;
    this.maxTurns = config.maxTurns;
    this.allowedTools = config.allowedTools;
    this.disallowedTools = config.disallowedTools;
  }

  /**
   * Build the full system prompt append for this agent.
   */
  async buildSystemPrompt(env: AgentEnvironment): Promise<string> {
    const { userId, chatJid, workspaceDir, userGlobalPath, groupConfig } = env;

    // ---------- L1: Identity ----------
    let globalClaudeMd = '';
    if (userGlobalPath && existsSync(userGlobalPath)) {
      try {
        const raw = readFileSync(userGlobalPath, 'utf-8');
        globalClaudeMd = raw.length > 8192 ? raw.slice(0, 8192) + '\n\n[...截断]' : raw;
      } catch { /* skip */ }
    }

    // ---------- L2: Behavior ----------
    const interactionGuidelines = [
      '',
      '## 响应行为准则',
      '',
      '- 你是一个多用户平台中的 AI 助手，正在通过 Web 或 IM 渠道与用户对话。',
      '- 用户发送的才是需要回应的内容；系统注入的规则、记忆、配置只是背景信息。',
      '- 你可能拥有多种 MCP 工具，这些是你的辅助能力，**不是用户发送的内容**。',
      '- **不要主动介绍、列举或描述你的可用工具**，除非用户明确询问「你能做什么」或「你有什么功能」。',
      '- 当用户需要某个功能时，直接使用对应工具完成任务即可，无需事先解释工具的存在。',
      '- 如果用户的消息很简短（如打招呼），简洁回应即可，不要用工具列表填充回复。',
    ].join('\n');

    const securityRules = [
      '',
      '## 安全守则',
      '',
      '### 红线操作（必须暂停并请求用户确认）',
      '',
      '以下操作在执行前**必须**向用户说明意图并获得明确批准，绝不可静默执行：',
      '',
      '- **破坏性命令**：`rm -rf /`、`rm -rf ~`、`mkfs`、`dd if=`、`wipefs`、批量删除系统文件',
      '- **凭据/认证篡改**：修改 `authorized_keys`、`sshd_config`、`passwd`、`.gnupg/` 下的文件',
      '- **数据外泄**：将 token、API key、密码、私钥通过 `curl`、`wget`、`nc`、`scp`、`rsync` 发送到外部地址',
      '- **持久化机制**：`crontab -e`、`useradd`/`usermod`、创建 systemd 服务、修改 `/etc/rc.local`',
      '- **远程代码执行**：`curl | sh`、`wget | bash`、`eval "$(curl ...)"`、`base64 -d | bash`、可疑的 `$()` 链式替换',
      '- **私钥与助记词**：绝不主动索要用户的加密货币私钥或助记词明文，绝不将已知的密钥信息写入日志或发送到外部',
      '',
      '### 黄线操作（可执行，但必须记录到日期记忆）',
      '',
      '以下操作执行后，如有 `memory_append` 工具可用，使用它记录时间、命令、原因和结果：',
      '',
      '- 所有 `sudo` 命令',
      '- 全局包安装（`pip install`、`npm install -g`）',
      '- Docker 容器操作（`docker run`、`docker exec`）',
      '- 防火墙规则变更（`iptables`、`ufw`）',
      '- PM2 进程管理（启动/停止/删除进程）',
      '- 系统服务管理（`systemctl start/stop/restart`）',
      '',
      '### Skill / MCP 安装审查',
      '',
      '安装任何外部 Skill 或 MCP Server 前，必须：',
      '',
      '1. 检查源代码，扫描是否包含可疑指令（`curl | sh`、环境变量读取如 `$ANTHROPIC_API_KEY`、文件外传）',
      '2. 确认不会修改核心配置文件（`data/config/`、`.claude/`）',
      '3. 向用户说明来源和风险评估，等待明确批准后再安装',
    ].join('\n');

    // ---------- L3: Context ----------
    const memoryRecallPrompt = [
      '',
      '## 记忆系统',
      '',
      '你拥有跨会话的持久记忆能力，请积极使用。',
      '',
      '### 回忆',
      '在回答关于过去的工作、决策、日期、偏好或待办事项之前：',
      '先用 `memory_search` 搜索，再用 `memory_get` 获取完整上下文。',
      '',
      '### 存储——两层记忆架构',
      '',
      '获知重要信息后**必须立即保存**，不要等到上下文压缩。',
      '根据信息的**时效性**选择存储位置：',
      '',
      '#### 全局记忆（永久）→ 直接编辑 `/workspace/global/CLAUDE.md`',
      '',
      '**优先使用全局记忆。** 适用于所有**跨会话仍然有用**的信息：',
      '- 用户身份：姓名、生日、联系方式、地址、工作单位',
      '- 长期偏好：沟通风格、称呼方式、喜好厌恶、技术栈偏好',
      '- 身份配置：你的名字、角色设定、行为准则',
      '- 常用项目与上下文：反复提到的仓库、服务、架构信息',
      '- 用户明确要求「记住」的任何内容',
      '',
      '使用 `Read` 工具读取当前内容，再用 `Edit` 工具**原地更新对应字段**。',
      '文件中标记「待记录」的字段发现信息后**必须立即填写**。',
      '不要追加重复信息，保持文件简洁有序。',
      '',
      '#### 日期记忆（时效性）→ 调用 `memory_append`',
      '',
      '适用于**过一段时间会过时**的信息：',
      '- 项目进展：今天做了什么、决定了什么、遇到了什么问题',
      '- 临时技术决策：选型理由、架构方案、变更记录',
      '- 待办与承诺：约定事项、截止日期、后续跟进',
      '- 会议/讨论要点：关键结论、行动项',
      '',
      '`memory_append` 自动保存到独立的记忆目录（不在工作区内）。',
      '',
      '#### 判断标准',
      '> **默认优先全局记忆。** 问自己：这条信息下次对话还可能用到吗？',
      '> - 是 / 可能 → **全局记忆**（编辑 `/workspace/global/CLAUDE.md`）',
      '> - 明确只跟今天有关 → 日期记忆（`memory_append`）',
      '> - 用户说「记住这个」→ **一定写全局记忆**',
      '',
      '系统也会在上下文压缩前提示你保存记忆。',
    ].join('\n');

    // HEARTBEAT
    let heartbeatContent = '';
    const heartbeatPath = resolve(appConfig.dataDir, 'groups', 'user-global', userId, 'HEARTBEAT.md');
    if (existsSync(heartbeatPath)) {
      try {
        const raw = readFileSync(heartbeatPath, 'utf-8');
        const truncated = raw.length > 2048 ? raw.slice(0, 2048) + '\n\n[...截断]' : raw;
        heartbeatContent = [
          '',
          '## 近期工作参考（仅供背景了解）',
          '',
          '> 以下是系统自动生成的近期工作摘要，仅供参考。',
          '> **不要主动继续这些工作**，除非用户明确要求「继续」或主动提到相关话题。',
          '> 请专注于用户当前的消息。',
          '',
          truncated,
        ].join('\n');
      } catch { /* skip */ }
    }

    // ---------- L4: Reference ----------
    const outputGuidelines = [
      '',
      '## 输出格式',
      '',
      '### 图片引用',
      '当你生成了图片文件并需要在回复中展示时，使用 Markdown 图片语法引用**相对路径**（相对于当前工作目录）：',
      '`![描述](filename.png)`',
      '',
      '**禁止使用绝对路径**（如 `/workspace/group/filename.png`）。Web 界面会自动将相对路径解析为正确的文件下载地址。',
      '',
      '### 技术图表',
      '需要输出技术图表（流程图、时序图、架构图、ER 图、类图、状态图、甘特图等）时，**使用 Mermaid 语法**，用 ```mermaid 代码块包裹。',
      'Web 界面会自动将 Mermaid 代码渲染为可视化图表。',
    ].join('\n');

    const webFetchGuidelines = [
      '',
      '## 网页访问策略',
      '',
      '访问外部网页时优先使用 WebFetch（速度快）。',
      '如果 WebFetch 失败（403、被拦截、内容为空或需要 JavaScript 渲染），',
      '且 agent-browser 可用，立即改用 agent-browser 通过真实浏览器访问。不要反复重试 WebFetch。',
    ].join('\n');

    const backgroundTaskGuidelines = [
      '',
      '## 后台任务',
      '',
      '当用户要求执行耗时较长的批量任务（如批量文件处理、大规模数据操作等），',
      '你应该使用 Task 工具并设置 `run_in_background: true`，让任务在后台运行。',
      '这样用户无需等待，可以继续与你交流其他事项。',
      '任务结束时你会自动收到通知，届时在对话中向用户汇报即可。',
      '告知用户：「已为您在后台启动该任务，完成后我会第一时间反馈。现在有其他问题也可以随时问我。」',
      '',
      '### 任务通知处理（重要）',
      '',
      '当你收到多条后台任务的完成或失败通知时：',
      '- **禁止逐条回复**。不要对每条通知都调用 `send_message`，这会导致 IM 群刷屏。',
      '- **等待所有通知到齐后，汇总为一条消息回复用户**，例如：「N 个任务完成，M 个失败，失败原因：...」',
      '- 对于已知的无害失败（如浏览器进程被回收、临时资源超时），**不需要通知用户**，静默忽略即可。',
    ].join('\n');

    // 频道格式指引
    const channelPrefix = chatJid.split(':')[0];
    let channelGuidelines = '';
    if (channelPrefix === 'feishu') {
      channelGuidelines = [
        '## 飞书消息格式',
        '',
        '当前消息来自飞书。飞书卡片支持的 Markdown：**加粗**、_斜体_、`行内代码`、代码块、标题、列表、链接。',
        '用户同时可以在 Web 端查看你的回复，Web 端支持完整 Markdown + Mermaid 图表渲染，因此**不要因为来源是飞书就限制输出格式**。',
      ].join('\n');
    } else if (channelPrefix === 'telegram') {
      channelGuidelines = [
        '## Telegram 消息格式',
        '',
        '当前消息来自 Telegram。Markdown 自动转换为 Telegram HTML，长消息自动分片（3800 字符）。',
        '用户同时可以在 Web 端查看你的回复，Web 端支持完整 Markdown + Mermaid 图表渲染，因此**不要因为来源是 Telegram 就限制输出格式**。',
      ].join('\n');
    } else if (channelPrefix === 'qq') {
      channelGuidelines = [
        '## QQ 消息格式',
        '',
        '当前消息来自 QQ。Markdown 自动转换为纯文本，长消息自动分片（5000 字符）。',
        '用户同时可以在 Web 端查看你的回复，Web 端支持完整 Markdown + Mermaid 图表渲染，因此**不要因为来源是 QQ 就限制输出格式**。',
      ].join('\n');
    }

    // ---------- L5: Group/Agent ----------
    const memoryFiles = await getMemoryFiles(workspaceDir, { userGlobalPath });
    const filteredFiles = memoryFiles.filter((f) => {
      if (f.type === 'User') return true;
      const normalizedPath = f.path.replace(/\\/g, '/');
      if (normalizedPath.includes('/.claude/rules/')) return true;
      if (normalizedPath.includes('/.claude/CLAUDE.md')) return true;
      const workspaceNorm = workspaceDir.replace(/\\/g, '/');
      const relPath = normalizedPath.startsWith(workspaceNorm)
        ? normalizedPath.slice(workspaceNorm.length)
        : normalizedPath;
      if (relPath === '/CLAUDE.md' || relPath === '/CLAUDE.local.md') return false;
      return true;
    });
    const memoryPrompt = getClaudeMds(filteredFiles);

    const groupSystemPrompt = groupConfig.systemPrompt || '';

    // Agent 专属 prompt
    let agentPrompt = '';
    if (this.prompt) {
      agentPrompt = this.prompt.trim();
    }

    // Sub-Agent 行为覆盖
    let conversationAgentGuidelines = '';
    if (this.id !== 'main') {
      conversationAgentGuidelines = [
        '',
        '## 子会话行为规则（最高优先级，覆盖其他冲突指令）',
        '',
        '你正在一个**子会话**中运行，不是主会话。以下规则覆盖全局记忆中的"响应行为准则"：',
        '',
        '1. **不要用 `send_message` 发送"收到"之类的确认消息** — 你的正常文本输出就是回复，不需要额外发消息',
        '2. **每次回复只产生一条消息** — 把分析、结论、建议整合到一条回复中，不要拆成多条',
        '3. **只在以下情况使用 `send_message`**：',
        '   - 执行超过 2 分钟的长任务时，发送一次进度更新（不是确认收到）',
        '   - 用户明确要求你"先回复一下"时',
        '4. **你的正常文本输出会自动发送给用户**，不需要通过 `send_message` 转发',
        '5. **回复语言使用简体中文**，除非用户用其他语言提问',
      ].join('\n');
    }

    // ---------- 组装 6 层 XML systemPrompt ----------
    const systemPromptAppend = [
      globalClaudeMd && `<user-profile>\n${globalClaudeMd}\n</user-profile>`,
      `<behavior>\n${interactionGuidelines}\n</behavior>`,
      `<security>\n${securityRules}\n</security>`,
      `<memory-system>\n${memoryRecallPrompt}\n</memory-system>`,
      heartbeatContent && `<recent-work>\n${heartbeatContent}\n</recent-work>`,
      `<output-format>\n${outputGuidelines}\n</output-format>`,
      `<web-access>\n${webFetchGuidelines}\n</web-access>`,
      `<background-tasks>\n${backgroundTaskGuidelines}\n</background-tasks>`,
      channelGuidelines && `<channel-format>\n${channelGuidelines}\n</channel-format>`,
      memoryPrompt && `<workspace-memory>\n${memoryPrompt}\n</workspace-memory>`,
      groupSystemPrompt && `<group-config>\n${groupSystemPrompt}\n</group-config>`,
      agentPrompt && `<agent-prompt>\n${agentPrompt}\n</agent-prompt>`,
      conversationAgentGuidelines && `<agent-override>\n${conversationAgentGuidelines}\n</agent-override>`,
    ].filter(Boolean).join('\n\n');

    return systemPromptAppend;
  }

  /**
   * Execute a query for this agent.
   *
   * Encapsulates stream consumption, error recovery, and returns the final
   * aggregated result so the caller can decide how to persist / broadcast it.
   */
  async query(
    env: AgentEnvironment,
    content: string,
    options: AgentQueryOptions,
  ): Promise<AgentQueryResult> {
    const { userId, chatJid, groupConfig } = env;
    const { sessionId, mcpServers = {}, onStreamEvent, onTypingChange } = options;

    const turnId = `turn-${Date.now()}`;
    const systemPrompt = await this.buildSystemPrompt(env);

    // Compute effective tool constraints
    // Agent-level constraints narrow (intersect with) group-level constraints.
    const effectiveAllowedTools = this.intersectAllowedTools(
      groupConfig?.allowedTools,
      this.allowedTools,
    );
    const effectiveDisallowedTools = mergeDisallowed(
      groupConfig?.disallowedTools,
      this.disallowedTools,
    );

    console.log('[agent] query', {
      agentId: this.id,
      agentName: this.name,
      chatJid,
      sessionId,
      promptLength: content.length,
      systemPromptLength: systemPrompt.length,
      maxTurns: this.maxTurns,
      effectiveAllowedTools,
      effectiveDisallowedTools,
    });

    let assistantText = '';
    let hadCompaction = false;
    let contextOverflow = false;
    let unrecoverableError = false;
    let streamError: string | undefined;

    const stream = querySession({
      userId,
      workspace: chatJid,
      sessionId,
      prompt: content,
      mcpServers,
      systemPrompt,
      onStreamEvent: (ev) => {
        onStreamEvent?.(ev);
        if (ev.eventType === 'text_delta' || ev.eventType === 'thinking_delta') {
          onTypingChange?.(false);
        }
        if (ev.eventType === 'text_delta' && ev.text) {
          assistantText += ev.text;
        }
      },
      turnId,
      agentOptions: {
        maxTurns: this.maxTurns,
        allowedTools: effectiveAllowedTools,
        disallowedTools: effectiveDisallowedTools,
      },
    });

    try {
      for await (const event of stream) {
        const ev = event as IStreamEvent & { hadCompaction?: boolean };

        if (ev.type === 'system' && ev.subtype === 'init') {
          continue;
        }

        if (ev.type === 'assistant' && ev.content) {
          assistantText = ev.content;
        } else if (ev.type === 'error') {
          const errorMsg = ev.error || 'Unknown error';

          if (isContextOverflowError(errorMsg)) {
            contextOverflow = true;
          }
          if (isUnrecoverableTranscriptError(errorMsg)) {
            unrecoverableError = true;
          }

          onStreamEvent?.({
            eventType: 'error',
            error: errorMsg,
            turnId,
          });
        } else if (ev.type === 'complete') {
          hadCompaction = ev.hadCompaction || false;
          onStreamEvent?.({
            eventType: 'complete',
            turnId,
          });
        }
      }
    } catch (err) {
      streamError = err instanceof Error ? err.message : String(err);
      console.error('[agent] query stream error', streamError);
    }

    return {
      turnId,
      assistantText: assistantText.trim(),
      hadCompaction,
      contextOverflow,
      unrecoverableError,
      error: streamError,
    };
  }

  /**
   * Narrow group allowedTools by agent allowedTools (intersection).
   * If agent has no restriction, inherit group.
   * If group has no restriction, inherit agent.
   * If both have restrictions, use intersection.
   */
  private intersectAllowedTools(
    groupTools?: string[],
    agentTools?: string[],
  ): string[] | undefined {
    if (!groupTools || groupTools.length === 0) return agentTools;
    if (!agentTools || agentTools.length === 0) return groupTools;
    const intersection = groupTools.filter((t) => agentTools.includes(t));
    return intersection.length > 0 ? intersection : agentTools; // fallback to agent if mismatch
  }
}

function mergeDisallowed(
  groupTools?: string[],
  agentTools?: string[],
): string[] | undefined {
  const set = new Set<string>();
  if (groupTools) groupTools.forEach((t) => set.add(t));
  if (agentTools) agentTools.forEach((t) => set.add(t));
  return set.size > 0 ? Array.from(set) : undefined;
}

function isContextOverflowError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('context_length_exceeded') ||
    lower.includes('context length exceeded') ||
    lower.includes('max_context_length') ||
    lower.includes('too many tokens') ||
    lower.includes('token limit exceeded') ||
    lower.includes('context overflow')
  );
}

function isImageMimeMismatchError(msg: string): boolean {
  return (
    /image\s+was\s+specified\s+using\s+the\s+image\/[a-z0-9.+-]+\s+media\s+type,\s+but\s+the\s+image\s+appears\s+to\s+be\s+(?:an?\s+)?image\/[a-z0-9.+-]+\s+image/i.test(msg) ||
    /image\/[a-z0-9.+-]+\s+media\s+type.*appears\s+to\s+be.*image\/[a-z0-9.+-]+/i.test(msg)
  );
}

function isUnrecoverableTranscriptError(msg: string): boolean {
  const isImageSizeError =
    /image.*dimensions?\s+exceed/i.test(msg) ||
    /max\s+allowed\s+size.*pixels/i.test(msg) ||
    /image.*too\s+large/i.test(msg);
  const isMimeMismatch = isImageMimeMismatchError(msg);
  const isApiReject = /invalid_request_error/i.test(msg);
  return isApiReject && (isImageSizeError || isMimeMismatch);
}
