import type { ClientMessage, ServerMessage } from '../shared/types';

type MessageHandler = (msg: ServerMessage) => void;

export class WsClient {
  private ws: WebSocket | null = null;
  private handlers: MessageHandler[] = [];
  private queue: ClientMessage[] = [];

  connect(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws`;
    this.ws = new WebSocket(url);

    this.ws.addEventListener('open', () => {
      for (const msg of this.queue) this._send(msg);
      this.queue = [];
    });

    this.ws.addEventListener('message', (e) => {
      let msg: ServerMessage;
      try { msg = JSON.parse(e.data); } catch { return; }
      for (const h of this.handlers) h(msg);
    });

    this.ws.addEventListener('close', () => {
      console.warn('WebSocket closed');
    });
  }

  on(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this._send(msg);
    } else {
      this.queue.push(msg);
    }
  }

  private _send(msg: ClientMessage): void {
    this.ws!.send(JSON.stringify(msg));
  }
}
