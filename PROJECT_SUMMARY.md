# Claw 项目总结

## 项目概述

Claw 是一个基于 Claude Code SDK 的多用户平台，支持多用户同时使用 Claude Code 进行开发工作。项目包含完整的后端 API 和 Web 前端适配器，可以与 HappyClaw Web 前端无缝对接。

## 已完成的功能

### 后端功能 ✅

1. **用户认证系统**
   - JWT Token 认证
   - 用户注册/登录
   - 密码修改
   - 用户信息管理

2. **Claude 会话管理**
   - 创建/删除/列出会话
   - 发送消息（流式/非流式）
   - 会话持久化到 SQLite
   - 自动加载历史会话

3. **MCP 服务器管理**
   - 添加/删除/更新 MCP 服务器
   - 启用/禁用服务器
   - 支持环境变量配置

4. **文件管理**
   - 文件上传/下载
   - 会话目录隔离
   - 文件列表和删除

5. **流式响应**
   - SSE 流式输出
   - 支持思考过程显示
   - 工具调用事件

### Web 前端适配器 ✅

1. **API 客户端**
   - 统一的 API 请求封装
   - 自动 Token 管理
   - 错误处理

2. **Auth Store**
   - 登录/注册状态管理
   - 用户信息缓存
   - 权限检查

3. **Chat Store**
   - 会话列表管理
   - 消息发送/接收
   - 流式事件处理

4. **MCP Servers Store**
   - MCP 服务器列表
   - 添加/删除/更新

## 项目结构

```
claw/
├── src/                          # 后端源码
│   ├── index.ts                  # 主入口
│   ├── config.ts                 # 配置管理
│   ├── types.ts                  # 类型定义
│   ├── db.ts                     # 数据库操作
│   ├── services/                 # 服务层
│   │   ├── auth.service.ts       # 认证服务
│   │   ├── claude-session.service.ts  # Claude 会话服务
│   │   └── mcp-server.service.ts      # MCP 服务
│   ├── routes/                   # API 路由
│   │   ├── auth.ts               # 认证路由
│   │   ├── sessions.ts           # 会话路由
│   │   ├── messages.ts           # 消息路由
│   │   ├── mcp.ts                # MCP 路由
│   │   └── files.ts              # 文件路由
│   └── middleware/               # 中间件
│       └── auth.ts               # 认证中间件
├── web-adapter/                  # Web 前端适配器
│   ├── api/
│   │   └── client.ts             # API 客户端
│   ├── stores/
│   │   ├── auth.ts               # Auth Store
│   │   ├── chat.ts               # Chat Store
│   │   └── mcp-servers.ts        # MCP Store
│   ├── types.ts                  # 类型定义
│   ├── index.ts                  # 导出入口
│   ├── package.json              # 适配器配置
│   └── README.md                 # 适配器文档
├── scripts/                      # 脚本
│   └── test-api.sh               # API 测试脚本
├── data/                         # 数据目录
│   ├── claw.db                   # SQLite 数据库
│   └── sessions/                 # 会话文件
├── .env                          # 环境变量
├── package.json
├── README.md                     # 项目文档
├── WEB_ADAPTER_INTEGRATION.md    # 适配器集成指南
└── PROJECT_SUMMARY.md            # 本文件
```

## 快速开始

### 1. 启动后端

```bash
cd /Users/dingxue/Documents/claude/claw

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env，设置 ANTHROPIC_API_KEY

# 启动服务
npm run dev
```

后端将在 `http://localhost:3000` 启动。

### 2. 测试 API

```bash
./scripts/test-api.sh
```

### 3. 集成 HappyClaw Web

按照 [WEB_ADAPTER_INTEGRATION.md](./WEB_ADAPTER_INTEGRATION.md) 的说明进行集成。

## API 端点

### 认证
- `POST /api/auth/register` - 注册
- `POST /api/auth/login` - 登录
- `GET /api/auth/me` - 获取当前用户
- `PUT /api/auth/password` - 修改密码
- `PUT /api/auth/profile` - 更新资料

### 会话
- `GET /api/sessions` - 列出会话
- `POST /api/sessions` - 创建会话
- `DELETE /api/sessions/:id` - 删除会话

### 消息
- `GET /api/sessions/:id/messages` - 获取消息
- `POST /api/sessions/:id/messages` - 发送消息
- `POST /api/sessions/:id/messages/stream` - 流式发送

### MCP 服务器
- `GET /api/mcp` - 列出服务器
- `POST /api/mcp` - 添加服务器
- `PUT /api/mcp/:id` - 更新服务器
- `DELETE /api/mcp/:id` - 删除服务器

### 文件
- `GET /api/files` - 列出文件
- `POST /api/files/upload` - 上传文件
- `GET /api/files/download/:filename` - 下载文件
- `DELETE /api/files/:filename` - 删除文件

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `PORT` | 服务端口 | `3000` |
| `DATABASE_URL` | 数据库路径 | `./data/claw.db` |
| `CLAUDE_BASE_URL` | Claude SDK 地址 | `http://127.0.0.1:3456` |
| `CLAUDE_MODEL` | Claude 模型 | `claude-sonnet-4-20250514` |
| `JWT_SECRET` | JWT 密钥 | `change-this-in-production` |
| `ADMIN_EMAIL` | 管理员邮箱 | `admin@example.com` |
| `ADMIN_PASSWORD` | 管理员密码 | `admin123` |

## 技术栈

- **后端**: Node.js + Express + TypeScript
- **数据库**: SQLite (better-sqlite3)
- **认证**: JWT
- **前端适配器**: TypeScript + Zustand
- **AI**: Claude Code SDK

## 待实现功能

- [ ] WebSocket 实时消息推送
- [ ] 图片消息支持
- [ ] 消息搜索
- [ ] 用户权限管理
- [ ] 计费系统
- [ ] IM 集成 (飞书/钉钉/微信等)
- [ ] 多工作区支持
- [ ] 团队协作功能

## 贡献

欢迎提交 PR 来完善功能！

## 许可证

MIT
