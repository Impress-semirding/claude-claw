# Playwright E2E MySQL MCP Web 测试报告

生成时间: 2026-04-06T13:35:13.639Z
测试地址: http://localhost:5173
API 地址: http://localhost:3000

## 问题摘要

- 🔴 Critical: 0
- 🟠 Error: 0
- 🟡 Warning: 0

**无问题**

## 详细问题列表


## 浏览器关键日志

```
[debug] [vite] connecting...
[debug] [vite] connected.
[info] %cDownload the React DevTools for a better development experience: https://react.dev/link/react-devtools font-weight:bold
[debug] [vite] connecting...
[debug] [vite] connected.
[info] %cDownload the React DevTools for a better development experience: https://react.dev/link/react-devtools font-weight:bold
[log] [HOOK WS] type=stream_event chatJid=6685800d-23c5-4100-a5ea-48de2924106f {"type":"stream_event","chatJid":"6685800d-23c5-4100-a5ea-48de2924106f","event":{"eventType":"text_delta","text":"我来帮你查询 MySQL 数据库中的所有表。","turnId":"turn-1775482463790"}}
[log] [HOOK WS] type=stream_event chatJid=6685800d-23c5-4100-a5ea-48de2924106f {"type":"stream_event","chatJid":"6685800d-23c5-4100-a5ea-48de2924106f","event":{"eventType":"tool_use_start","toolName":"Bash","toolUseId":"tool_FQuitgxPZUzWImQpxw2mKjtP","isNested":false,"toolInputSummary":"command: curl -s -N -X POST http://114.55.0.167:3007/mcp \\\n  -H \"Content-Type: application/json\" \\\n  -H \"Accept: application/json, text/event-stream\" \\\n  -H \"Authorization: Bearer skdeuoeiw...","turnId":"turn-1775482463790"}}
[log] [HOOK WS] type=stream_event chatJid=6685800d-23c5-4100-a5ea-48de2924106f {"type":"stream_event","chatJid":"6685800d-23c5-4100-a5ea-48de2924106f","event":{"eventType":"tool_use_end","toolUseId":"tool_FQuitgxPZUzWImQpxw2mKjtP","turnId":"turn-1775482463790"}}
```