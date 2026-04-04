# Claude Code 多用户目录隔离架构文档

## 概述

本文档介绍基于 `@anthropic-ai/claude-agent-sdk` 实现的多用户目录隔离架构，确保不同用户、不同工作区、不同会话之间的文件系统完全隔离。

## 架构设计

### 目录隔离层级

采用三级目录结构实现隔离：

```
{baseDir}/
├── {userId}/                          # 用户级隔离
│   ├── {workspace}/                    # 工作区级隔离
│   │   ├── {sessionId}/                # 会话级隔离
│   │   │   ├── .claude/               # Claude 配置目录 (CLAUDE_CONFIG_DIR)
│   │   │   ├── tmp/                   # 临时文件目录 (CLAUDE_CODE_TMPDIR)
│   │   │   ├── upload-files/          # 用户上传文件存储
│   │   │   └── ...                    # 会话工作文件
```

### 隔离标识

| 层级 | 标识符 | 示例 |
|------|--------|------|
| 用户 | `userId` | `@example.com` |
| 工作区 | `workspace` | `project-a`, `default-workspace` |
| 会话 | `sessionId` | `session-123456` |

**会话唯一键**：`{userId}:{workspace}:{sessionId}`

## 核心实现

### 1. 目录构建

```typescript
// src/service/claudeSession.service.ts

async createSession(userId: string, workspace: string, sessionId: string) {
  // 目录结构：baseDir/{userId}/{workspace}/{sessionId}
  const relativeWorkDir = path.join(userId, workspace, sessionId);
  const relativeConfigDir = path.join(relativeWorkDir, '.claude');
  const relativeTmpDir = path.join(relativeWorkDir, 'tmp');
  
  const absWorkDir = path.resolve(this.claudeConfig.baseDir, relativeWorkDir);
  const absConfigDir = path.resolve(this.claudeConfig.baseDir, relativeConfigDir);
  
  // 自动创建目录
  fs.mkdirSync(absConfigDir, { recursive: true });
  
  // 可选：从模板初始化工作区
  if (this.claudeConfig.templateDir) {
    this.copyTemplate(this.claudeConfig.templateDir, absWorkDir);
  }
  
  return {
    sessionId,
    userId,
    workspace,
    configDir: relativeConfigDir,
    workDir: relativeWorkDir,
    tmpDir: relativeTmpDir,
    status: 'idle',
  };
}
```

### 2. 查询隔离（核心）

```typescript
async *querySession({ userId, workspace, sessionId, prompt, mcpServers }) {
  const key = this.sessionKey(userId, workspace, sessionId);
  let session = this.sessions.get(key);
  
  // 自动初始化：若 session 不存在则自动创建
  if (!session) {
    session = await this.createSession(userId, workspace, sessionId);
  }
  
  // 构建绝对路径
  const absWorkDir = path.resolve(this.claudeConfig.baseDir, session.workDir);
  const absConfigDir = path.resolve(this.claudeConfig.baseDir, session.configDir);
  const absTmpDir = path.resolve(this.claudeConfig.baseDir, session.tmpDir);
  
  // 确保目录存在
  fs.mkdirSync(absWorkDir, { recursive: true });
  fs.mkdirSync(absTmpDir, { recursive: true });
  
  // 构建隔离环境变量
  const env: Record<string, any> = {
    ...process.env,
    CLAUDE_CONFIG_DIR: absConfigDir,           // Claude 配置隔离
    CLAUDE_CODE_TMPDIR: absTmpDir,             // 临时文件隔离
    CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: '1',
    HOME: absConfigDir,                         // HOME 目录隔离
    MAX_MCP_OUTPUT_TOKENS: 50000,
  };
  
  // 核心：传给 SDK 的 options
  const options: ClaudeQueryOptions = {
    cwd: absWorkDir,                           // ← 关键：工作目录隔离
    env,
    mcpServers: this.makeMcpServersConfig(mcpServers),
    model: this.claudeConfig.model,
    maxTurns: this.claudeConfig.maxTurns,
    maxBudgetUsd: this.claudeConfig.maxBudgetUsd,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    sandbox: {
      enabled: this.claudeConfig.sandboxEnabled,
      autoAllowBashIfSandboxed: true,
    },
    resume: session.sdkSessionId,              // 会话恢复
  };
  
  // 调用 SDK
  const claudeQuery = await this.loadClaudeQuery();
  const stream = claudeQuery({ prompt, options });
  
  for await (const message of stream) {
    // 从 init 消息中提取 SDK session_id 用于恢复
    if (message.type === 'system' && message.subtype === 'init') {
      session.sdkSessionId = message.session_id;
    }
    yield message;
  }
}
```

### 3. 文件上传隔离

```typescript
// src/controller/claude.controller.ts

@Post('/upload')
async uploadFile(@File() file: any) {
  const userId = headers.userId || headers.email;
  const workspace = headers.workspace || 'default-workspace';
  const sessionId = headers.sessionId || '';
  
  // 构建隔离的上传目录
  const uploadDir = path.join(
    baseDir,
    userId,
    workspace,
    sessionId,
    'upload-files'
  );
  
  fs.mkdirSync(uploadDir, { recursive: true });
  
  const tmpFileName = `${Date.now()}_${file.filename}`;
  const filePath = path.join(uploadDir, tmpFileName);
  fs.writeFileSync(filePath, fs.readFileSync(file.data));
  
  return {
    success: true,
    data: { fileName: file.filename, filePath },
  };
}
```

## 配置说明

### 配置文件

```typescript
// src/config/config.local.ts

export default {
  claude: {
    // 会话工作区根目录
    baseDir: path.join(rootDir, 'claude'),
    
    // 新 session 初始化模板目录
    templateDir: path.join(rootDir, 'claude-template'),
    
    // 是否启用沙箱
    sandboxEnabled: true,
    
    // Claude API 配置
    baseUrl: 'http://127.0.0.1:3456',
    model: 'deepseek',
    
    // 限制配置
    maxSessionsPerUser: 10,      // 每用户最大会话数
    maxTurns: 100,               // 单次查询最大轮次
    maxBudgetUsd: 10,            // 单次查询最大预算（USD）
    maxIdleMs: 30 * 60 * 1000,   // 空闲清理时间（30分钟）
    disallowedTools: [],         // 禁用的工具列表
  },
};
```

## API 接口

### 文件上传
```http
POST /api/claude/upload
Headers: {
  "userId": "@example.com",
  "workspace": "project-a",
  "sessionId": "session-123"
}
Body: multipart/form-data (file)
```

### 流式查询
```http
POST /api/claude/query
Content-Type: application/json

{
  "userId": "@example.com",
  "workspace": "project-a",
  "sessionId": "session-123",
  "prompt": "帮我分析代码",
  "mcpServers": {}
}
```

### 查询会话状态
```http
GET /api/claude/session?userId=zhangsan@example.com&workspace=project-a&sessionId=session-123
```

### 列出所有会话
```http
GET /api/claude/sessions?userId=zhangsan@example.com
```

### 销毁会话
```http
DELETE /api/claude/session?userId=zhangsan@example.com&workspace=project-a&sessionId=session-123
```

### 中断查询
```http
POST /api/claude/abort
Content-Type: application/json

{
  "userId": "zhangsan@example.com",
  "workspace": "project-a",
  "sessionId": "session-123"
}
```

## 会话管理

### 会话状态

```typescript
type SessionStatus = 'idle' | 'running' | 'error' | 'destroyed';

interface ISessionInfo {
  sessionId: string;           // 业务 sessionId
  userId: string;              // 用户标识
  workspace: string;           // 工作区名称
  sdkSessionId?: string;       // SDK 返回的 session_id（用于恢复）
  configDir: string;           // 配置目录（相对路径）
  workDir: string;             // 工作目录（相对路径）
  tmpDir: string;              // 临时目录（相对路径）
  createdAt: number;           // 创建时间
  lastActiveAt: number;        // 最后活跃时间
  status: SessionStatus;       // 会话状态
}
```

### 会话存储

- **内存存储**：`Map<string, ISessionInfo>` 用于运行时快速访问
- **持久化**：`registry.json` 用于服务重启后恢复会话信息

```typescript
// 会话键格式
private sessionKey(userId: string, workspace: string, sessionId: string): string {
  return `${userId}:${workspace}:${sessionId}`;
}
```

## 安全特性

### 1. 沙箱模式
```typescript
options.sandbox = {
  enabled: true,
  autoAllowBashIfSandboxed: true,
};
```

### 2. 权限控制
```typescript
// 非 root 用户可跳过权限确认
permissionMode: isRunningAsRoot ? 'default' : 'bypassPermissions',
allowDangerouslySkipPermissions: !isRunningAsRoot,
```

### 3. 资源限制
- `maxTurns`：限制单次查询的交互轮次
- `maxBudgetUsd`：限制单次查询的 API 费用
- `maxSessionsPerUser`：限制每用户的并发会话数

### 4. 工具禁用
```typescript
disallowedTools: ['tool1', 'tool2'],  // 禁用特定工具
```

## 关键要点总结

1. **核心隔离机制**：通过 `options.cwd` 参数为每个会话指定独立的工作目录

2. **环境变量隔离**：
   - `CLAUDE_CONFIG_DIR`：配置目录隔离
   - `CLAUDE_CODE_TMPDIR`：临时文件隔离
   - `HOME`：HOME 目录隔离

3. **自动目录管理**：会话不存在时自动创建目录结构，销毁时自动清理

4. **会话恢复支持**：通过 `sdkSessionId` 支持 Claude SDK 的会话恢复功能

5. **模板初始化**：支持从模板目录复制初始文件到新会话工作区

6. **持久化存储**：会话信息持久化到 `registry.json`，支持服务重启后恢复
