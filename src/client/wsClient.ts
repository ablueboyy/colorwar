import type { ClientMessage, ServerMessage } from '../shared/types';

type MessageHandler = (msg: ServerMessage) => void;
export type ConnStatus = 'connecting' | 'open' | 'closed';
type StatusHandler = (status: ConnStatus) => void;

export class WsClient {
  private ws: WebSocket | null = null;
  private handlers: MessageHandler[] = [];
  private statusHandlers: StatusHandler[] = [];
  private queue: ClientMessage[] = [];
  private reconnectDelay = 1000;
  private closedByUs = false;

  connect(): void {
    this.setStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.reconnectDelay = 1000;
      this.setStatus('open');
      for (const msg of this.queue) this._send(msg);
      this.queue = [];
    });

    ws.addEventListener('message', (e) => {
      let msg: ServerMessage;
      try { msg = JSON.parse(e.data); } catch { return; }
      for (const h of this.handlers) h(msg);
    });

    ws.addEventListener('close', () => {
      this.setStatus('closed');
      if (this.closedByUs) return;
      // Auto-reconnect with backoff — recovers from a failed initial connect
      // (e.g. Render free tier still waking up) without the user noticing.
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 8000);
    });

    ws.addEventListener('error', () => {
      ws.close(); // triggers the 'close' handler → reconnect
    });
  }

  on(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  onStatus(handler: StatusHandler): void {
    this.statusHandlers.push(handler);
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this._send(msg);
    } else {
      this.queue.push(msg);
    }
  }

  private setStatus(status: ConnStatus): void {
    for (const h of this.statusHandlers) h(status);
  }

  private _send(msg: ClientMessage): void {
    this.ws!.send(JSON.stringify(msg));
  }
}
