import { Hono } from 'hono';
import { authMiddleware } from './auth.js';

const docker = new Hono();

// POST /api/docker/build - 构建 Docker 镜像
docker.post('/build', authMiddleware, async (c) => {
  try {
    return c.json({ success: true, message: 'Docker build not supported in this version' }, 202);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to build Docker image' }, 500);
  }
});

// GET /api/docker/images - 获取 Docker 镜像列表
docker.get('/images', authMiddleware, async (c) => {
  try {
    return c.json({ images: [] });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load images' }, 500);
  }
});

export default docker;
