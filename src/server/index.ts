import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, extname } from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { Room } from './room';
import type { ClientMessage, ServerMessage } from '../shared/types';

const PORT = Number(process.env.PORT ?? 3001);
const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
};

const httpServer = createServer(async (req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url ?? '/index.html';
  const safe = url.replace(/\.\./g, '').replace(/^\/+/, '');
  const filePath = join(process.cwd(), 'dist', 'client', safe);
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

wss.on('connection', (ws) => {
  let room: Room | null = null;

  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'CREATE_ROOM') {
      if (room) return;
      const code = genCode();
      room = new Room(code);
      rooms.set(code, room);
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
    } else if (room) {
      room.handleMessage(ws, msg);
    }
  });

  ws.on('close', () => {
    if (room) {
      room.removePlayer(ws);
      if (room.isEmpty) rooms.delete(room.code);
      room = null;
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`ColorWar server on http://localhost:${PORT}`);
  console.log(`WebSocket on ws://localhost:${PORT}/ws`);
});
