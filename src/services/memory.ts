/**
 * Hierarchical memory system inspired by Claude Code CLI's claudemd.ts.
 *
 * Discovery order (lowest -> highest priority):
 * 1. User global memory (~/.claude/CLAUDE.md equivalent in Claw)
 * 2. Project memory (workspace CLAUDE.md, .claude/CLAUDE.md)
 * 3. Local memory (workspace CLAUDE.local.md)
 *
 * Additional features:
 * - .claude/rules/*.md scanning
 * - Frontmatter `paths` globs for conditional rule matching
 * - @include directive support (respects code blocks)
 */

import { readFileSync, readdirSync, Dirent } from 'fs';
import { resolve, dirname, join, isAbsolute, relative, sep } from 'path';
import { minimatch } from 'minimatch';
import { readFileCached } from '../utils/file-cache.js';

export type MemoryType = 'User' | 'Project' | 'Local' | 'Managed';

export interface MemoryFileInfo {
  path: string;
  type: MemoryType;
  content: string;
  parent?: string;
  globs?: string[];
}

const MAX_MEMORY_CHARACTER_COUNT = 40000;
const MAX_INCLUDE_DEPTH = 5;

const MEMORY_INSTRUCTION_PROMPT =
  'Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.';

// File extensions allowed for @include directives
type TextFileExtensions = Set<string>;
const TEXT_FILE_EXTENSIONS: TextFileExtensions = new Set([
  '.md',
  '.txt',
  '.text',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.csv',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.py',
  '.pyi',
  '.rb',
  '.erb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.bat',
  '.cmd',
  '.env',
  '.ini',
  '.cfg',
  '.conf',
  '.config',
  '.sql',
  '.graphql',
  '.proto',
  '.vue',
  '.svelte',
  '.php',
  '.lua',
  '.sql',
  '.lock',
  '.log',
  '.diff',
  '.patch',
]);

function isTextFile(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return TEXT_FILE_EXTENSIONS.has(ext);
}

/**
 * Parse simple YAML frontmatter from the start of a file.
 * Only extracts `paths` as a comma/string or array value.
 */
function parseFrontmatterPaths(rawContent: string): { content: string; paths?: string[] } {
  const match = rawContent.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!match) {
    return { content: rawContent };
  }

  const frontmatter = match[1];
  const content = rawContent.slice(match[0].length);

  const pathsMatch = frontmatter.match(/^paths:\s*(.+)$/m);
  if (!pathsMatch) {
    return { content };
  }

  const rawPaths = pathsMatch[1].trim();
  let paths: string[];

  if (rawPaths.startsWith('[') && rawPaths.endsWith(']')) {
    // Array syntax: ["src/**/*.ts", "*.md"]
    paths = rawPaths
      .slice(1, -1)
      .split(',')
      .map((p) => p.trim().replace(/^["']|["']$/g, ''))
      .filter((p) => p.length > 0);
  } else {
    // Single string or multi-line list
    paths = rawPaths
      .split(/,|\n/)
      .map((p) => p.trim().replace(/^-?\s*/, '').replace(/^["']|["']$/g, ''))
      .filter((p) => p.length > 0 && p !== 'paths:');
  }

  const cleanedPaths = paths
    .map((p) => (p.endsWith('/**') ? p.slice(0, -3) : p))
    .filter((p) => p.length > 0);

  if (cleanedPaths.length === 0 || cleanedPaths.every((p) => p === '**')) {
    return { content };
  }

  return { content, paths: cleanedPaths };
}

/**
 * Remove HTML block comments <!-- ... --> from markdown.
 * Simple regex-based approach; does not use a full lexer.
 */
function stripHtmlComments(content: string): string {
  return content.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Extract @path include references from content, skipping code blocks.
 */
function extractIncludePaths(content: string, basePath: string): string[] {
  const absolutePaths = new Set<string>();

  // Remove fenced code blocks to avoid extracting @paths inside them
  const withoutCodeBlocks = content.replace(/```[\s\S]*?```/g, '');

  const includeRegex = /(?:^|\s)@((?:[^\s\\]|\\ )+)/g;
  let match: RegExpExecArray | null;

  while ((match = includeRegex.exec(withoutCodeBlocks)) !== null) {
    let p = match[1];
    if (!p) continue;

    // Strip fragment identifiers
    const hashIndex = p.indexOf('#');
    if (hashIndex !== -1) {
      p = p.substring(0, hashIndex);
    }
    if (!p) continue;

    p = p.replace(/\\ /g, ' ');

    const isValidPath =
      p.startsWith('./') ||
      p.startsWith('~/') ||
      (p.startsWith('/') && p !== '/') ||
      (!p.startsWith('@') && /^[a-zA-Z0-9._\-]/.test(p));

    if (isValidPath) {
      const resolved = resolveIncludePath(p, dirname(basePath));
      if (resolved) {
        absolutePaths.add(resolved);
      }
    }
  }

  return Array.from(absolutePaths);
}

function resolveIncludePath(p: string, baseDir: string): string | null {
  if (p.startsWith('~/')) {
    const home = process.env.HOME || process.env.USERPROFILE;
    if (!home) return null;
    return resolve(home, p.slice(2));
  }
  if (isAbsolute(p)) {
    return resolve(p);
  }
  // @path without prefix is treated as relative to baseDir
  return resolve(baseDir, p.startsWith('./') ? p.slice(2) : p);
}

function readMemoryFileRaw(filePath: string): string | null {
  try {
    return readFileCached(filePath) ?? readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function parseMemoryFileContent(
  rawContent: string,
  filePath: string,
  type: MemoryType,
  includeBasePath?: string
): { info: MemoryFileInfo | null; includePaths: string[] } {
  if (!isTextFile(filePath)) {
    return { info: null, includePaths: [] };
  }

  const { content: withoutFrontmatter, paths } = parseFrontmatterPaths(rawContent);
  const strippedContent = stripHtmlComments(withoutFrontmatter);

  const includePaths = includeBasePath
    ? extractIncludePaths(strippedContent, includeBasePath)
    : [];

  const finalContent = strippedContent;

  return {
    info: {
      path: filePath,
      type,
      content: finalContent,
      globs: paths,
    },
    includePaths,
  };
}

export async function processMemoryFile(
  filePath: string,
  type: MemoryType,
  processedPaths: Set<string>,
  depth: number = 0,
  parent?: string
): Promise<MemoryFileInfo[]> {
  const normalizedPath = resolve(filePath);
  if (processedPaths.has(normalizedPath) || depth >= MAX_INCLUDE_DEPTH) {
    return [];
  }

  processedPaths.add(normalizedPath);

  const rawContent = readMemoryFileRaw(filePath);
  if (rawContent === null) {
    return [];
  }

  const { info: memoryFile, includePaths } = parseMemoryFileContent(
    rawContent,
    filePath,
    type,
    normalizedPath
  );

  if (!memoryFile || !memoryFile.content.trim()) {
    return [];
  }

  if (parent) {
    memoryFile.parent = parent;
  }

  const result: MemoryFileInfo[] = [memoryFile];

  for (const includePath of includePaths) {
    // In this simplified version we allow all includes.
    // External includes (outside workspace) are allowed for User memory.
    const includedFiles = await processMemoryFile(
      includePath,
      type,
      processedPaths,
      depth + 1,
      filePath
    );
    result.push(...includedFiles);
  }

  return result;
}

export async function processMdRules({
  rulesDir,
  type,
  processedPaths,
  conditionalRule,
}: {
  rulesDir: string;
  type: MemoryType;
  processedPaths: Set<string>;
  conditionalRule: boolean;
}): Promise<MemoryFileInfo[]> {
  const result: MemoryFileInfo[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(rulesDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    const entryPath = join(rulesDir, entry.name);
    if (entry.isDirectory()) {
      result.push(
        ...(await processMdRules({
          rulesDir: entryPath,
          type,
          processedPaths,
          conditionalRule,
        }))
      );
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const files = await processMemoryFile(entryPath, type, processedPaths);
      result.push(...files.filter((f) => (conditionalRule ? f.globs : !f.globs)));
    }
  }

  return result;
}

/**
 * Gets conditional rules that match the target path.
 */
async function processConditionedMdRules(
  targetPath: string,
  rulesDir: string,
  type: MemoryType,
  processedPaths: Set<string>
): Promise<MemoryFileInfo[]> {
  const conditionedRuleMdFiles = await processMdRules({
    rulesDir,
    type,
    processedPaths,
    conditionalRule: true,
  });

  return conditionedRuleMdFiles.filter((file) => {
    if (!file.globs || file.globs.length === 0) {
      return false;
    }

    const baseDir = dirname(dirname(rulesDir)); // Parent of .claude
    const relPath = isAbsolute(targetPath) ? relative(baseDir, targetPath) : targetPath;

    if (!relPath || relPath.startsWith('..') || isAbsolute(relPath)) {
      return false;
    }

    return file.globs.some((pattern) => minimatch(relPath, pattern, { dot: true }));
  });
}

/**
 * Load all memory files for a workspace, walking from workspace root upward.
 *
 * Order: root -> ... -> workspace (so closer files have higher priority / loaded later)
 */
export async function getMemoryFiles(
  workspaceDir: string,
  options?: {
    userGlobalPath?: string;
    targetPath?: string;
  }
): Promise<MemoryFileInfo[]> {
  const result: MemoryFileInfo[] = [];
  const processedPaths = new Set<string>();

  // 1. User global memory
  if (options?.userGlobalPath) {
    result.push(
      ...(await processMemoryFile(options.userGlobalPath, 'User', processedPaths))
    );
  }

  // 2. Walk from root upward to workspaceDir
  const dirs: string[] = [];
  let currentDir = resolve(workspaceDir);
  const root = parseRoot(currentDir);

  while (currentDir !== root) {
    dirs.push(currentDir);
    const parent = dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }
  dirs.push(root);

  // Process from root downward (lowest priority first)
  for (const dir of dirs.reverse()) {
    const projectPath = join(dir, 'CLAUDE.md');
    result.push(
      ...(await processMemoryFile(projectPath, 'Project', processedPaths))
    );

    const dotClaudePath = join(dir, '.claude', 'CLAUDE.md');
    result.push(
      ...(await processMemoryFile(dotClaudePath, 'Project', processedPaths))
    );

    const rulesDir = join(dir, '.claude', 'rules');

    // Unconditional rules
    const unconditionalProcessedPaths = new Set(processedPaths);
    result.push(
      ...(await processMdRules({
        rulesDir,
        type: 'Project',
        processedPaths: unconditionalProcessedPaths,
        conditionalRule: false,
      }))
    );

    // Conditional rules
    if (options?.targetPath) {
      result.push(
        ...(await processConditionedMdRules(
          options.targetPath,
          rulesDir,
          'Project',
          processedPaths
        ))
      );
    }

    for (const path of unconditionalProcessedPaths) {
      processedPaths.add(path);
    }

    // Local memory
    const localPath = join(dir, 'CLAUDE.local.md');
    result.push(
      ...(await processMemoryFile(localPath, 'Local', processedPaths))
    );
  }

  return result;
}

function parseRoot(p: string): string {
  if (process.platform === 'win32') {
    return p.split(sep)[0] + sep;
  }
  return '/';
}

export function getClaudeMds(memoryFiles: MemoryFileInfo[]): string {
  const memories: string[] = [];

  for (const file of memoryFiles) {
    if (!file.content.trim()) continue;

    const description =
      file.type === 'Project'
        ? ' (project instructions, checked into the codebase)'
        : file.type === 'Local'
        ? " (user's private project instructions, not checked in)"
        : " (user's private global instructions for all projects)";

    memories.push(`Contents of ${file.path}${description}:\n\n${file.content.trim()}`);
  }

  if (memories.length === 0) {
    return '';
  }

  return `${MEMORY_INSTRUCTION_PROMPT}\n\n${memories.join('\n\n')}`;
}

export function getLargeMemoryFiles(files: MemoryFileInfo[]): MemoryFileInfo[] {
  return files.filter((f) => f.content.length > MAX_MEMORY_CHARACTER_COUNT);
}

export function clearMemoryFileCaches(): void {
  // No-op: we rely on the file-cache utility which handles invalidation via mtime
}
