import type { FastifyInstance } from 'fastify';
import { authMiddleware } from './auth.js';
import { groupDb } from '../db.js';
import { resolve, join, dirname, normalize, relative, sep } from 'path';
import { appConfig } from '../config.js';
import { readdir, stat, mkdir, readFile, writeFile, rm } from 'fs/promises';
import { existsSync, realpathSync, createReadStream } from 'fs';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const SYSTEM_PATHS = ['logs', 'CLAUDE.md', '.claude', 'conversations'];

// MIME 类型映射（预览端点共用）
const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  js: 'text/javascript',
  ts: 'text/typescript',
  jsx: 'text/javascript',
  tsx: 'text/typescript',
  css: 'text/css',
  html: 'text/html',
  xml: 'application/xml',
  py: 'text/x-python',
  go: 'text/x-go',
  rs: 'text/x-rust',
  java: 'text/x-java',
  c: 'text/x-c',
  cpp: 'text/x-c++',
  h: 'text/x-c',
  sh: 'text/x-sh',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  toml: 'text/x-toml',
  ini: 'text/plain',
  conf: 'text/plain',
  log: 'text/plain',
  csv: 'text/csv',
  pdf: 'application/pdf',
  zip: 'application/zip',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  '7z': 'application/x-7z-compressed',
};

// 允许 inline 预览的安全 MIME 类型（排除 HTML 和 SVG 以防止 XSS）
const SAFE_PREVIEW_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/plain',
  'text/markdown',
  'text/css',
  'text/csv',
  'text/yaml',
  'text/x-python',
  'text/x-go',
  'text/x-rust',
  'text/x-java',
  'text/x-c',
  'text/x-c++',
  'text/x-sh',
  'text/x-toml',
  'text/javascript',
  'text/typescript',
  'application/json',
  'application/xml',
  'application/pdf',
]);

// 文本文件扩展名（用于编辑端点判断）
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'json', 'js', 'ts', 'jsx', 'tsx', 'css', 'html', 'xml',
  'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'sh', 'yaml', 'yml',
  'toml', 'ini', 'conf', 'log', 'csv', 'svg',
]);

export function getFileRoot(folder: string): string {
  return resolve(appConfig.claude.baseDir, folder);
}

export function validateAndResolvePath(folder: string, relativePath: string): string {
  const root = getFileRoot(folder);
  const normalized = normalize(relativePath);
  const resolved = resolve(root, normalized);

  const rel = relative(root, resolved);
  if (rel.startsWith('..')) {
    throw new Error('Path traversal detected');
  }

  // 解析符号链接：沿路径向上找到最近的已存在祖先
  const realRoot = existsSync(root) ? realpathSync(root) : root;
  let checkPath = resolved;
  while (checkPath !== root && checkPath !== dirname(checkPath)) {
    if (existsSync(checkPath)) {
      const realPath = realpathSync(checkPath);
      if (realPath !== realRoot && !realPath.startsWith(realRoot + sep)) {
        throw new Error('Symlink traversal detected');
      }
      break;
    }
    checkPath = dirname(checkPath);
  }

  return resolved;
}

export function isSystemPath(relativePath: string): boolean {
  const normalized = normalize(relativePath);
  const segments = normalized.split(sep).filter(Boolean);
  if (segments.length === 0) return false;
  if (segments.length === 1 && segments[0] === '.') return false;
  const firstSegment = segments[0];
  return SYSTEM_PATHS.some((sysPath) => firstSegment === sysPath || normalized === sysPath);
}

function buildAttachmentContentDisposition(fileName: string): string {
  const sanitized = fileName.replace(/["\\\r\n]/g, '_');
  const asciiFallback = sanitized.replace(/[^\x20-\x7E]/g, '_') || 'download';
  const encoded = encodeURIComponent(fileName);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

function decodePath(encodedPath: string): string {
  // base64url decoder in Node.js is lenient and also accepts standard base64 alphabet
  return Buffer.from(encodedPath, 'base64url').toString('utf-8');
}

export default async function filesRoutes(fastify: FastifyInstance) {
  // GET /api/groups/:jid/files - 获取文件列表
  fastify.get('/', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const jid = (request.params as any).jid as string;
      const group = groupDb.findById(jid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      const user = request.user as { userId: string };
      const members = group.members || [];
      if (group.ownerId !== user.userId && !members.includes(user.userId)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const pathParam = (request.query as any).path || '';
      const targetPath = validateAndResolvePath(group.folder || jid, pathParam);

      const entries: any[] = [];
      try {
        const items = await readdir(targetPath, { withFileTypes: true });
        for (const item of items) {
          const itemPath = join(targetPath, item.name);
          const itemStat = await stat(itemPath);
          const entryRelativePath = join(pathParam, item.name).replace(/\\/g, '/');
          entries.push({
            name: item.name,
            path: entryRelativePath,
            type: item.isDirectory() ? 'directory' : 'file',
            size: itemStat.size,
            modified_at: itemStat.mtime.toISOString(),
            isSystem: isSystemPath(entryRelativePath),
          });
        }
      } catch {
        // 目录不存在，返回空列表
      }

      // 文件夹在前，文件在后，按名称排序
      entries.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      return reply.send({ files: entries, currentPath: pathParam });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to load files';
      const isSafe = ['Path traversal detected', 'Symlink traversal detected'].includes(msg);
      return reply.status(isSafe ? 400 : 500).send({ error: msg });
    }
  });

  // POST /api/groups/:jid/files - 上传文件
  fastify.post('/', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const jid = (request.params as any).jid as string;
      const group = groupDb.findById(jid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      const user = request.user as { userId: string };
      const members = group.members || [];
      if (group.ownerId !== user.userId && !members.includes(user.userId)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const folder = group.folder || jid;

      // Fastify multipart: read single file + fields
      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: 'No file provided' });
      }

      // Parse fields from multipart
      const fields: any = {};
      for (const [key, value] of Object.entries(data.fields || {})) {
        fields[key] = Array.isArray(value) ? (value[0] as any).value : (value as any).value;
      }
      const targetPathParam = fields.path || '';

      const uploadedFiles: string[] = [];
      const fileName = data.filename;
      if (fileName.includes('..') || fileName.startsWith('/')) {
        return reply.status(400).send({ error: `Invalid file name: ${fileName}` });
      }

      const relativeFilePath = join(targetPathParam, fileName);
      if (isSystemPath(targetPathParam) || isSystemPath(relativeFilePath)) {
        return reply.status(403).send({ error: 'Cannot upload to system path' });
      }

      const targetFilePath = validateAndResolvePath(folder, relativeFilePath);
      const targetDir = dirname(targetFilePath);

      await mkdir(targetDir, { recursive: true });
      const buffer = await data.toBuffer();
      if (buffer.length > MAX_FILE_SIZE) {
        return reply.status(400).send({ error: `File ${fileName} exceeds maximum size of 50MB` });
      }
      await writeFile(targetFilePath, buffer);
      uploadedFiles.push(fileName);

      return reply.send({ success: true, files: uploadedFiles });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to upload files';
      const isSafe = ['Path traversal detected', 'Symlink traversal detected'].includes(msg);
      return reply.status(isSafe ? 400 : 500).send({ error: msg });
    }
  });

  // POST /api/groups/:jid/directories - 创建目录
  fastify.post('/directories', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const jid = (request.params as any).jid as string;
      const group = groupDb.findById(jid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      const user = request.user as { userId: string };
      const members = group.members || [];
      if (group.ownerId !== user.userId && !members.includes(user.userId)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const body = request.body as any;
      const parentPath = body.path || '';
      const dirName = body.name;

      if (!dirName) {
        return reply.status(400).send({ error: 'Name is required' });
      }

      const folder = group.folder || jid;
      const targetPath = validateAndResolvePath(folder, join(parentPath, dirName));
      if (isSystemPath(join(parentPath, dirName))) {
        return reply.status(403).send({ error: 'Cannot create directory in system path' });
      }

      await mkdir(targetPath, { recursive: true });
      return reply.send({ success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to create directory';
      const isSafe = ['Path traversal detected', 'Symlink traversal detected'].includes(msg);
      return reply.status(isSafe ? 400 : 500).send({ error: msg });
    }
  });

  // GET /api/groups/:jid/files/content/:encodedPath - 获取文件内容
  fastify.get('/content/:encodedPath', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const jid = (request.params as any).jid as string;
      const group = groupDb.findById(jid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      const user = request.user as { userId: string };
      const members = group.members || [];
      if (group.ownerId !== user.userId && !members.includes(user.userId)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const encodedPath = (request.params as any).encodedPath as string;
      const filePath = decodePath(encodedPath);
      const folder = group.folder || jid;
      const targetPath = validateAndResolvePath(folder, filePath);

      if (!existsSync(targetPath)) {
        return reply.status(404).send({ error: 'File not found' });
      }

      const stats = await stat(targetPath);
      if (stats.isDirectory()) {
        return reply.status(400).send({ error: 'Cannot read directory content' });
      }

      const ext = targetPath.split('.').pop()?.toLowerCase() || '';
      if (!TEXT_EXTENSIONS.has(ext)) {
        return reply.status(400).send({ error: 'File type not supported for content reading' });
      }

      if (stats.size > 10 * 1024 * 1024) {
        return reply.status(400).send({ error: 'File too large to read (max 10MB)' });
      }

      const content = await readFile(targetPath, 'utf-8');
      return reply.send({ content, size: stats.size });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to read file';
      const isSafe = ['Path traversal detected', 'Symlink traversal detected'].includes(msg);
      return reply.status(isSafe ? 400 : 500).send({ error: msg });
    }
  });

  // PUT /api/groups/:jid/files/content/:encodedPath - 更新文件内容
  fastify.put('/content/:encodedPath', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const jid = (request.params as any).jid as string;
      const group = groupDb.findById(jid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      const user = request.user as { userId: string };
      const members = group.members || [];
      if (group.ownerId !== user.userId && !members.includes(user.userId)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const encodedPath = (request.params as any).encodedPath as string;
      const filePath = decodePath(encodedPath);
      const folder = group.folder || jid;

      if (isSystemPath(filePath)) {
        return reply.status(403).send({ error: 'Cannot edit system file' });
      }

      const targetPath = validateAndResolvePath(folder, filePath);

      const body = request.body as any;
      if (typeof body.content !== 'string') {
        return reply.status(400).send({ error: 'Content field is required' });
      }

      if (Buffer.byteLength(body.content, 'utf-8') > 10 * 1024 * 1024) {
        return reply.status(400).send({ error: 'Content too large (max 10MB)' });
      }

      // If file exists, validate it's a text file
      if (existsSync(targetPath)) {
        const stats = await stat(targetPath);
        if (stats.isDirectory()) {
          return reply.status(400).send({ error: 'Cannot edit directory content' });
        }
        const ext = targetPath.split('.').pop()?.toLowerCase() || '';
        if (!TEXT_EXTENSIONS.has(ext)) {
          return reply.status(400).send({ error: 'File type not supported for editing' });
        }
      }

      // Ensure parent directory exists and write file
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, body.content, 'utf-8');

      return reply.send({ success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to write file';
      const isSafe = ['Path traversal detected', 'Symlink traversal detected'].includes(msg);
      return reply.status(isSafe ? 400 : 500).send({ error: msg });
    }
  });

  // DELETE /api/groups/:jid/files/:encodedPath - 删除文件或目录
  fastify.delete('/:encodedPath', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const jid = (request.params as any).jid as string;
      const group = groupDb.findById(jid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      const user = request.user as { userId: string };
      const members = group.members || [];
      if (group.ownerId !== user.userId && !members.includes(user.userId)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const encodedPath = (request.params as any).encodedPath as string;
      const filePath = decodePath(encodedPath);
      const folder = group.folder || jid;

      if (!filePath || filePath === '.' || filePath === '/') {
        return reply.status(400).send({ error: 'Cannot delete root directory' });
      }

      if (isSystemPath(filePath)) {
        return reply.status(403).send({ error: 'Cannot delete system path' });
      }

      const targetPath = validateAndResolvePath(folder, filePath);
      const root = getFileRoot(folder);

      if (resolve(targetPath) === resolve(root)) {
        return reply.status(400).send({ error: 'Cannot delete root directory' });
      }

      if (!existsSync(targetPath)) {
        return reply.status(404).send({ error: 'File or directory not found' });
      }

      // Double-check realpath before destructive operation
      const realRoot = realpathSync(root);
      const realPath = realpathSync(targetPath);
      if (realPath !== realRoot && !realPath.startsWith(realRoot + sep)) {
        return reply.status(400).send({ error: 'Symlink traversal detected' });
      }
      if (realPath === realRoot) {
        return reply.status(400).send({ error: 'Cannot delete root directory' });
      }

      await rm(targetPath, { recursive: true, force: true });
      return reply.send({ success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to delete file';
      const safeMessages = new Set([
        'Cannot delete system path',
        'Cannot delete root directory',
        'File or directory not found',
        'Path traversal detected',
        'Symlink traversal detected',
      ]);
      const isSafe = safeMessages.has(msg);
      return reply.status(isSafe ? 400 : 500).send({ error: msg });
    }
  });

  // GET /api/groups/:jid/files/download/:encodedPath - 下载文件
  fastify.get('/download/:encodedPath', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const jid = (request.params as any).jid as string;
      const group = groupDb.findById(jid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      const user = request.user as { userId: string };
      const members = group.members || [];
      if (group.ownerId !== user.userId && !members.includes(user.userId)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const encodedPath = (request.params as any).encodedPath as string;
      const filePath = decodePath(encodedPath);
      const folder = group.folder || jid;
      const targetPath = validateAndResolvePath(folder, filePath);

      if (!existsSync(targetPath)) {
        return reply.status(404).send({ error: 'File not found' });
      }

      const stats = await stat(targetPath);
      if (stats.isDirectory()) {
        return reply.status(400).send({ error: 'Cannot download directory' });
      }

      const fileName = targetPath.split(sep).pop() || 'download';
      reply.header('Content-Disposition', buildAttachmentContentDisposition(fileName));
      reply.header('Content-Type', 'application/octet-stream');
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
      return reply.send(createReadStream(targetPath));
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to download file';
      const isSafe = ['Path traversal detected', 'Symlink traversal detected'].includes(msg);
      return reply.status(isSafe ? 400 : 500).send({ error: msg });
    }
  });

  // GET /api/groups/:jid/files/preview/:encodedPath - 预览文件
  fastify.get('/preview/:encodedPath', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const jid = (request.params as any).jid as string;
      const group = groupDb.findById(jid);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      const user = request.user as { userId: string };
      const members = group.members || [];
      if (group.ownerId !== user.userId && !members.includes(user.userId)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const encodedPath = (request.params as any).encodedPath as string;
      const filePath = decodePath(encodedPath);
      const folder = group.folder || jid;
      const targetPath = validateAndResolvePath(folder, filePath);

      if (!existsSync(targetPath)) {
        return reply.status(404).send({ error: 'File not found' });
      }

      const stats = await stat(targetPath);
      if (stats.isDirectory()) {
        return reply.status(400).send({ error: 'Cannot preview directory' });
      }

      const ext = targetPath.split('.').pop()?.toLowerCase() || '';
      const mimeType = MIME_MAP[ext] || 'application/octet-stream';
      const fileName = targetPath.split(sep).pop() || 'preview';

      reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
      reply.header('X-Content-Type-Options', 'nosniff');

      if (SAFE_PREVIEW_MIME_TYPES.has(mimeType)) {
        reply.header('Content-Type', mimeType);
        reply.header('Content-Disposition', 'inline');
      } else {
        reply.header('Content-Type', 'application/octet-stream');
        reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
      }

      return reply.send(createReadStream(targetPath));
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to preview file';
      const isSafe = ['Path traversal detected', 'Symlink traversal detected'].includes(msg);
      return reply.status(isSafe ? 400 : 500).send({ error: msg });
    }
  });
}
