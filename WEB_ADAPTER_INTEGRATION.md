# Claw Web 适配器集成指南

本文档说明如何将 HappyClaw Web 前端与 Claw 后端集成。

## 架构概述

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  HappyClaw Web  │────▶│  Claw Web       │────▶│  Claw Backend   │
│  (React + Vite) │◀────│  Adapter        │◀────│  (Node.js)      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                              │
                              ▼
                        ┌─────────────────┐
                        │  Claude API     │
                        │  (Anthropic)    │
                        └─────────────────┘
```

## 快速开始

### 1. 启动 Claw 后端

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

### 2. 配置 HappyClaw Web

在 HappyClaw web 项目中：

```bash
# 1. 安装适配器依赖
cd happyclaw/web
npm install zustand

# 2. 复制适配器文件
mkdir -p src/adapter
cp -r /Users/dingxue/Documents/claude/claw/web-adapter/* src/adapter/

# 3. 创建环境变量文件
echo "VITE_CLAW_API_URL=http://localhost:3000" > .env.local
```

### 3. 修改 HappyClaw 导入

替换以下文件中的导入：

**src/api/client.ts**
```typescript
// 替换为
export { api, apiFetch } from '../adapter/api/client';
export type { ApiError } from '../adapter/api/client';
```

**src/stores/auth.ts**
```typescript
// 替换为
export { useAuthStore } from '../adapter/stores/auth';
export type { UserPublic, Permission, AppearanceConfig } from '../adapter/stores/auth';
```

**src/stores/chat.ts**
```typescript
// 替换为
export { useChatStore } from '../adapter/stores/chat';
export type { Message, GroupInfo, AgentInfo, StreamingState } from '../adapter/stores/chat';
```

**src/stores/mcp-servers.ts** (如果存在)
```typescript
// 替换为
export { useMcpServersStore } from '../adapter/stores/mcp-servers';
export type { McpServer } from '../adapter/stores/mcp-servers';
```

### 4. 启动 HappyClaw Web

```bash
cd happyclaw/web
npm run dev
```

## API 端点映射

### 认证

| HappyClaw | Claw | 状态 |
|-----------|------|------|
| POST /api/auth/login | POST /api/auth/login | ✅ |
| POST /api/auth/register | POST /api/auth/register | ✅ |
| GET /api/auth/me | GET /api/auth/me | ✅ |
| PUT /api/auth/password | PUT /api/auth/password | ✅ |
| PUT /api/auth/profile | PUT /api/auth/profile | ✅ |

### 会话/群组

| HappyClaw | Claw | 状态 |
|-----------|------|------|
| GET /api/groups | GET /api/sessions | ✅ |
| POST /api/groups | POST /api/sessions | ✅ |
| DELETE /api/groups/:id | DELETE /api/sessions/:id | ✅ |
| GET /api/groups/:id/messages | GET /api/sessions/:id/messages | ✅ |
| POST /api/messages | POST /api/sessions/:id/messages | ✅ |

### MCP 服务器

| HappyClaw | Claw | 状态 |
|-----------|------|------|
| GET /api/mcp-servers | GET /api/mcp | ✅ |
| POST /api/mcp-servers | POST /api/mcp | ✅ |
| PUT /api/mcp-servers/:id | PUT /api/mcp/:id | ✅ |
| DELETE /api/mcp-servers/:id | DELETE /api/mcp/:id | ✅ |

## 数据结构差异

### 用户对象

**HappyClaw 格式:**
```json
{
  "id": "user_xxx",
  "username": "john",
  "display_name": "John Doe",
  "role": "admin",
  "status": "active",
  "permissions": ["manage_system_config"],
  "created_at": "2024-01-01T00:00:00Z",
  "last_login_at": "2024-01-02T00:00:00Z",
  "avatar_emoji": "👤",
  "avatar_color": "#FF5733"
}
```

**Claw 格式:**
```json
{
  "id": "user_xxx",
  "username": "john",
  "displayName": "John Doe",
  "role": "admin",
  "status": "active",
  "permissions": ["manage_system_config"],
  "createdAt": "2024-01-01T00:00:00Z",
  "lastLoginAt": "2024-01-02T00:00:00Z",
  "avatarEmoji": "👤",
  "avatarColor": "#FF5733"
}
```

适配器会自动进行字段名转换 (snake_case ↔ camelCase)。

### 消息对象

**HappyClaw 格式:**
```json
{
  "id": "msg_xxx",
  "chat_jid": "group_xxx",
  "sender": "user",
  "sender_name": "John",
  "content": "Hello",
  "timestamp": "2024-01-01T00:00:00Z",
  "is_from_me": false
}
```

**Claw 格式:**
```json
{
  "id": "msg_xxx",
  "sessionId": "session_xxx",
  "role": "user",
  "content": "Hello",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

## 功能差异

### 已实现功能

- ✅ 用户认证 (登录/注册)
- ✅ 会话管理 (创建/删除/列表)
- ✅ 消息发送和接收
- ✅ MCP 服务器管理
- ✅ 流式响应处理

### 待实现功能

- 🔄 WebSocket 实时消息推送
- 🔄 文件上传/下载
- 🔄 图片消息
- 🔄 消息搜索
- 🔄 用户权限管理
- 🔄 计费系统
- 🔄 IM 集成 (飞书/钉钉/微信等)

## 故障排除

### 问题: 401 Unauthorized

**原因:** Token 未正确传递

**解决:** 确保 `apiFetch` 函数正确添加了 Authorization header

```typescript
// 在 api/client.ts 中
const token = localStorage.getItem('claw_token');
if (token) {
  headers['Authorization'] = `Bearer ${token}`;
}
```

### 问题: CORS 错误

**原因:** 跨域请求被阻止

**解决:** 确保 Claw 后端已启用 CORS

```typescript
// 在 claw/src/index.ts 中
app.use(cors({
  origin: 'http://localhost:5173', // HappyClaw web 地址
  credentials: true
}));
```

### 问题: 消息不显示

**原因:** 数据格式不匹配

**解决:** 检查浏览器开发者工具中的 Network 面板，确认 API 响应格式正确

## 开发调试

### 查看 API 请求

在浏览器开发者工具中：
1. 打开 Network 面板
2. 过滤 `Fetch/XHR` 请求
3. 查看请求和响应详情

### 测试 API

使用提供的测试脚本：

```bash
cd /Users/dingxue/Documents/claude/claw
./scripts/test-api.sh
```

### 日志输出

在 Claw 后端启用调试日志：

```bash
DEBUG=claw:* npm run dev
```

## 生产部署

### 1. 构建 Claw 后端

```bash
cd /Users/dingxue/Documents/claude/claw
npm run build
npm start
```

### 2. 配置 HappyClaw Web

```bash
cd happyclaw/web
# 更新 .env.production
VITE_CLAW_API_URL=https://your-claw-api.com

npm run build
```

### 3. 配置反向代理

使用 Nginx 配置示例：

```nginx
server {
  listen 80;
  server_name your-domain.com;

  location / {
    root /path/to/happyclaw/web/dist;
    try_files $uri $uri/ /index.html;
  }

  location /api {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
  }
}
```

## 贡献

欢迎提交 PR 来完善适配器功能！

## 许可证

MIT
