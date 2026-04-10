# New Features E2E 测试报告

生成时间: 2026-04-10T14:01:08.479Z
API 地址: http://localhost:3000

## 问题摘要

- 🔴 Critical: 0
- 🟠 Error: 0
- 🟡 Warning: 2

**核心项全部通过**

## 详细问题

- **WARNING**: Abort returned success=false — {"success":false,"message":"No running query found"}
- **WARNING**: MCP tool test: agent did not produce expected reply — This may be normal if model chose not to use tool or quota exceeded

## 运行日志

```
[login] OK userId=8d48ec6e-810f-4c97-b179-c41bd0836db2

=== Task Scheduler Tests ===
[group] created b8161737-8249-4a08-a17f-0d11acf35f69
[task] script task created OK
[task] agent+isolated task created OK
[task] agent+group task created OK
[task] manual run triggered OK
[task] logs count=2
[task] list tasks OK
[task] pause/resume OK
[task] cleanup done

=== Agent Pool Interrupt Tests ===
[interrupt] message sent messageId=d3a40b25-3665-4a6f-bbd6-6236a2bf91dc
[interrupt] no session_id from messages, creating session explicitly
[interrupt] sessionId=b3012150-e13f-4d82-aea7-3743e0bb9aa1
[interrupt] server healthy after abort

=== MCP Tools Tests ===
[mcp] created task d0573e4c-4b00-4df2-ad42-05d84107715c
[mcp] waiting for agent reply...
[mcp] skill search endpoint OK

=== Provider Pool Tests ===
[provider] created p1=26335540-654f-486d-9999-dcfdef7bcbde
[provider] created p2=e6ed1198-51cc-4336-876e-b9d7d786b5d8
[provider] list + health OK
[provider] toggle OK
[provider] reset health OK
[provider] health endpoint OK
[provider] balancing config OK
[provider] cleanup done
```