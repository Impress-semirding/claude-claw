import type { FastifyInstance } from 'fastify';
import { authMiddleware, adminMiddleware } from './auth.js';
import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { resolve, join, basename } from 'path';
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  statSync,
} from 'fs';

const AGENTS_DIR = resolve(homedir(), '.claude', 'agents');

function ensureAgentsDir() {
  if (!existsSync(AGENTS_DIR)) {
    mkdirSync(AGENTS_DIR, { recursive: true });
  }
}

function parseFrontmatter(content: string) {
  let description = '';
  let tools: string[] = [];
  let name = '';
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (match) {
    const yaml = match[1];
    const descMatch = yaml.match(/^description:\s*(.*)$/m);
    if (descMatch) description = descMatch[1].trim();
    const toolsMatch = yaml.match(/^tools:\s*\n((?:\s+-\s+.*\n?)+)/m);
    if (toolsMatch) {
      tools = toolsMatch[1]
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('- '))
        .map((l) => l.replace(/^-\s+/, '').trim());
    }
    const nameMatch = yaml.match(/^name:\s*(.*)$/m);
    if (nameMatch) name = nameMatch[1].trim();
  }
  return { description, tools, name };
}

function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\-_\s]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 64);
}

interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  tools: string[];
  updatedAt: string;
  content?: string;
}

function listAgentDefinitions(): AgentDefinition[] {
  ensureAgentsDir();
  const entries: AgentDefinition[] = [];
  for (const file of readdirSync(AGENTS_DIR)) {
    if (!file.endsWith('.md')) continue;
    const filePath = join(AGENTS_DIR, file);
    try {
      const stat = statSync(filePath);
      const content = readFileSync(filePath, 'utf-8');
      const { description, tools, name } = parseFrontmatter(content);
      const id = basename(file, '.md');
      entries.push({
        id,
        name: name || id,
        description,
        tools,
        updatedAt: new Date(stat.mtime).toISOString(),
      });
    } catch {
      // ignore unreadable files
    }
  }
  return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function readAgentDefinition(id: string): AgentDefinition | undefined {
  ensureAgentsDir();
  const filePath = join(AGENTS_DIR, `${id}.md`);
  if (!existsSync(filePath)) return undefined;
  try {
    const stat = statSync(filePath);
    const content = readFileSync(filePath, 'utf-8');
    const { description, tools, name } = parseFrontmatter(content);
    return {
      id,
      name: name || id,
      description,
      tools,
      updatedAt: new Date(stat.mtime).toISOString(),
      content,
    };
  } catch {
    return undefined;
  }
}

function writeAgentDefinition(id: string, content: string): void {
  ensureAgentsDir();
  const filePath = join(AGENTS_DIR, `${id}.md`);
  writeFileSync(filePath, content, 'utf-8');
}

function deleteAgentDefinition(id: string): void {
  ensureAgentsDir();
  const filePath = join(AGENTS_DIR, `${id}.md`);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

export default async function agentDefinitionsRoutes(fastify: FastifyInstance) {
  // GET /api/agent-definitions - 获取所有 Agent 定义
  fastify.get('/', { preHandler: authMiddleware }, async (_request, reply) => {
    try {
      const agentsList = listAgentDefinitions();
      return reply.send({ agents: agentsList });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load agents' });
    }
  });

  // GET /api/agent-definitions/:id - 获取 Agent 定义详情
  fastify.get('/:id', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      const agent = readAgentDefinition(id);
      if (!agent) {
        return reply.status(404).send({ error: 'Agent not found' });
      }
      return reply.send({ agent });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to load agent' });
    }
  });

  // POST /api/agent-definitions - 创建 Agent 定义
  fastify.post('/', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const body = request.body as any;
      const name = body.name || 'Untitled';
      const id = sanitizeFilename(name) || randomUUID();
      const description = body.description || '';
      const tools = body.tools || [];
      const content = body.content || body.prompt || '';

      let finalContent = content;
      if (!content.startsWith('---')) {
        const toolsYaml = tools.length
          ? 'tools:\n' + tools.map((t: string) => `  - ${t}`).join('\n') + '\n'
          : '';
        finalContent = `---\nname: ${name}\ndescription: ${description}\n${toolsYaml}---\n\n${content}`;
      }

      writeAgentDefinition(id, finalContent);
      return reply.status(201).send({ success: true, id });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to create agent' });
    }
  });

  // PUT /api/agent-definitions/:id - 更新 Agent 定义
  fastify.put('/:id', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      const agent = readAgentDefinition(id);
      if (!agent) {
        return reply.status(404).send({ error: 'Agent not found' });
      }
      const body = request.body as any;
      const name = body.name || agent.name;
      const description = body.description !== undefined ? body.description : agent.description;
      const tools = body.tools !== undefined ? body.tools : agent.tools;
      const content = body.content !== undefined ? body.content : agent.content;

      let finalContent = content || '';
      if (!finalContent.startsWith('---') && content) {
        const toolsYaml = tools && tools.length
          ? 'tools:\n' + tools.map((t: string) => `  - ${t}`).join('\n') + '\n'
          : '';
        finalContent = `---\nname: ${name}\ndescription: ${description}\n${toolsYaml}---\n\n${content}`;
      } else if (content) {
        finalContent = content;
      }

      writeAgentDefinition(id, finalContent);
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to update agent' });
    }
  });

  // DELETE /api/agent-definitions/:id - 删除 Agent 定义
  fastify.delete('/:id', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      if (!readAgentDefinition(id)) {
        return reply.status(404).send({ error: 'Agent not found' });
      }
      deleteAgentDefinition(id);
      return reply.send({ success: true });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to delete agent' });
    }
  });
}
