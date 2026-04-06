# Playwright E2E 全量测试报告

生成时间: 2026-04-06T04:06:14.412Z
测试地址: http://localhost:5173
API 地址: http://localhost:3000

## 问题摘要

- 🔴 Critical: 0
- 🟠 Error: 0
- 🟡 Warning: 0

**无问题**

## 截图列表


## WS 消息统计

- connected: 12
- stream_event: 5
- typing: 5
- new_message: 3
- runner_state: 2

## 浏览器关键日志

```
[log] [HOOK WS] type=stream_event chatJid=aef3e096-89d8-4edb-9620-59b763e1209f {"type":"stream_event","chatJid":"aef3e096-89d8-4edb-9620-59b763e1209f","event":{"eventType":"text_delta","text":"I see you've entered \"E2E Test Memory\" with a message ID. This appears to be a test message for end-to-end test
[log] [HOOK WS] type=typing chatJid=aef3e096-89d8-4edb-9620-59b763e1209f {"type":"typing","chatJid":"aef3e096-89d8-4edb-9620-59b763e1209f","isTyping":false}
[log] [HOOK WS] type=new_message chatJid=6685800d-23c5-4100-a5ea-48de2924106f {"type":"new_message","chatJid":"6685800d-23c5-4100-a5ea-48de2924106f","message":{"id":"8beb12cc-7486-47d0-9931-787b3e3bc8f3","chat_jid":"6685800d-23c5-4100-a5ea-48de2924106f","sender":"8d48ec6e-810f-4c97-b179-c41bd0836db2","sen
[log] [HOOK WS] type=stream_event chatJid=aef3e096-89d8-4edb-9620-59b763e1209f {"type":"stream_event","chatJid":"aef3e096-89d8-4edb-9620-59b763e1209f","event":{"eventType":"complete","turnId":"turn-1775448343918"}}
[log] [HOOK WS] type=new_message chatJid=aef3e096-89d8-4edb-9620-59b763e1209f {"type":"new_message","chatJid":"aef3e096-89d8-4edb-9620-59b763e1209f","message":{"id":"fb05a9f9-45fc-4916-9f42-e5413d44d99b","chat_jid":"aef3e096-89d8-4edb-9620-59b763e1209f","sender":"__assistant__","sender_name":"Claude","con
[log] [HOOK WS] type=runner_state chatJid=aef3e096-89d8-4edb-9620-59b763e1209f {"type":"runner_state","chatJid":"aef3e096-89d8-4edb-9620-59b763e1209f","state":"idle"}
[log] [HOOK WS] type=typing chatJid=aef3e096-89d8-4edb-9620-59b763e1209f {"type":"typing","chatJid":"aef3e096-89d8-4edb-9620-59b763e1209f","isTyping":false}
[log] [HOOK WS] type=stream_event chatJid=6685800d-23c5-4100-a5ea-48de2924106f {"type":"stream_event","chatJid":"6685800d-23c5-4100-a5ea-48de2924106f","event":{"eventType":"text_delta","text":"I see the E2E test report was updated. I can see from line 48 that there's a related turn ID: `turn-1775448176793
[log] [HOOK WS] type=typing chatJid=6685800d-23c5-4100-a5ea-48de2924106f {"type":"typing","chatJid":"6685800d-23c5-4100-a5ea-48de2924106f","isTyping":false}
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
[log] [HOOK WS] type=stream_event chatJid=6685800d-23c5-4100-a5ea-48de2924106f {"type":"stream_event","chatJid":"6685800d-23c5-4100-a5ea-48de2924106f","event":{"eventType":"text_delta","text":"Not in files yet. Updated tracking:\n\n| E2E Turn ID | Timestamp (UTC) | Time Delta | Status |\n|-------------|--
[log] [HOOK WS] type=typing chatJid=6685800d-23c5-4100-a5ea-48de2924106f {"type":"typing","chatJid":"6685800d-23c5-4100-a5ea-48de2924106f","isTyping":false}
[log] [HOOK WS] type=stream_event chatJid=6685800d-23c5-4100-a5ea-48de2924106f {"type":"stream_event","chatJid":"6685800d-23c5-4100-a5ea-48de2924106f","event":{"eventType":"complete","turnId":"turn-1775448340235"}}
[log] [HOOK WS] type=new_message chatJid=6685800d-23c5-4100-a5ea-48de2924106f {"type":"new_message","chatJid":"6685800d-23c5-4100-a5ea-48de2924106f","message":{"id":"f1046f3e-ccb1-4c3d-90fd-1e22467363c8","chat_jid":"6685800d-23c5-4100-a5ea-48de2924106f","sender":"__assistant__","sender_name":"Claude","con
[log] [HOOK WS] type=runner_state chatJid=6685800d-23c5-4100-a5ea-48de2924106f {"type":"runner_state","chatJid":"6685800d-23c5-4100-a5ea-48de2924106f","state":"idle"}
[log] [HOOK WS] type=typing chatJid=6685800d-23c5-4100-a5ea-48de2924106f {"type":"typing","chatJid":"6685800d-23c5-4100-a5ea-48de2924106f","isTyping":false}
```

---
