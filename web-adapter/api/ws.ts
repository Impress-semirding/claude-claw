import type { StreamEvent } from '../types.js';

export type WsListener = (data: any) => void;

class WsClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectInterval = 3000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Map<string, Set<WsListener>>();
  private pendingMessages: any[] = [];
  private isConnected = false;

  constructor(url: string) {
    this.url = url;
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }
    try {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => {
        this.isConnected = true;
        // Flush pending messages
        for (const msg of this.pendingMessages) {
          this.send(msg);
        }
        this.pendingMessages = [];
        this.emit('open', {});
      };
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.emit(data.type, data);
          this.emit('*', data);
        } catch {
          // ignore malformed messages
        }
      };
      this.ws.onclose = () => {
        this.isConnected = false;
        this.emit('close', {});
        this.scheduleReconnect();
      };
      this.ws.onerror = (err) => {
        this.emit('error', err);
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectInterval);
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.isConnected = false;
  }

  send(msg: any) {
    if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.pendingMessages.push(msg);
    }
  }

  on(type: string, listener: WsListener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
    return () => this.off(type, listener);
  }

  off(type: string, listener: WsListener) {
    this.listeners.get(type)?.delete(listener);
  }

  private emit(type: string, data: any) {
    this.listeners.get(type)?.forEach((fn) => {
      try {
        fn(data);
      } catch {
        // ignore listener errors
      }
    });
  }
}

export const wsClient = new WsClient(
  // @ts-ignore
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_CLAW_WS_URL) ||
    (typeof window !== 'undefined'
      ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
      : 'ws://localhost:3000/ws')
);

export function initWebSocket() {
  wsClient.connect();
}

export function closeWebSocket() {
  wsClient.disconnect();
}

export function wsSendMessage(chatJid: string, content: string, attachments?: unknown[], agentId?: string) {
  wsClient.send({
    type: 'send_message',
    chatJid,
    content,
    attachments,
    ...(agentId ? { agentId } : {}),
  });
}

export function wsSendAgentMessage(chatJid: string, agentId: string, content: string, attachments?: unknown[]) {
  wsSendMessage(chatJid, content, attachments, agentId);
}

export function wsStopGroup(chatJid: string) {
  wsClient.send({
    type: 'terminal_stop',
    chatJid,
  });
}

export function onWsMessage(listener: WsListener) {
  return wsClient.on('*', listener);
}

export function onWsNewMessage(listener: (data: { chatJid: string; message: any }) => void) {
  return wsClient.on('new_message', (data) => listener(data as any));
}

export function onWsStreamEvent(listener: (data: { chatJid: string; event: StreamEvent }) => void) {
  return wsClient.on('stream_event', (data) => listener(data as any));
}

export function onWsRunnerState(listener: (data: { chatJid: string; state: 'idle' | 'running' }) => void) {
  return wsClient.on('runner_state', (data) => listener(data as any));
}

export function onWsTyping(listener: (data: { chatJid: string; isTyping: boolean }) => void) {
  return wsClient.on('typing', (data) => listener(data as any));
}

export function onWsAgentStatus(
  listener: (data: {
    chatJid: string;
    agentId: string;
    status: string;
    name: string;
    prompt: string;
  }) => void
) {
  return wsClient.on('agent_status', (data) => listener(data as any));
}

export function onWsGroupCreated(listener: (data: { chatJid: string; folder: string; name: string }) => void) {
  return wsClient.on('group_created', (data) => listener(data as any));
}

export function onWsOpen(listener: WsListener) {
  return wsClient.on('open', listener);
}

export function onWsClose(listener: WsListener) {
  return wsClient.on('close', listener);
}
