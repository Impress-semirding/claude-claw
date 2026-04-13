# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chat-workflow-observation.spec.ts >> 观察链路：登录 -> 创建工作区 -> 发消息 -> 收集浏览器日志与 WS
- Location: tests/e2e/chat-workflow-observation.spec.ts:118:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.waitForTimeout: Test timeout of 30000ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - region "Notifications alt+T"
  - generic [ref=e3]:
    - generic [ref=e5]:
      - navigation [ref=e6]:
        - img "HappyClaw" [ref=e8]
        - button "工作台" [ref=e9]:
          - img [ref=e10]
          - generic [ref=e12]: 工作台
        - link "Skill" [ref=e13] [cursor=pointer]:
          - /url: /skills
          - img [ref=e14]
          - generic [ref=e16]: Skill
        - link "任务" [ref=e17] [cursor=pointer]:
          - /url: /tasks
          - img [ref=e18]
          - generic [ref=e21]: 任务
        - link "设置" [ref=e22] [cursor=pointer]:
          - /url: /settings
          - img [ref=e23]
          - generic [ref=e26]: 设置
        - button [ref=e27]:
          - img [ref=e28]
        - button "A" [ref=e37] [cursor=pointer]:
          - generic [ref=e39]: A
      - generic [ref=e41]:
        - generic [ref=e42]:
          - img "HappyClaw" [ref=e43]
          - button [ref=e44] [cursor=pointer]:
            - img [ref=e45]
        - button "新工作区" [ref=e49]:
          - img
          - text: 新工作区
        - generic [ref=e51]:
          - generic [ref=e52]: 我的工作区
          - generic [ref=e53]:
            - generic [ref=e54]: 更早
            - generic [ref=e55]:
              - button "claw_test" [ref=e56] [cursor=pointer]:
                - generic [ref=e58]: claw_test
              - button [ref=e60] [cursor=pointer]:
                - img [ref=e61]
            - generic [ref=e65]:
              - button "E2E 测试工作区" [ref=e66] [cursor=pointer]:
                - generic [ref=e68]: E2E 测试工作区
              - button [ref=e70] [cursor=pointer]:
                - img [ref=e71]
            - generic [ref=e75]:
              - button "E2E 测试工作区" [ref=e76] [cursor=pointer]:
                - generic [ref=e78]: E2E 测试工作区
              - button [ref=e80] [cursor=pointer]:
                - img [ref=e81]
            - generic [ref=e85]:
              - button "E2E 测试工作区" [ref=e86] [cursor=pointer]:
                - generic [ref=e88]: E2E 测试工作区
              - button [ref=e90] [cursor=pointer]:
                - img [ref=e91]
            - generic [ref=e95]:
              - button "E2E 测试工作区" [ref=e96] [cursor=pointer]:
                - generic [ref=e98]: E2E 测试工作区
              - button [ref=e100] [cursor=pointer]:
                - img [ref=e101]
            - generic [ref=e105]:
              - button "E2E 测试工作区" [ref=e106] [cursor=pointer]:
                - generic [ref=e108]: E2E 测试工作区
              - button [ref=e110] [cursor=pointer]:
                - img [ref=e111]
            - generic [ref=e115]:
              - button "E2E 测试工作区" [ref=e116] [cursor=pointer]:
                - generic [ref=e118]: E2E 测试工作区
              - button [ref=e120] [cursor=pointer]:
                - img [ref=e121]
            - generic [ref=e125]:
              - button "E2E 测试工作区" [ref=e126] [cursor=pointer]:
                - generic [ref=e128]: E2E 测试工作区
              - button [ref=e130] [cursor=pointer]:
                - img [ref=e131]
            - generic [ref=e135]:
              - button "E2E 测试工作区" [ref=e136] [cursor=pointer]:
                - generic [ref=e138]: E2E 测试工作区
              - button [ref=e140] [cursor=pointer]:
                - img [ref=e141]
            - generic [ref=e145]:
              - button "观测-1775347214823" [ref=e146] [cursor=pointer]:
                - generic [ref=e148]: 观测-1775347214823
              - button [ref=e150] [cursor=pointer]:
                - img [ref=e151]
    - main [ref=e156]:
      - generic [ref=e159]:
        - generic [ref=e160]:
          - generic [ref=e161]:
            - heading "观测-1775347214823" [level=2] [ref=e162]
            - generic [ref=e163]:
              - generic [ref=e164]: Agent
              - generic [ref=e165]: ·
              - generic [ref=e166]: 宿主机
          - button "切换到亮色模式" [ref=e167] [cursor=pointer]:
            - img [ref=e168]
          - button "切换到紧凑模式" [ref=e174] [cursor=pointer]:
            - img [ref=e175]
          - button "展开面板" [ref=e177] [cursor=pointer]:
            - img [ref=e178]
        - generic [ref=e181]:
          - generic [ref=e182] [cursor=pointer]:
            - generic [ref=e183]: 主对话
            - button "绑定 IM 群组" [ref=e184]:
              - img [ref=e185]
          - button "新建对话" [ref=e188] [cursor=pointer]:
            - img [ref=e189]
        - generic [ref=e190]:
          - generic [ref=e191]:
            - generic [ref=e195]:
              - generic [ref=e198]: 2026年4月5日
              - generic [ref=e201]:
                - generic [ref=e202]:
                  - paragraph [ref=e204]: 你好，请简短自我介绍
                  - button "消息菜单" [ref=e205] [cursor=pointer]:
                    - img [ref=e206]
                - generic [ref=e210]: 2026-04-05 08:00:15
              - generic [ref=e213]:
                - generic [ref=e216]: 🤖
                - generic [ref=e217]:
                  - generic [ref=e218]:
                    - generic [ref=e219]: Claude
                    - generic [ref=e220]: 2026-04-05 08:00:30
                  - generic [ref=e223]:
                    - paragraph [ref=e224]: 你好！我是 Claude，一个由 Anthropic 开发的 AI 助手。我可以帮助你完成各种任务，包括：
                    - list [ref=e225]:
                      - listitem [ref=e226]: 编写和修改代码
                      - listitem [ref=e227]: 分析文件和数据
                      - listitem [ref=e228]: 运行命令和工具
                      - listitem [ref=e229]: 回答问题并提供建议
                    - paragraph [ref=e230]: 有什么我可以帮你的吗？
                  - generic [ref=e231]:
                    - button "复制消息" [ref=e232] [cursor=pointer]:
                      - img [ref=e233]
                    - button "生成分享图片" [ref=e236] [cursor=pointer]:
                      - img [ref=e237]
                    - button "消息菜单" [ref=e242] [cursor=pointer]:
                      - img [ref=e243]
            - generic [ref=e249]:
              - textbox "输入消息..." [active] [ref=e251]
              - generic [ref=e252]:
                - generic [ref=e253]:
                  - button "添加文件" [ref=e254] [cursor=pointer]:
                    - img [ref=e255]
                  - button "清除上下文" [ref=e257] [cursor=pointer]:
                    - img [ref=e258]
                - button [disabled] [ref=e261] [cursor=pointer]:
                  - img [ref=e262]
          - generic:
            - generic:
              - button [ref=e264] [cursor=pointer]:
                - img [ref=e265]
              - button [ref=e267] [cursor=pointer]:
                - img [ref=e268]
              - button [ref=e273] [cursor=pointer]:
                - img [ref=e274]
              - button [ref=e276] [cursor=pointer]:
                - img [ref=e277]
            - generic [ref=e280]:
              - generic [ref=e281]:
                - heading "工作区文件管理" [level=3] [ref=e282]
                - generic [ref=e283]:
                  - button "打开工作区文件夹" [ref=e284] [cursor=pointer]:
                    - img [ref=e285]
                  - button "刷新文件列表" [ref=e287] [cursor=pointer]:
                    - img [ref=e288]
              - button "根目录" [ref=e294] [cursor=pointer]
              - paragraph [ref=e296]: 暂无文件
              - generic [ref=e297]:
                - button "新建文件夹" [ref=e298]:
                  - img
                  - text: 新建文件夹
                - generic [ref=e299]:
                  - generic:
                    - paragraph [ref=e300]: 拖拽文件到这里，或
                    - generic [ref=e301]:
                      - button "上传文件" [ref=e302] [cursor=pointer]:
                        - img [ref=e303]
                        - text: 上传文件
                      - button "上传文件夹" [ref=e306] [cursor=pointer]:
                        - img [ref=e307]
                        - text: 上传文件夹
```

# Test source

```ts
  60  |   });
  61  | }
  62  | 
  63  | async function collectWsMessages(page: Page) {
  64  |   const msgs = await page.evaluate(() => (window as any)._interceptedWs || []);
  65  |   for (const m of msgs) {
  66  |     try {
  67  |       wsMessages.push({
  68  |         direction: m.direction,
  69  |         data: typeof m.data === 'string' ? JSON.parse(m.data) : m.data,
  70  |         timestamp: m.timestamp,
  71  |       });
  72  |     } catch {
  73  |       wsMessages.push({
  74  |         direction: m.direction,
  75  |         data: m.data,
  76  |         timestamp: m.timestamp,
  77  |       });
  78  |     }
  79  |   }
  80  | }
  81  | 
  82  | async function login(page: Page) {
  83  |   await page.goto('/login');
  84  |   await expect(page.locator('h1')).toContainText('欢迎使用 HappyClaw');
  85  |   await page.locator('#username').fill('admin@example.com');
  86  |   await page.locator('#password').fill('admin123');
  87  |   await page.getByRole('button', { name: /登录/ }).click();
  88  |   await page.waitForURL(/\/chat/);
  89  | }
  90  | 
  91  | async function createWorkspace(page: Page, name: string) {
  92  |   const newWorkspaceBtn = page.getByRole('button', { name: '新工作区' });
  93  |   await expect(newWorkspaceBtn).toBeVisible();
  94  |   await newWorkspaceBtn.click();
  95  | 
  96  |   const dialog = page.locator('role=dialog');
  97  |   await expect(dialog).toContainText('新建工作区');
  98  |   await dialog.locator('input[placeholder="输入工作区名称"]').fill(name);
  99  | 
  100 |   // Switch to host mode
  101 |   await dialog.getByRole('button', { name: '高级选项' }).click();
  102 |   await dialog.locator('input[type="radio"][value="host"]').check();
  103 | 
  104 |   await dialog.getByRole('button', { name: '创建' }).click();
  105 |   await dialog.waitFor({ state: 'hidden' });
  106 | 
  107 |   await page.waitForURL(/\/chat\/.+/);
  108 |   await expect(page.locator('h2.truncate')).toContainText(name);
  109 | }
  110 | 
  111 | async function sendMessage(page: Page, text: string) {
  112 |   const textarea = page.locator('textarea[placeholder="输入消息..."]');
  113 |   await expect(textarea).toBeVisible();
  114 |   await textarea.fill(text);
  115 |   await textarea.press('Enter');
  116 | }
  117 | 
  118 | test('观察链路：登录 -> 创建工作区 -> 发消息 -> 收集浏览器日志与 WS', async ({ page }) => {
  119 |   // Setup log collection
  120 |   page.on('console', (msg) => {
  121 |     logs.push({
  122 |       type: msg.type(),
  123 |       text: msg.text(),
  124 |       timestamp: new Date().toISOString(),
  125 |     });
  126 |   });
  127 |   page.on('pageerror', (err) => {
  128 |     logs.push({
  129 |       type: 'pageerror',
  130 |       text: err.message,
  131 |       timestamp: new Date().toISOString(),
  132 |     });
  133 |   });
  134 | 
  135 |   await injectWsInterceptor(page);
  136 | 
  137 |   // 1. Login
  138 |   await login(page);
  139 |   await collectWsMessages(page);
  140 | 
  141 |   // 2. Create workspace
  142 |   const workspaceName = `观测-${Date.now()}`;
  143 |   await createWorkspace(page, workspaceName);
  144 |   await collectWsMessages(page);
  145 | 
  146 |   // 3. Send message
  147 |   const userMessage = '你好，请简短自我介绍';
  148 |   await sendMessage(page, userMessage);
  149 |   await collectWsMessages(page);
  150 | 
  151 |   // 4. Wait for streaming indicators or reply (up to 90s for real LLM)
  152 |   const thinking = page.getByText('正在思考...').first();
  153 |   try {
  154 |     await expect(thinking).toBeVisible({ timeout: 15000 });
  155 |   } catch {
  156 |     console.log('No "正在思考..." observed within 15s');
  157 |   }
  158 | 
  159 |   // Wait for reply to appear or timeout
> 160 |   await page.waitForTimeout(30000);
      |              ^ Error: page.waitForTimeout: Test timeout of 30000ms exceeded.
  161 |   await collectWsMessages(page);
  162 | 
  163 |   // Take screenshots
  164 |   await page.screenshot({ path: resolve(RESULTS_DIR, 'observation-chat-page.png'), fullPage: true });
  165 | 
  166 |   // 5. Save logs
  167 |   saveLogs('kimi-real');
  168 | 
  169 |   // Also write a summary text for quick reading
  170 |   const summaryLines: string[] = [
  171 |     '=== Browser Console Logs ===',
  172 |     ...logs.map((l) => `[${l.type}] ${l.text}`),
  173 |     '',
  174 |     '=== WS Messages ===',
  175 |     ...wsMessages.map((m) => `[WS ${m.direction}] ${JSON.stringify(m.data)}`),
  176 |   ];
  177 |   writeFileSync(resolve(RESULTS_DIR, 'observation-summary.txt'), summaryLines.join('\n'), 'utf-8');
  178 | });
  179 | 
```