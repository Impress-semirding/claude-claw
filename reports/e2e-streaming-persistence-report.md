# Playwright E2E Streaming Persistence 测试报告

生成时间: 2026-04-08T14:08:35.903Z
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
[log] [HOOK WS] type=new_message chatJid=3486d297-701d-4630-823e-644d557e9ec7 {"type":"new_message","chatJid":"3486d297-701d-4630-823e-644d557e9ec7","message":{"id":"19d7a948-8ada-447c-8048-6d8ed90e75d2","chat_jid":"3486d297-701d-4630-823e-644d557e9ec7","sender":"8d48ec6e-810f-4c97-b179-c41bd0836db2","sender_name":"admin@example.com","content":"Say hello. streaming-persistence-test-1775657306624","timestamp":"2026-04-08T14:08:26.650Z","is_from_me":false,"source_kind":"user_
[log] [HOOK WS] type=runner_state chatJid=3486d297-701d-4630-823e-644d557e9ec7 {"type":"runner_state","chatJid":"3486d297-701d-4630-823e-644d557e9ec7","state":"running"}
[log] [HOOK WS] type=typing chatJid=3486d297-701d-4630-823e-644d557e9ec7 {"type":"typing","chatJid":"3486d297-701d-4630-823e-644d557e9ec7","isTyping":true}
[debug] [vite] connecting...
[debug] [vite] connected.
[info] %cDownload the React DevTools for a better development experience: https://react.dev/link/react-devtools font-weight:bold
[log] [HOOK WS] type=stream_event chatJid=3486d297-701d-4630-823e-644d557e9ec7 {"type":"stream_event","chatJid":"3486d297-701d-4630-823e-644d557e9ec7","event":{"eventType":"text_delta","text":"Hello. I see you've included \"streaming-persistence-test-1775657306624\" in","turnId":"turn-1775657306651"}}
[log] [HOOK WS] type=typing chatJid=3486d297-701d-4630-823e-644d557e9ec7 {"type":"typing","chatJid":"3486d297-701d-4630-823e-644d557e9ec7","isTyping":false}
[log] [HOOK WS] type=stream_event chatJid=3486d297-701d-4630-823e-644d557e9ec7 {"type":"stream_event","chatJid":"3486d297-701d-4630-823e-644d557e9ec7","event":{"eventType":"text_delta","text":"Hello. I see you've included \"streaming-persistence-test-1775657306624\" in your message. How can I help you today?","turnId":"turn-1775657306651"}}
[log] [HOOK WS] type=typing chatJid=3486d297-701d-4630-823e-644d557e9ec7 {"type":"typing","chatJid":"3486d297-701d-4630-823e-644d557e9ec7","isTyping":false}
[log] [HOOK WS] type=stream_event chatJid=3486d297-701d-4630-823e-644d557e9ec7 {"type":"stream_event","chatJid":"3486d297-701d-4630-823e-644d557e9ec7","event":{"eventType":"text_delta","text":" your message. How can I help you today?","turnId":"turn-1775657306651"}}
[log] [HOOK WS] type=typing chatJid=3486d297-701d-4630-823e-644d557e9ec7 {"type":"typing","chatJid":"3486d297-701d-4630-823e-644d557e9ec7","isTyping":false}
[log] [HOOK WS] type=stream_event chatJid=3486d297-701d-4630-823e-644d557e9ec7 {"type":"stream_event","chatJid":"3486d297-701d-4630-823e-644d557e9ec7","event":{"eventType":"complete","turnId":"turn-1775657306651"}}
[log] [HOOK WS] type=new_message chatJid=3486d297-701d-4630-823e-644d557e9ec7 {"type":"new_message","chatJid":"3486d297-701d-4630-823e-644d557e9ec7","message":{"id":"4b325009-4cc2-4f1c-8b1b-a983ef9aaf89","chat_jid":"3486d297-701d-4630-823e-644d557e9ec7","sender":"__assistant__","sender_name":"Claude","content":"Hello. I see you've included \"streaming-persistence-test-1775657306624\" in your message. How can I help you today?Hello. I see you've included \"streaming-persiste
[log] [HOOK WS] type=runner_state chatJid=3486d297-701d-4630-823e-644d557e9ec7 {"type":"runner_state","chatJid":"3486d297-701d-4630-823e-644d557e9ec7","state":"idle"}
[log] [HOOK WS] type=typing chatJid=3486d297-701d-4630-823e-644d557e9ec7 {"type":"typing","chatJid":"3486d297-701d-4630-823e-644d557e9ec7","isTyping":false}
```