# Claw + HappyClaw 调试指南

## 服务状态

当前运行的服务：

| 服务 | 地址 | 状态 |
|------|------|------|
| Claw 后端 | http://localhost:3000 | ✅ 运行中 |
| HappyClaw 前端 | http://localhost:5173 | ✅ 运行中 |

## 快速测试

### 1. 测试 Claw 后端 API

```bash
# Health Check
curl http://localhost:3000/health

# Auth Status (兼容 HappyClaw)
curl http://localhost:3000/api/auth/status

# 登录 (使用默认管理员账户)
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin123"}'
```

### 2. 测试 HappyClaw 前端

打开浏览器访问：http://localhost:5173

## 默认账户

- **邮箱**: admin@example.com
- **密码**: admin123

## API 端点

### 认证
- `POST /api/auth/register` - 注册
- `POST /api/auth/login` - 登录
- `GET /api/auth/status` - 系统状态 (兼容 HappyClaw)
- `POST /api/auth/verify` - 验证 Token

### Claude 会话
- `GET /api/sessions` - 列出会话
- `POST /api/sessions` - 创建会话
- `DELETE /api/sessions/:id` - 删除会话
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

## 调试技巧

### 查看后端日志
```bash
# 实时查看 Claw 日志
cd /Users/dingxue/Documents/claude/claw && npm start
```

### 查看前端日志
浏览器开发者工具 (F12) → Console

### 测试 API 连接
```bash
./scripts/test-api.sh
```

### 重启服务

**重启后端：**
```bash
pkill -f "node dist/index.js"
cd /Users/dingxue/Documents/claude/claw && npm start
```

**重启前端：**
```bash
pkill -f "vite"
cd /Users/dingxue/Documents/claude/happyclaw/web && npm run dev
```

## 常见问题

### 1. 前端无法连接后端
- 检查 `.env.local` 中的 `VITE_API_BASE_URL` 配置
- 确认后端服务在端口 3000 运行
- 检查浏览器网络请求 (F12 → Network)

### 2. CORS 错误
后端已配置 CORS 允许所有来源，如果仍有问题，检查：
- 后端是否正确重启
- 请求 URL 是否正确

### 3. 登录失败
- 确认使用正确的邮箱和密码
- 检查后端日志中的错误信息
- 确认数据库已初始化

## 环境变量

### 后端 (.env)
```
PORT=3000
DATABASE_URL=./data/claw.db
JWT_SECRET=your-secret-key
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=admin123
```

### 前端 (.env.local)
```
VITE_API_BASE_URL=http://localhost:3000
```

## 下一步

1. 在浏览器中打开 http://localhost:5173
2. 使用默认账户登录
3. 创建 Claude 会话并开始聊天
4. 配置 MCP 服务器

## 需要帮助？

查看项目文档：
- [README.md](./README.md) - 项目介绍
- [WEB_ADAPTER_INTEGRATION.md](./WEB_ADAPTER_INTEGRATION.md) - 前端集成指南
- [PROJECT_SUMMARY.md](./PROJECT_SUMMARY.md) - 项目总结
