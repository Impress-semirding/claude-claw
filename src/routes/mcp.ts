import { Hono } from 'hono';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { mcpServerDb } from '../db.js';
// IAuthToken type is used in context.get('user')

const mcp = new Hono();

// Create MCP server schema
const createSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
});

// List MCP servers
mcp.get('/', async (c) => {
  try {
    const servers = mcpServerDb.findAll();
    return c.json({
      success: true,
      data: servers,
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list MCP servers',
      },
      500
    );
  }
});

// Get MCP server
mcp.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const server = mcpServerDb.findById(id);

    if (!server) {
      return c.json({ success: false, error: 'MCP server not found' }, 404);
    }

    return c.json({
      success: true,
      data: server,
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get MCP server',
      },
      500
    );
  }
});

// Create MCP server
mcp.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const data = createSchema.parse(body);

    const server = mcpServerDb.create({
      id: uuidv4(),
      name: data.name,
      command: data.command,
      args: data.args,
      env: data.env,
      enabled: true,
    });

    return c.json(
      {
        success: true,
        data: server,
      },
      201
    );
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create MCP server',
      },
      400
    );
  }
});

// Update MCP server
mcp.put('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();

    const existing = mcpServerDb.findById(id);
    if (!existing) {
      return c.json({ success: false, error: 'MCP server not found' }, 404);
    }

    mcpServerDb.update(id, body);

    return c.json({
      success: true,
      message: 'MCP server updated',
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update MCP server',
      },
      500
    );
  }
});

// Delete MCP server
mcp.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id');

    const existing = mcpServerDb.findById(id);
    if (!existing) {
      return c.json({ success: false, error: 'MCP server not found' }, 404);
    }

    mcpServerDb.delete(id);

    return c.json({
      success: true,
      message: 'MCP server deleted',
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete MCP server',
      },
      500
    );
  }
});

// Toggle MCP server enabled state
mcp.post('/:id/toggle', async (c) => {
  try {
    const id = c.req.param('id');

    const existing = mcpServerDb.findById(id);
    if (!existing) {
      return c.json({ success: false, error: 'MCP server not found' }, 404);
    }

    mcpServerDb.update(id, { enabled: !existing.enabled });

    return c.json({
      success: true,
      data: { enabled: !existing.enabled },
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to toggle MCP server',
      },
      500
    );
  }
});

export default mcp;
