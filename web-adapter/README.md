 # HappyClaw Web 前端适配器

这个适配器将 HappyClaw 的前端组件与 Claw 后端 API 对接。

## 功能

- ✅ 认证 API 适配 (登录/注册/用户信息)
- ✅ 会话管理 API 适配 (创建/删除/列表)
- ✅ 消息 API 适配 (发送/接收/历史)
- ✅ MCP 服务器管理适配
- ✅ 流式事件处理

## 安装

### 1. 在 HappyClaw web 项目中安装适配器

```bash
# 假设适配器已发布到 npm
npm install @claw/web-adapter

# 或者使用本地路径
npm install /path/to/claw/web-adapter
```

### 2. 配置环境变量

在 HappyClaw web 项目的 `.env` 文件中添加：

```env
VITE_CLAW_API_URL=http://localhost:3000
```

### 3. 替换导入

在 HappyClaw web 项目中，替换原有的 API 客户端和 stores：

```typescript
// 替换前 (原有 HappyClaw 导入)
import { api } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useChatStore } from '../stores/chat';

// 替换后 (使用适配器)
import { api } from '@claw/web-adapter/api/client';
import { useAuthStore } from '@claw/web-adapter/stores/auth';
import { useChatStore } from '@claw/web-adapter/stores/chat';
```

## API 映射

### 认证

| HappyClaw API | Claw API | 说明 |
|--------------|----------|------|
| POST /api/auth/login | POST /api/auth/login | 登录 |
| POST /api/auth/register | POST /api/auth/register | 注册 |
| GET /api/auth/me | GET /api/auth/me | 获取当前用户 |
| PUT /api/auth/password | PUT /api/auth/password | 修改密码 |
| PUT /api/auth/profile | PUT /api/auth/profile | 更新资料 |

### 会话 (Groups)

| HappyClaw API | Claw API | 说明 |
|--------------|----------|------|
| GET /api/groups | GET /api/sessions | 获取会话列表 |
| POST /api/groups | POST /api/sessions | 创建会话 |
| DELETE /api/groups/:id | DELETE /api/sessions/:id | 删除会话 |
| GET /api/groups/:id/messages | GET /api/sessions/:id/messages | 获取消息 |
| POST /api/messages | POST /api/sessions/:id/messages | 发送消息 |

### MCP 服务器

| HappyClaw API | Claw API | 说明 |
|--------------|----------|------|
| GET /api/mcp-servers | GET /api/mcp | 获取 MCP 服务器列表 |
| POST /api/mcp-servers | POST /api/mcp | 添加 MCP 服务器 |
| DELETE /api/mcp-servers/:id | DELETE /api/mcp/:id | 删除 MCP 服务器 |

## 数据结构映射

### 用户 (User)

```typescript
// HappyClaw 格式
interface UserPublic {
  id: string;
  username: string;
  display_name: string;
  role: 'admin' | 'member';
  status: 'active' | 'disabled';
  permissions: Permission[];
  created_at: string;
  last_login_at: string | null;
  avatar_emoji: string | null;
  avatar_color: string | null;
}

// Claw 格式 (自动转换)
interface ClawUser {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'member';
  status: 'active' | 'disabled';
  permissions: string[];
  createdAt: string;
  lastLoginAt: string | null;
  avatarEmoji: string | null;
  avatarColor: string | null;
}
```

### 会话 (Group/Session)

```typescript
// HappyClaw 格式
interface GroupInfo {
  id: string;
  name: string;
  folder: string;
  created_at: string;
  updated_at: string;
}

// Claw 格式 (自动转换)
interface ClawSession {
  id: string;
  name: string;
  userId: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}
```

### 消息 (Message)

```typescript
// HappyClaw 格式
interface Message {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: boolean;
  turn_id?: string | null;
  session_id?: string | null;
}

// Claw 格式 (自动转换)
interface ClawMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  turnId?: string;
}
```

## 开发

### 本地开发

```bash
cd claw/web-adapter
npm install
npm run build
```

### 测试

```bash
# 启动 Claw 后端
cd claw
npm run dev

# 在 HappyClaw web 项目中使用适配器
# 确保 VITE_CLAW_API_URL 指向 Claw 后端
```

## 注意事项

1. **认证方式**: Claw 使用 JWT Token 认证，适配器会自动处理 token 的存储和发送
2. **WebSocket**: 当前版本使用轮询获取消息，后续可添加 WebSocket 支持
3. **文件上传**: 当前版本暂未实现文件上传功能
4. **流式响应**: 适配器支持流式事件处理，需要后端配合实现

## 待实现功能

- [ ] WebSocket 实时消息推送
- [ ] 文件上传/下载
- [ ] 图片消息支持
- [ ] 消息搜索
- [ ] 会话归档
