# Claw - Claude Code Multi-User Platform

Claw 是一个基于 Claude Code SDK 的多用户平台，支持多用户同时使用 Claude Code 进行开发工作。

## 特性

- 🔐 **多用户支持** - JWT 认证，支持用户注册/登录
- 💬 **会话管理** - 每个用户可以有多个独立的 Claude 会话
- 🔧 **MCP 服务器** - 支持配置和管理 MCP 工具服务器
- 📁 **文件隔离** - 每个会话有独立的工作目录
- 🌊 **流式响应** - 支持 SSE 流式输出


### 功能

- ✅ 认证 API 适配 (登录/注册/用户信息)
- ✅ 会话管理 API 适配 (创建/删除/列表)
- ✅ 消息 API 适配 (发送/接收/历史)
- ✅ MCP 服务器管理适配
- ✅ 流式事件处理

# 3. 替换导入路径
# 详见 WEB_ADAPTER_INTEGRATION.md
```

详细集成指南请查看 [WEB_ADAPTER_INTEGRATION.md](./WEB_ADAPTER_INTEGRATION.md)

## 快速开始

### 1. 安装依赖

```bash
npm install

如果遇到.pnpm/bindings@1.5.0/node_modules/bindings/bindings.js:126
  err = new Error(
        ^

Error: Could not locate the bindings file. Tried:报错


npm install better-sqlite3@12.9.0 --force
```

### 2. 配置环境变量

####  需要nodejs v22版本及以上

```bash
cp .env.example .env
# 编辑 .env 文件，设置必要的配置
```

### 3. 启动服务

```bash
# 开发模式
npm run dev

# 生产模式
npm run build
npm start
```

### 4. 访问

- API: http://localhost:3000
- 默认管理员账号: `admin@example.com` / `admin123`

## API 文档

### 认证

```bash
# 注册
POST /api/auth/register
{
  "email": "user@example.com",
  "password": "password123",
  "name": "User Name"
}

# 登录
POST /api/auth/login
{
  "email": "user@example.com",
  "password": "password123"
}
```

### Claude 会话

```bash
# 创建会话
POST /api/claude/sessions
Authorization: Bearer <token>
{
  "workspace": "my-project",
  "sessionId": "optional-session-id"
}

# 列出会话
GET /api/claude/sessions
Authorization: Bearer <token>

# 发送消息（非流式）
POST /api/claude/query
Authorization: Bearer <token>
{
  "workspace": "my-project",
  "sessionId": "session-id",
  "prompt": "Hello Claude!",
  "mcpServers": ["server-id-1"]
}

# 发送消息（流式）
POST /api/claude/query/stream
Authorization: Bearer <token>
{
  "workspace": "my-project",
  "sessionId": "session-id",
  "prompt": "Hello Claude!"
}

# 中止查询
POST /api/claude/abort
Authorization: Bearer <token>
{
  "workspace": "my-project",
  "sessionId": "session-id"
}

# 上传文件
POST /api/claude/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data
{
  "file": <file>,
  "workspace": "my-project",
  "sessionId": "session-id"
}
```

### MCP 服务器管理

```bash
# 列出 MCP 服务器
GET /api/mcp
Authorization: Bearer <token>

# 创建 MCP 服务器
POST /api/mcp
Authorization: Bearer <token>
{
  "name": "filesystem",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"],
  "env": {}
}

# 更新 MCP 服务器
PUT /api/mcp/:id
Authorization: Bearer <token>
{
  "enabled": false
}

# 删除 MCP 服务器
DELETE /api/mcp/:id
Authorization: Bearer <token>

# 切换启用状态
POST /api/mcp/:id/toggle
Authorization: Bearer <token>
```

## 目录结构

```
claw/
├── src/
│   ├── index.ts              # 主入口
│   ├── config.ts             # 配置
│   ├── types.ts              # 类型定义
│   ├── db.ts                 # 数据库操作
│   ├── services/
│   │   ├── auth.service.ts   # 认证服务
│   │   └── claude-session.service.ts  # Claude 会话服务
│   └── routes/
│       ├── auth.ts           # 认证路由
│       ├── claude.ts         # Claude 路由
│       └── mcp.ts            # MCP 路由
├── data/                     # 数据目录
│   ├── claw.db               # SQLite 数据库
│   └── sessions/             # 用户会话目录
│       └── {userId}/
│           └── {workspace}/
│               └── {sessionId}/
├── .env                      # 环境变量
├── package.json
└── README.md
```

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `PORT` | 服务端口 | `3000` |
| `DATABASE_URL` | 数据库路径 | `./data/claw.db` |
| `CLAUDE_BASE_URL` | Claude SDK 地址 | `http://127.0.0.1:3456` |
| `CLAUDE_MODEL` | Claude 模型 | `claude-sonnet-4-20250514` |
| `CLAUDE_MAX_TURNS` | 最大对话轮数 | `100` |
| `CLAUDE_MAX_BUDGET_USD` | 最大预算（美元） | `10` |
| `CLAUDE_SANDBOX_ENABLED` | 启用沙箱 | `false` |
| `CLAUDE_BASE_DIR` | 会话基础目录 | `./data/sessions` |
| `JWT_SECRET` | JWT 密钥 | `change-this-in-production` |
| `ADMIN_EMAIL` | 管理员邮箱 | `admin@example.com` |
| `ADMIN_PASSWORD` | 管理员密码 | `admin123` |

## 注意事项

1. **Claude SDK 要求**: 需要安装 `@anthropic-ai/claude-agent-sdk` 并确保 Claude Code 服务可访问
2. **安全性**: 生产环境请修改 `JWT_SECRET` 和管理员密码
3. **文件隔离**: 每个用户的会话文件存储在独立目录中
4. **会话清理**: 空闲会话会自动清理（默认 30 分钟）

## License

MIT
