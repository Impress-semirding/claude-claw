# Playwright E2E Streaming Persistence 测试报告

生成时间: 2026-04-07T16:11:35.791Z
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
[log] [HOOK WS] type=new_message chatJid=131088f8-1383-488a-9d70-b4f6eeeb5842 {"type":"new_message","chatJid":"131088f8-1383-488a-9d70-b4f6eeeb5842","message":{"id":"cb0f997f-e578-4cf1-84d4-35693c33bc07","chat_jid":"131088f8-1383-488a-9d70-b4f6eeeb5842","sender":"8d48ec6e-810f-4c97-b179-c41bd0836db2","sender_name":"admin@example.com","content":"Say hello. streaming-persistence-test-1775578285384","timestamp":"2026-04-07T16:11:25.416Z","is_from_me":false,"source_kind":"user_
[log] [HOOK WS] type=runner_state chatJid=131088f8-1383-488a-9d70-b4f6eeeb5842 {"type":"runner_state","chatJid":"131088f8-1383-488a-9d70-b4f6eeeb5842","state":"running"}
[log] [HOOK WS] type=typing chatJid=131088f8-1383-488a-9d70-b4f6eeeb5842 {"type":"typing","chatJid":"131088f8-1383-488a-9d70-b4f6eeeb5842","isTyping":true}
[debug] [vite] connecting...
[debug] [vite] connected.
[info] %cDownload the React DevTools for a better development experience: https://react.dev/link/react-devtools font-weight:bold
[log] [HOOK WS] type=stream_event chatJid=131088f8-1383-488a-9d70-b4f6eeeb5842 {"type":"stream_event","chatJid":"131088f8-1383-488a-9d70-b4f6eeeb5842","event":{"eventType":"text_delta","text":"Hello! 👋\n\nstreaming-persistence-test-1775578285384","turnId":"turn-1775578285419"}}
[log] [HOOK WS] type=typing chatJid=131088f8-1383-488a-9d70-b4f6eeeb5842 {"type":"typing","chatJid":"131088f8-1383-488a-9d70-b4f6eeeb5842","isTyping":false}
[log] [HOOK WS] type=stream_event chatJid=131088f8-1383-488a-9d70-b4f6eeeb5842 {"type":"stream_event","chatJid":"131088f8-1383-488a-9d70-b4f6eeeb5842","event":{"eventType":"complete","turnId":"turn-1775578285419"}}
[log] [HOOK WS] type=new_message chatJid=131088f8-1383-488a-9d70-b4f6eeeb5842 {"type":"new_message","chatJid":"131088f8-1383-488a-9d70-b4f6eeeb5842","message":{"id":"0b8abdd2-4ba9-4aef-b268-530d55299361","chat_jid":"131088f8-1383-488a-9d70-b4f6eeeb5842","sender":"__assistant__","sender_name":"Claude","content":"Hello! 👋\n\nstreaming-persistence-test-1775578285384","timestamp":"2026-04-07T16:11:35.574Z","is_from_me":true,"turn_id":"turn-1775578285419","session_id":"683bdf11
[log] [HOOK WS] type=runner_state chatJid=131088f8-1383-488a-9d70-b4f6eeeb5842 {"type":"runner_state","chatJid":"131088f8-1383-488a-9d70-b4f6eeeb5842","state":"idle"}
[log] [HOOK WS] type=typing chatJid=131088f8-1383-488a-9d70-b4f6eeeb5842 {"type":"typing","chatJid":"131088f8-1383-488a-9d70-b4f6eeeb5842","isTyping":false}
```