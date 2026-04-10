/**
 * In-process MCP server for the Agent runner.
 * Provides claw-specific tools: memory, messaging, scheduling, time.
 *
 * Tools that require parent-side services (send_message, schedule_task)
 * communicate back via stderr JSON markers so the parent can execute them.
 */

import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { appendFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import type { AgentEnvironment } from './agent.js';

export interface ClawMcpServerTools {
  claw: any;
}

export function buildClawMcpServer(env: AgentEnvironment): ClawMcpServerTools {
  const memoryAppend = tool(
    'memory_append',
    "Append a memory entry to the workspace's memory/YYYY-MM-DD.md. Use for temporary progress, decisions, todos, and meeting notes that may become outdated.",
    {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The markdown content to append.',
        },
        date: {
          type: 'string',
          description: 'Optional date override (YYYY-MM-DD). Defaults to today.',
        },
      },
      required: ['content'],
    } as const,
    async (args: { content: string; date?: string }) => {
      const today = args.date || new Date().toISOString().split('T')[0];
      const memoryDir = resolve(env.workspaceDir, 'memory');
      mkdirSync(memoryDir, { recursive: true });
      const filePath = join(memoryDir, `${today}.md`);
      const timestamp = new Date().toLocaleString('zh-CN');
      const entry = `## ${timestamp}\n\n${args.content}\n\n`;
      appendFileSync(filePath, entry, 'utf-8');
      return { success: true, file: `memory/${today}.md`, timestamp };
    }
  );

  const memorySearch = tool(
    'memory_search',
    'Search memory files in the workspace memory/ directory for keywords.',
    {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keywords to search for.',
        },
        limit: {
          type: 'number',
          description: 'Max number of files to return. Default 10.',
        },
      },
      required: ['query'],
    } as const,
    async (args: { query: string; limit?: number }) => {
      const memoryDir = resolve(env.workspaceDir, 'memory');
      if (!existsSync(memoryDir)) {
        return { results: [] };
      }
      const files = readdirSync(memoryDir)
        .filter((f) => f.endsWith('.md'))
        .sort()
        .reverse();
      const queryLower = args.query.toLowerCase();
      const limit = args.limit ?? 10;
      const results: Array<{ file: string; matches: string[] }> = [];

      for (const file of files) {
        if (results.length >= limit) break;
        const content = readFileSync(join(memoryDir, file), 'utf-8');
        if (content.toLowerCase().includes(queryLower)) {
          const lines = content.split('\n');
          const matches: string[] = [];
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(queryLower)) {
              const context = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 2)).join('\n');
              matches.push(context);
              if (matches.length >= 3) break;
            }
          }
          results.push({ file: `memory/${file}`, matches });
        }
      }
      return { results };
    }
  );

  const memoryGet = tool(
    'memory_get',
    'Retrieve the full content of a specific memory file.',
    {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'Memory file path, e.g. memory/2024-01-01.md',
        },
      },
      required: ['file'],
    } as const,
    async (args: { file: string }) => {
      const safe = args.file.replace(/\.{2}/g, '').replace(/^\/+/, '');
      const filePath = resolve(env.workspaceDir, safe);
      if (!existsSync(filePath)) {
        return { error: `File not found: ${args.file}` };
      }
      const content = readFileSync(filePath, 'utf-8');
      return { file: args.file, content };
    }
  );

  const sendMessage = tool(
    'send_message',
    'Send a message to the current chat channel. Use sparingly: your normal text reply is already visible to the user. Only use this for proactive notifications or long-running task updates.',
    {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Message content to send.',
        },
      },
      required: ['content'],
    } as const,
    async (args: { content: string }) => {
      console.error(
        JSON.stringify({
          __mcp__: true,
          type: 'send_message',
          chatJid: env.chatJid,
          content: args.content,
        })
      );
      return { success: true };
    }
  );

  const scheduleTask = tool(
    'schedule_task',
    'Schedule a recurring prompt task for this group.',
    {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Task name.',
        },
        cron: {
          type: 'string',
          description: 'Cron expression (e.g. "0 9 * * *").',
        },
        prompt: {
          type: 'string',
          description: 'Prompt to execute on each run.',
        },
      },
      required: ['name', 'cron', 'prompt'],
    } as const,
    async (args: { name: string; cron: string; prompt: string }) => {
      console.error(
        JSON.stringify({
          __mcp__: true,
          type: 'schedule_task',
          userId: env.userId,
          chatJid: env.chatJid,
          name: args.name,
          cron: args.cron,
          prompt: args.prompt,
        })
      );
      return { success: true };
    }
  );

  const getCurrentTime = tool(
    'get_current_time',
    'Get the current date and time.',
    {
      type: 'object',
      properties: {},
    } as const,
    async () => {
      const now = new Date();
      return {
        iso: now.toISOString(),
        locale: now.toLocaleString('zh-CN'),
        date: now.toISOString().split('T')[0],
        time: now.toTimeString(),
      };
    }
  );

  const server = createSdkMcpServer({
    name: 'claw',
    version: '1.0.0',
    tools: [memoryAppend, memorySearch, memoryGet, sendMessage, scheduleTask, getCurrentTime],
  });

  return { claw: server };
}
