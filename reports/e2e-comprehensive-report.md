# Playwright E2E 综合测试报告

生成时间: 2026-04-07T13:52:10.180Z
测试地址: http://localhost:5173
API 地址: http://localhost:3000

## 问题摘要

- 🔴 Critical: 0
- 🟠 Error: 4
- 🟡 Warning: 0

## 详细问题列表

### Settings Groups — ERROR: Settings Groups page 404
- 详情: Page returned 404 on /settings?tab=groups
- 截图: `/tmp/claw-e2e-page-settings-groups-404.png`

### Settings Monitor — ERROR: Settings Monitor page 404
- 详情: Page returned 404 on /settings?tab=monitor
- 截图: `/tmp/claw-e2e-page-settings-monitor-404.png`

### api — ERROR: Group Files API failed
- 详情: GET /api/groups/4ddf86eb-b875-4584-92e1-ca5a1eb69761/files?path=/ => 400, body={"error":"Path traversal detected"}

### api — ERROR: Create Directory API failed
- 详情: POST /api/groups/4ddf86eb-b875-4584-92e1-ca5a1eb69761/files/directories => 400, body={"error":"Path traversal detected"}

## 截图列表

- page-settings-groups-404: `/tmp/claw-e2e-page-settings-groups-404.png`
- page-settings-monitor-404: `/tmp/claw-e2e-page-settings-monitor-404.png`

## WS 消息统计

- connected: 17
- new_message: 2
- runner_state: 2
- typing: 2
- group_created: 1

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
[log] [HOOK WS] type=new_message chatJid=6685800d-23c5-4100-a5ea-48de2924106f {"type":"new_message","chatJid":"6685800d-23c5-4100-a5ea-48de2924106f","message":{"id":"eaed5642-6372-46c7-9f40-df1167868650","chat_jid":"6685800d-23c5-4100-a5ea-48de2924106f","sender":"8d48ec6e-810f-4c97-b179-c41bd0836db2","sen
[log] [HOOK WS] type=runner_state chatJid=6685800d-23c5-4100-a5ea-48de2924106f {"type":"runner_state","chatJid":"6685800d-23c5-4100-a5ea-48de2924106f","state":"running"}
[log] [HOOK WS] type=typing chatJid=6685800d-23c5-4100-a5ea-48de2924106f {"type":"typing","chatJid":"6685800d-23c5-4100-a5ea-48de2924106f","isTyping":true}
[log] [HOOK WS] type=new_message chatJid=4ddf86eb-b875-4584-92e1-ca5a1eb69761 {"type":"new_message","chatJid":"4ddf86eb-b875-4584-92e1-ca5a1eb69761","message":{"id":"9025d543-9632-4a0e-a457-d891032c2129","chat_jid":"4ddf86eb-b875-4584-92e1-ca5a1eb69761","sender":"8d48ec6e-810f-4c97-b179-c41bd0836db2","sen
[log] [HOOK WS] type=runner_state chatJid=4ddf86eb-b875-4584-92e1-ca5a1eb69761 {"type":"runner_state","chatJid":"4ddf86eb-b875-4584-92e1-ca5a1eb69761","state":"running"}
[log] [HOOK WS] type=typing chatJid=4ddf86eb-b875-4584-92e1-ca5a1eb69761 {"type":"typing","chatJid":"4ddf86eb-b875-4584-92e1-ca5a1eb69761","isTyping":true}
```

---
