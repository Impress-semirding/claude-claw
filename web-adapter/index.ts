/**
 * HappyClaw Web 前端适配器
 *
 * 这个适配器将 HappyClaw 的前端组件与 Claw 后端 API 对接
 *
 * 使用方法:
 * 1. 在 HappyClaw web 项目中安装此适配器
 * 2. 替换原有的 API 客户端和 stores
 * 3. 配置 VITE_CLAW_API_URL 环境变量指向 Claw 后端
 *
 * 示例:
 * ```typescript
 * // 替换原有的导入
 * import { api } from '@claw/web-adapter/api/client';
 * import { useAuthStore } from '@claw/web-adapter/stores/auth';
 * import { useChatStore } from '@claw/web-adapter/stores/chat';
 * ```
 */

// API 客户端
export { api, apiFetch } from './api/client.js';
export type { ApiError } from './api/client.js';

// WebSocket 客户端
export {
  wsClient,
  initWebSocket,
  closeWebSocket,
  wsSendMessage,
  wsStopGroup,
  onWsMessage,
  onWsNewMessage,
  onWsStreamEvent,
  onWsRunnerState,
  onWsTyping,
  onWsAgentStatus,
  onWsGroupCreated,
  onWsOpen,
  onWsClose,
} from './api/ws.js';
export type { WsListener } from './api/ws.js';

// Auth Store
export { useAuthStore } from './stores/auth.js';
export type { UserPublic, Permission, AppearanceConfig } from './stores/auth.js';

// Chat Store
export { useChatStore } from './stores/chat.js';
export type { Message, GroupInfo, AgentInfo, StreamingState } from './stores/chat.js';

// Groups Store
export { useGroupsStore } from './stores/groups.js';
export type { GroupInfo as GroupsStoreGroupInfo, GroupMember } from './stores/groups.js';

// MCP Servers Store
export { useMcpServersStore } from './stores/mcp-servers.js';
export type { McpServer } from './stores/mcp-servers.js';

// Files Store
export { useFilesStore } from './stores/files.js';
export type { FileEntry } from './stores/files.js';

// Skills Store
export { useSkillsStore } from './stores/skills.js';
export type { Skill, SyncStatus, SyncSettings } from './stores/skills.js';

// Tasks Store
export { useTasksStore } from './stores/tasks.js';
export type { Task, TaskLog } from './stores/tasks.js';

// Billing Store
export { useBillingStore } from './stores/billing.js';
export type {
  BillingStatus,
  Balance,
  AccessInfo,
  DailyUsage,
  BillingPlan,
  RedeemCode,
  Transaction,
  AdminDashboard,
  RevenueStats,
} from './stores/billing.js';

// Usage Store
export { useUsageStore } from './stores/usage.js';
export type { UsageDay, UsageSummary, UsageStats, ModelInfo } from './stores/usage.js';

// Users Store (Admin)
export { useUsersStore } from './stores/users.js';
export type { AdminUser, Invite, AuditLogEntry } from './stores/users.js';

// Workspace Config Store
export { useWorkspaceConfigStore } from './stores/workspace-config.js';
export type {
  AppearanceConfig as WorkspaceAppearanceConfig,
  SystemConfig,
  ClaudeConfig,
  ImBinding,
  WorkspaceMcpServer,
  WorkspaceSkill,
} from './stores/workspace-config.js';

// Agent Definitions Store
export { useAgentDefinitionsStore } from './stores/agent-definitions.js';
export type { AgentDefinition } from './stores/agent-definitions.js';

// Container Env Store
export { useContainerEnvStore } from './stores/container-env.js';

// Monitor Store
export { useMonitorStore } from './stores/monitor.js';
export type { SystemStatus, GroupStatus } from './stores/monitor.js';

// Types
export type * from './types.js';
