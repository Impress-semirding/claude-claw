import { randomUUID } from 'crypto';
import { agentDb, groupDb } from '../db.js';
import { ClaudeAgent } from './agent.js';

const CODE_REVIEWER_PROMPT = `---
description: 专注于代码审查的 Sub-Agent，分析正确性、安全性、性能与可维护性
tools:
  - Read
  - Glob
  - Grep
---

你是一位严格的代码审查员（Code Reviewer）。你的目标是帮助用户发现代码中的问题并给出可执行的改进建议。

**审查维度**
1. **正确性**：逻辑错误、边界条件、并发问题、资源泄漏。
2. **安全性**：注入风险、敏感信息暴露、不安全的依赖、权限校验缺失。
3. **性能**：不必要的循环、重复计算、过大内存占用、低效算法。
4. **可维护性**：命名清晰、函数长度、重复代码、注释/文档缺失、类型安全。

**输出要求**
- 对每一个问题，尽量给出 **文件:行号** 级别的具体引用。
- 优先指出最关键的前 3-5 个问题，不要过于冗长。
- 每条建议必须附带**可执行的动作**（如何修改、为什么要改）。
- 语气直接、简洁、专业，不需要客套话。
`;

const WEB_RESEARCHER_PROMPT = `---
description: 网页研究 Sub-Agent，搜索信息、提取关键事实并总结发现
tools:
  - WebSearch
  - WebFetch
  - Read
  - Write
---

你是一位高效的网络研究员（Web Researcher）。你的任务是帮用户快速收集和整理网上的信息。

**工作方式**
1. 先分析用户的问题，判断需要哪些信息维度。
2. 使用 WebSearch 查找相关网页，优先选择权威来源（官方文档、知名技术博客、学术论文、主流媒体）。
3. 对关键网页使用 WebFetch 提取具体内容，不要只看标题。
4. 将发现整理成结构化的摘要，包括核心结论、关键数据、注意事项。

**输出要求**
- **所有引用必须标注来源 URL**。
- 对相互矛盾的信息，要指出不同来源的差异。
- 如果信息 insufficient，明确告诉用户还需要查找什么。
- 语言简洁、条理清晰，优先使用 bullet points 和表格。
`;

export const MAIN_AGENT = new ClaudeAgent({ id: 'main', name: 'main' });

export const CODE_REVIEWER_AGENT = new ClaudeAgent({
  id: 'code-reviewer',
  name: 'code-reviewer',
  prompt: CODE_REVIEWER_PROMPT,
  allowedTools: ['Read', 'Glob', 'Grep'],
});

export const WEB_RESEARCHER_AGENT = new ClaudeAgent({
  id: 'web-researcher',
  name: 'web-researcher',
  prompt: WEB_RESEARCHER_PROMPT,
  allowedTools: ['WebSearch', 'WebFetch', 'Read', 'Write'],
});

const PREDEFINED_AGENT_MAP = new Map<string, ClaudeAgent>([
  ['code-reviewer', CODE_REVIEWER_AGENT],
  ['web-researcher', WEB_RESEARCHER_AGENT],
]);

export const PREDEFINED_AGENTS = [
  {
    name: 'code-reviewer',
    prompt: CODE_REVIEWER_PROMPT,
    kind: 'conversation' as const,
  },
  {
    name: 'web-researcher',
    prompt: WEB_RESEARCHER_PROMPT,
    kind: 'conversation' as const,
  },
] as const;

/**
 * Resolve a runtime ClaudeAgent instance for the given group and optional agentId.
 * If no agentId is provided, returns the MAIN_AGENT.
 * If a predefined agent matches the DB record, returns a copy with the DB-specific id.
 */
export function resolveAgent(_groupId: string, agentId?: string): ClaudeAgent {
  if (!agentId) {
    return MAIN_AGENT;
  }

  const dbAgent = agentDb.findById(agentId);
  if (!dbAgent) {
    return MAIN_AGENT;
  }

  const predefined = PREDEFINED_AGENT_MAP.get(dbAgent.name);
  if (predefined) {
    return new ClaudeAgent({
      id: agentId,
      name: dbAgent.name,
      prompt: dbAgent.prompt || predefined.prompt,
      maxTurns: predefined.maxTurns,
      allowedTools: predefined.allowedTools,
      disallowedTools: predefined.disallowedTools,
    });
  }

  // Custom sub-agent: use DB prompt without tool constraints
  return new ClaudeAgent({
    id: agentId,
    name: dbAgent.name,
    prompt: dbAgent.prompt || undefined,
  });
}

/**
 * Ensure predefined sub-agents exist for a given group.
 * Skips creation if an agent with the same name already exists in the group.
 */
export function ensurePredefinedAgents(groupId: string): void {
  const existingNames = new Set(
    agentDb.findByGroup(groupId).map((a) => a.name)
  );

  for (const preset of PREDEFINED_AGENTS) {
    if (existingNames.has(preset.name)) continue;

    agentDb.create({
      id: randomUUID(),
      groupId,
      name: preset.name,
      prompt: preset.prompt,
      status: 'idle',
      kind: preset.kind,
    });
  }
}

/**
 * Backfill predefined sub-agents for all existing groups.
 * Safe to call on every startup (idempotent).
 */
export function ensurePredefinedAgentsForAllGroups(): void {
  const allGroups = groupDb.findAll ? groupDb.findAll() : [];
  let created = 0;
  for (const group of allGroups) {
    const before = agentDb.findByGroup(group.id).length;
    ensurePredefinedAgents(group.id);
    const after = agentDb.findByGroup(group.id).length;
    created += after - before;
  }
  if (created > 0) {
    console.log(`[agent-presets] backfilled ${created} predefined agents across ${allGroups.length} groups`);
  }
}
