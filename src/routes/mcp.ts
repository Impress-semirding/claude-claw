import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { mcpServerDb } from '../db.js';

// Create MCP server schema
const createSchema = z.object({
  name: z.string().min(1),
  command: z.string().default(''),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
  type: z.string().default('stdio'),
  url: z.string().optional(),
  headers: z.record(z.string()).optional(),
});

export default async function mcpRoutes(fastify: FastifyInstance) {
  // List MCP servers
  fastify.get('/', async (request, reply) => {
    try {
      const servers = mcpServerDb.findAll();
      return reply.send({
        success: true,
        data: servers,
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list MCP servers',
      });
    }
  });

  // Get MCP server
  fastify.get('/:id', async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      const server = mcpServerDb.findById(id);

      if (!server) {
        return reply.status(404).send({ success: false, error: 'MCP server not found' });
      }

      return reply.send({
        success: true,
        data: server,
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get MCP server',
      });
    }
  });

  // Create MCP server
  fastify.post('/', async (request, reply) => {
    try {
      const body = request.body as any;
      const data = createSchema.parse(body);

      const server = mcpServerDb.create({
        id: body.id || uuidv4(),
        name: data.name,
        command: data.command,
        args: data.args,
        env: data.env,
        type: data.type,
        url: data.url,
        headers: data.headers,
        enabled: true,
      });

      return reply.status(201).send({
        success: true,
        data: server,
      });
    } catch (error) {
      return reply.status(400).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create MCP server',
      });
    }
  });

  // Update MCP server
  fastify.put('/:id', async (request, reply) => {
    try {
      const id = (request.params as any).id as string;
      const body = request.body as any;

      const existing = mcpServerDb.findById(id);
      if (!existing) {
        return reply.status(404).send({ success: false, error: 'MCP server not found' });
      }

      mcpServerDb.update(id, body);

      return reply.send({
        success: true,
        message: 'MCP server updated',
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update MCP server',
      });
    }
  });

  // Delete MCP server
  fastify.delete('/:id', async (request, reply) => {
    try {
      const id = (request.params as any).id as string;

      const existing = mcpServerDb.findById(id);
      if (!existing) {
        return reply.status(404).send({ success: false, error: 'MCP server not found' });
      }

      mcpServerDb.delete(id);

      return reply.send({
        success: true,
        message: 'MCP server deleted',
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete MCP server',
      });
    }
  });

  // Toggle MCP server enabled state
  fastify.post('/:id/toggle', async (request, reply) => {
    try {
      const id = (request.params as any).id as string;

      const existing = mcpServerDb.findById(id);
      if (!existing) {
        return reply.status(404).send({ success: false, error: 'MCP server not found' });
      }

      mcpServerDb.update(id, { enabled: !existing.enabled });

      return reply.send({
        success: true,
        data: { enabled: !existing.enabled },
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to toggle MCP server',
      });
    }
  });
}
