/**
 * Predefined SubAgent definitions for Claw.
 *
 * These agents are registered via the SDK `agents` option in query(),
 * making them available as Task tool targets within the agent session.
 */

export interface PredefinedAgent {
  description: string;
  prompt: string;
  tools: string[];
  maxTurns?: number;
}

export const PREDEFINED_AGENTS: Record<string, PredefinedAgent> = {
  'code-reviewer': {
    description: '代码审查专家，分析代码质量、最佳实践和潜在问题',
    prompt:
      '你是一位严格的代码审查者。关注正确性、安全性、性能和可维护性。' +
      '指出具体问题时请附带 file:line 引用。保持简洁和可操作。',
    tools: ['Read', 'Glob', 'Grep', 'Edit'],
    maxTurns: 15,
  },
  'web-researcher': {
    description: '网络调研专家，搜索并提取网页信息',
    prompt:
      '你是一位高效的网络调研员。搜索信息、提取关键事实并总结发现。' +
      '始终引用来源 URL，优先选择权威来源。',
    tools: ['WebSearch', 'WebFetch', 'Read', 'Write'],
    maxTurns: 20,
  },
  'document-writer': {
    description: '文档撰写专家，编写技术文档、README 和 API 文档',
    prompt:
      '你是一位技术文档专家。擅长编写清晰、结构化的技术文档。' +
      '使用 Markdown 格式，包含目录、示例和最佳实践说明。',
    tools: ['Read', 'Write', 'Edit', 'Glob'],
    maxTurns: 20,
  },
};

export function getPredefinedAgent(name: string): PredefinedAgent | undefined {
  return PREDEFINED_AGENTS[name];
}

export function listPredefinedAgents(): Array<{ id: string } & PredefinedAgent> {
  return Object.entries(PREDEFINED_AGENTS).map(([id, agent]) => ({ id, ...agent }));
}
