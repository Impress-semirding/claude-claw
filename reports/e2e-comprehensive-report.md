# Playwright E2E 综合测试报告

生成时间: 2026-04-08T14:08:09.754Z
测试地址: http://localhost:5173
API 地址: http://localhost:3000

## 问题摘要

- 🔴 Critical: 0
- 🟠 Error: 0
- 🟡 Warning: 0

**无问题**

## 截图列表


## WS 消息统计

- connected: 15
- new_message: 3
- runner_state: 4
- typing: 12
- group_created: 1
- stream_event: 14

## 浏览器关键日志

```
[warning] The width(-1) and height(-1) of chart should be greater than 0,
       please check the style of container, or the props width(100%) and height(100%),
       or add a minWidth(0) or minHeight(undefined) or use aspect(undefined) to control the
       height and width.
[warning] The width(-1) and height(-1) of chart should be greater than 0,
       please check the style of container, or the props width(100%) and height(100%),
       or add a minWidth(0) or minHeight(undefined) or use aspect(undefined) to control the
       height and width.
[warning] The width(-1) and height(-1) of chart should be greater than 0,
       please check the style of container, or the props width(100%) and height(100%),
       or add a minWidth(0) or minHeight(undefined) or use aspect(undefined) to control the
       height and width.
[warning] The width(-1) and height(-1) of chart should be greater than 0,
       please check the style of container, or the props width(100%) and height(100%),
       or add a minWidth(0) or minHeight(undefined) or use aspect(undefined) to control the
       height and width.
[log] [HOOK WS] type=new_message chatJid=6685800d-23c5-4100-a5ea-48de2924106f {"type":"new_message","chatJid":"6685800d-23c5-4100-a5ea-48de2924106f","message":{"id":"f0478d42-8465-498e-9b6e-4a15bcbd0809","chat_jid":"6685800d-23c5-4100-a5ea-48de2924106f","sender":"8d48ec6e-810f-4c97-b179-c41bd0836db2","sen
[log] [HOOK WS] type=runner_state chatJid=6685800d-23c5-4100-a5ea-48de2924106f {"type":"runner_state","chatJid":"6685800d-23c5-4100-a5ea-48de2924106f","state":"running"}
[log] [HOOK WS] type=typing chatJid=6685800d-23c5-4100-a5ea-48de2924106f {"type":"typing","chatJid":"6685800d-23c5-4100-a5ea-48de2924106f","isTyping":true}
[log] [HOOK WS] type=new_message chatJid=4cdc37fa-e486-47e7-8a57-12cd37b4dd29 {"type":"new_message","chatJid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","message":{"id":"ad7696b7-2158-406c-acfe-b447cf48e470","chat_jid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","sender":"8d48ec6e-810f-4c97-b179-c41bd0836db2","sen
[log] [HOOK WS] type=runner_state chatJid=4cdc37fa-e486-47e7-8a57-12cd37b4dd29 {"type":"runner_state","chatJid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","state":"running"}
[log] [HOOK WS] type=typing chatJid=4cdc37fa-e486-47e7-8a57-12cd37b4dd29 {"type":"typing","chatJid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","isTyping":true}
[log] [HOOK WS] type=stream_event chatJid=6685800d-23c5-4100-a5ea-48de2924106f {"type":"stream_event","chatJid":"6685800d-23c5-4100-a5ea-48de2924106f","event":{"eventType":"error","error":"Claude Code process exited with code 1","turnId":"turn-1775657272032"}}
[log] [HOOK WS] type=runner_state chatJid=6685800d-23c5-4100-a5ea-48de2924106f {"type":"runner_state","chatJid":"6685800d-23c5-4100-a5ea-48de2924106f","state":"idle"}
[log] [HOOK WS] type=typing chatJid=6685800d-23c5-4100-a5ea-48de2924106f {"type":"typing","chatJid":"6685800d-23c5-4100-a5ea-48de2924106f","isTyping":false}
[log] [HOOK WS] type=stream_event chatJid=4cdc37fa-e486-47e7-8a57-12cd37b4dd29 {"type":"stream_event","chatJid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","event":{"eventType":"text_delta","text":"I'll search for this message ID in the E2E test reports and API audit logs to find","turnId":"turn-1775657275722"
[log] [HOOK WS] type=typing chatJid=4cdc37fa-e486-47e7-8a57-12cd37b4dd29 {"type":"typing","chatJid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","isTyping":false}
[log] [HOOK WS] type=stream_event chatJid=4cdc37fa-e486-47e7-8a57-12cd37b4dd29 {"type":"stream_event","chatJid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","event":{"eventType":"text_delta","text":" the relevant context.","turnId":"turn-1775657275722"}}
[log] [HOOK WS] type=typing chatJid=4cdc37fa-e486-47e7-8a57-12cd37b4dd29 {"type":"typing","chatJid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","isTyping":false}
[log] [HOOK WS] type=stream_event chatJid=4cdc37fa-e486-47e7-8a57-12cd37b4dd29 {"type":"stream_event","chatJid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","event":{"eventType":"text_delta","text":"I'll search for this message ID in the E2E test reports and API audit logs to find the relevant context.","turnId
[log] [HOOK WS] type=typing chatJid=4cdc37fa-e486-47e7-8a57-12cd37b4dd29 {"type":"typing","chatJid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","isTyping":false}
[log] [HOOK WS] type=stream_event chatJid=4cdc37fa-e486-47e7-8a57-12cd37b4dd29 {"type":"stream_event","chatJid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","event":{"eventType":"tool_use_start","toolName":"Grep","toolUseId":"tool_j9yRm6OnfM6xJ5bgdGIuEHje","isNested":false,"turnId":"turn-1775657275722"}}
[log] [HOOK WS] type=stream_event chatJid=4cdc37fa-e486-47e7-8a57-12cd37b4dd29 {"type":"stream_event","chatJid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","event":{"eventType":"tool_progress","toolName":"Grep","toolUseId":"tool_j9yRm6OnfM6xJ5bgdGIuEHje","isNested":false,"toolInputSummary":"path: /Users/dingxu
[log] [HOOK WS] type=stream_event chatJid=4cdc37fa-e486-47e7-8a57-12cd37b4dd29 {"type":"stream_event","chatJid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","event":{"eventType":"tool_use_start","toolName":"Grep","toolUseId":"tool_j9yRm6OnfM6xJ5bgdGIuEHje","isNested":false,"toolInputSummary":"path: /Users/dingx
[log] [HOOK WS] type=stream_event chatJid=4cdc37fa-e486-47e7-8a57-12cd37b4dd29 {"type":"stream_event","chatJid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","event":{"eventType":"tool_use_end","toolUseId":"tool_j9yRm6OnfM6xJ5bgdGIuEHje","turnId":"turn-1775657275722"}}
[log] [HOOK WS] type=stream_event chatJid=4cdc37fa-e486-47e7-8a57-12cd37b4dd29 {"type":"stream_event","chatJid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","event":{"eventType":"text_delta","text":"The","turnId":"turn-1775657275722"}}
[log] [HOOK WS] type=typing chatJid=4cdc37fa-e486-47e7-8a57-12cd37b4dd29 {"type":"typing","chatJid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","isTyping":false}
[log] [HOOK WS] type=stream_event chatJid=4cdc37fa-e486-47e7-8a57-12cd37b4dd29 {"type":"stream_event","chatJid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","event":{"eventType":"text_delta","text":" message ID `1775657275720` wasn't found in the repository files. Could you clarify what you're looking for? For 
[log] [HOOK WS] type=typing chatJid=4cdc37fa-e486-47e7-8a57-12cd37b4dd29 {"type":"typing","chatJid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","isTyping":false}
[log] [HOOK WS] type=stream_event chatJid=4cdc37fa-e486-47e7-8a57-12cd37b4dd29 {"type":"stream_event","chatJid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","event":{"eventType":"text_delta","text":" message ID from a specific E2E test failure?\n- Are you trying","turnId":"turn-1775657275722"}}
[log] [HOOK WS] type=typing chatJid=4cdc37fa-e486-47e7-8a57-12cd37b4dd29 {"type":"typing","chatJid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","isTyping":false}
[log] [HOOK WS] type=stream_event chatJid=4cdc37fa-e486-47e7-8a57-12cd37b4dd29 {"type":"stream_event","chatJid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","event":{"eventType":"text_delta","text":" to trace a message through the API audit logs?\n- Should I check a different directory or log file?","turnId":"t
[log] [HOOK WS] type=typing chatJid=4cdc37fa-e486-47e7-8a57-12cd37b4dd29 {"type":"typing","chatJid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","isTyping":false}
[log] [HOOK WS] type=stream_event chatJid=4cdc37fa-e486-47e7-8a57-12cd37b4dd29 {"type":"stream_event","chatJid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","event":{"eventType":"text_delta","text":"The message ID `1775657275720` wasn't found in the repository files. Could you clarify what you're looking for? F
[log] [HOOK WS] type=typing chatJid=4cdc37fa-e486-47e7-8a57-12cd37b4dd29 {"type":"typing","chatJid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","isTyping":false}
[log] [HOOK WS] type=stream_event chatJid=4cdc37fa-e486-47e7-8a57-12cd37b4dd29 {"type":"stream_event","chatJid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","event":{"eventType":"complete","turnId":"turn-1775657275722"}}
[log] [HOOK WS] type=new_message chatJid=4cdc37fa-e486-47e7-8a57-12cd37b4dd29 {"type":"new_message","chatJid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","message":{"id":"d1e6cc09-c25d-4f44-8071-fdda1ced7066","chat_jid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","sender":"__assistant__","sender_name":"Claude","con
[log] [HOOK WS] type=runner_state chatJid=4cdc37fa-e486-47e7-8a57-12cd37b4dd29 {"type":"runner_state","chatJid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","state":"idle"}
[log] [HOOK WS] type=typing chatJid=4cdc37fa-e486-47e7-8a57-12cd37b4dd29 {"type":"typing","chatJid":"4cdc37fa-e486-47e7-8a57-12cd37b4dd29","isTyping":false}
```

---
