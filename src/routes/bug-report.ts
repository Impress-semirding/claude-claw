import { Hono } from 'hono';
import { authMiddleware } from './auth.js';

const bugReport = new Hono();

// GET /api/bug-report/capabilities - 获取 Bug Report 能力
bugReport.get('/capabilities', authMiddleware, async (c) => {
  try {
    return c.json({
      canGenerate: true,
      canSubmit: false,
      providers: [],
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to get capabilities' }, 500);
  }
});

// POST /api/bug-report/generate - 生成 Bug Report
bugReport.post('/generate', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const prompt = body.prompt || 'No prompt provided';
    return c.json({
      success: true,
      title: 'Bug Report',
      body: prompt,
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to generate bug report' }, 500);
  }
});

// POST /api/bug-report/submit - 提交 Bug Report
bugReport.post('/submit', authMiddleware, async (c) => {
  try {
    await c.req.json();
    return c.json({
      success: false,
      message: 'Bug report submission is not supported in this version',
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to submit bug report' }, 500);
  }
});

export default bugReport;
