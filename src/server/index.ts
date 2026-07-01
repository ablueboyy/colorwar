import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, normalize, extname, sep } from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { Room } from './room';
import type { ClientMessage, ServerMessage } from '../shared/types';

const PORT = Number(process.env.PORT ?? 3001);
const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
};

const CLIENT_ROOT = join(process.cwd(), 'dist', 'client');

const httpServer = createServer(async (req, res) => {
  // Take only the path (drop the query string / fragment), then normalize and
  // confine it to the client root so "../" escapes can't reach other files.
  const rawPath = new URL(req.url ?? '/', 'http://localhost').pathname;
  const rel = normalize(decodeURIComponent(rawPath)).replace(/^([/\\])+/, '');
  const filePath = join(CLIENT_ROOT, rel === '' || rel === '.' ? 'index.html' : rel);
  if (filePath !== CLIENT_ROOT && !filePath.startsWith(CLIENT_ROOT + sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'text/plain' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
const rooms = new Map<string, Room>();

function genCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? genCode() : code;
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// Heartbeat: drop sockets that stop answering pings so half-open connections
// don't linger (and their Room gets torn down via the normal close path).
type LiveSocket = WebSocket & { isAlive?: boolean };

wss.on('connection', (ws: LiveSocket) => {
  let room: Room | null = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'CREATE_ROOM') {
      if (room) return;
      const code = genCode();
      const created = new Room(code, () => rooms.delete(code));
      rooms.set(code, created);
      room = created;
      const pid = room.addPlayer(ws, msg.loadout);
      send(ws, { type: 'ROOM_CREATED', code, playerId: pid });
      send(ws, { type: 'WAITING_FOR_OPPONENT' });
    } else if (msg.type === 'JOIN_ROOM') {
      if (room) return;
      const target = rooms.get(msg.code.toUpperCase());
      if (!target) { send(ws, { type: 'ERROR', message: 'Room not found' }); return; }
      if (target.isFull) { send(ws, { type: 'ERROR', message: 'Room is full' }); return; }
      room = target;
      const pid = room.addPlayer(ws, msg.loadout);
      send(ws, { type: 'ROOM_JOINED', code: msg.code, playerId: pid });
    } else if (msg.type === 'REJOIN_ROOM') {
      if (room) return;
      const target = rooms.get(msg.code.toUpperCase());
      if (!target || !target.rejoin(ws, msg.playerId)) {
        send(ws, { type: 'ERROR', message: '重新連線失敗，對局已結束' });
        return;
      }
      room = target; // rejoin() already resynced this socket
    } else if (room) {
      room.handleMessage(ws, msg);
    }
  });

  ws.on('close', () => {
    if (room) {
      room.detach(ws); // Room handles grace/forfeit and its own cleanup
      room = null;
    }
  });
});

const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    const live = client as LiveSocket;
    if (live.isAlive === false) { live.terminate(); continue; }
    live.isAlive = false;
    live.ping();
  }
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

httpServer.listen(PORT, () => {
  console.log(`ColorWar server on http://localhost:${PORT}`);
  console.log(`WebSocket on ws://localhost:${PORT}/ws`);
});
