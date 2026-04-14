import { mkdirSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';
import { appConfig } from './config.js';
import { sessionDb, messageDb, userDb } from './db.js';

// Throttle: only run once per 55 minutes
let lastRunAt = 0;
const RUN_INTERVAL_MS = 55 * 60 * 1000;

// Only run between 2:00–3:00 AM local time (or always in dev when forced)
function isWithinDailyWindow(): boolean {
  const hour = new Date().getHours();
  return hour === 2;
}

/**
 * Build a HEARTBEAT.md for the given user from their recent conversation history.
 * Reads messages from the last 24h across all user sessions, formats a summary,
 * and writes it to data/groups/user-global/{userId}/HEARTBEAT.md.
 */
export async function generateHeartbeatForUser(userId: string): Promise<void> {
  const since = Date.now() - 24 * 60 * 60 * 1000;

  // Get all sessions for this user active in last 24h
  const allSessions = sessionDb.findByUser(userId);
  const recentSessions = allSessions.filter(
    (s) => (s.lastActiveAt as number) >= since && s.status !== 'destroyed'
  );

  if (recentSessions.length === 0) return;

  const sessionIds = recentSessions.map((s) => s.id as string);

  // Fetch messages from recent sessions (up to 200 total)
  const messages = messageDb.findByIds(sessionIds, 200);

  // Filter to last 24h only
  const recentMessages = messages.filter((m) => m.createdAt >= since);
  if (recentMessages.length === 0) return;

  // Group messages by sessionId, keep up to 5 exchanges per session
  const bySession = new Map<string, typeof recentMessages>();
  for (const msg of recentMessages) {
    if (!bySession.has(msg.sessionId)) bySession.set(msg.sessionId, []);
    bySession.get(msg.sessionId)!.push(msg);
  }

  const summaryParts: string[] = [];
  const dateStr = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  summaryParts.push(`# 近期工作摘要 — ${dateStr}`);
  summaryParts.push('');

  for (const [sessionId, msgs] of bySession) {
    // Find workspace name for context
    const session = recentSessions.find((s) => s.id === sessionId);
    const workspaceLabel = session?.workspace || sessionId;

    summaryParts.push(`## 工作区: ${workspaceLabel}`);
    summaryParts.push('');

    // Take up to 5 exchanges (10 messages) chronologically
    const limited = msgs.slice(0, 10);
    for (const msg of limited) {
      const role = msg.role === 'user' ? '用户' : 'Claude';
      const text = msg.content.length > 500
        ? msg.content.slice(0, 500) + '...'
        : msg.content;
      summaryParts.push(`**${role}**: ${text}`);
      summaryParts.push('');
    }
  }

  const fullSummary = summaryParts.join('\n');

  // Truncate to 4096 chars total
  const truncated = fullSummary.length > 4096
    ? fullSummary.slice(0, 4096) + '\n\n[...内容过长已截断]'
    : fullSummary;

  // Write to user global dir
  const userGlobalDir = resolve(appConfig.dataDir, 'groups', 'user-global', userId);
  mkdirSync(userGlobalDir, { recursive: true });

  const heartbeatPath = join(userGlobalDir, 'HEARTBEAT.md');
  writeFileSync(heartbeatPath, truncated, 'utf-8');
  console.log(`[daily-summary] wrote HEARTBEAT.md for user ${userId} (${truncated.length} chars)`);
}

/**
 * Run daily summary for all active users.
 * Throttled to run at most once per RUN_INTERVAL_MS.
 * In production, only runs during 2:00–3:00 AM window.
 */
export async function runDailySummaryIfNeeded(): Promise<void> {
  const now = Date.now();
  if (now - lastRunAt < RUN_INTERVAL_MS) return;
  if (!isWithinDailyWindow()) return;

  lastRunAt = now;
  console.log('[daily-summary] running daily heartbeat generation...');

  try {
    const activeUsers = userDb.findActive();
    for (const user of activeUsers) {
      try {
        await generateHeartbeatForUser(user.id);
      } catch (err) {
        console.error(`[daily-summary] failed for user ${user.id}:`, err);
      }
    }
    console.log(`[daily-summary] done, processed ${activeUsers.length} users`);
  } catch (err) {
    console.error('[daily-summary] error:', err);
  }
}
