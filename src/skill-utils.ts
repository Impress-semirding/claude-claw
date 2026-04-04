import { existsSync, readdirSync, readFileSync, statSync, realpathSync } from 'fs';
import { join } from 'path';

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  source: string;
  enabled: boolean;
  userInvocable: boolean;
  allowedTools: string[];
  argumentHint: string | null;
  updatedAt: string;
  files: Array<{ name: string; type: 'file' | 'directory'; size: number }>;
}

export function validateSkillId(id: string): boolean {
  return /^[\w\-]+$/.test(id);
}

export function validateSkillPath(skillsRoot: string, skillDir: string): boolean {
  try {
    const realSkillsRoot = realpathSync(skillsRoot);
    const realSkillDir = realpathSync(skillDir);
    const relative = require('path').relative(realSkillsRoot, realSkillDir);
    return !relative.startsWith('..') && !require('path').isAbsolute(relative);
  } catch {
    return false;
  }
}

export function parseFrontmatter(content: string): Record<string, string> {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return {};

  const endIndex = lines.slice(1).findIndex((line) => line.trim() === '---');
  if (endIndex === -1) return {};

  const frontmatterLines = lines.slice(1, endIndex + 1);
  const result: Record<string, string> = {};
  let currentKey: string | null = null;
  let currentValue: string[] = [];
  let multilineMode: 'folded' | 'literal' | null = null;

  for (const line of frontmatterLines) {
    const keyMatch = line.match(/^([\w\-]+):\s*(.*)$/);
    if (keyMatch) {
      if (currentKey) {
        result[currentKey] = currentValue.join(multilineMode === 'literal' ? '\n' : ' ');
      }

      currentKey = keyMatch[1];
      const value = keyMatch[2].trim();

      if (value === '>') {
        multilineMode = 'folded';
        currentValue = [];
      } else if (value === '|') {
        multilineMode = 'literal';
        currentValue = [];
      } else {
        result[currentKey] = value;
        currentKey = null;
        currentValue = [];
        multilineMode = null;
      }
    } else if (currentKey && multilineMode) {
      const trimmedLine = line.trimStart();
      if (trimmedLine) {
        currentValue.push(trimmedLine);
      }
    }
  }

  if (currentKey) {
    result[currentKey] = currentValue.join(multilineMode === 'literal' ? '\n' : ' ');
  }

  return result;
}

export function listFiles(dir: string): Array<{ name: string; type: 'file' | 'directory'; size: number }> {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    return entries
      .filter((entry) => !entry.name.startsWith('.'))
      .map((entry) => {
        const fullPath = join(dir, entry.name);
        const stats = statSync(fullPath);
        return {
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: entry.isDirectory() ? 0 : stats.size,
        };
      });
  } catch {
    return [];
  }
}

export function scanSkillDirectory(rootDir: string, source: string): SkillInfo[] {
  const skills: SkillInfo[] = [];
  if (!existsSync(rootDir)) return skills;

  try {
    const entries = readdirSync(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillDir = join(rootDir, entry.name);
      const skillMdPath = join(skillDir, 'SKILL.md');
      const skillMdDisabledPath = join(skillDir, 'SKILL.md.disabled');

      let enabled = false;
      let skillFilePath: string | null = null;

      if (existsSync(skillMdPath)) {
        enabled = true;
        skillFilePath = skillMdPath;
      } else if (existsSync(skillMdDisabledPath)) {
        enabled = false;
        skillFilePath = skillMdDisabledPath;
      } else {
        continue;
      }

      try {
        const content = readFileSync(skillFilePath, 'utf-8');
        const frontmatter = parseFrontmatter(content);
        const stats = statSync(skillDir);

        skills.push({
          id: entry.name,
          name: frontmatter.name || entry.name,
          description: frontmatter.description || '',
          source,
          enabled,
          userInvocable:
            frontmatter['user-invocable'] === undefined ? true : frontmatter['user-invocable'] !== 'false',
          allowedTools: frontmatter['allowed-tools'] ? frontmatter['allowed-tools'].split(',').map((t) => t.trim()) : [],
          argumentHint: frontmatter['argument-hint'] || null,
          updatedAt: stats.mtime.toISOString(),
          files: listFiles(skillDir),
        });
      } catch {
        // Skip malformed skills
      }
    }
  } catch {
    // Skip if directory is not readable
  }

  return skills;
}
