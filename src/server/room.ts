import { WebSocket } from 'ws';
import type { ClientMessage, ServerMessage, PlayerId, TowerType, Difficulty } from '../shared/types';
import { createInitialState, stepGame } from '../shared/gameLogic';
import { TICK_INTERVAL_MS, TOWER_CONFIGS, LOADOUT_SIZE, DISCONNECT_GRACE_MS } from '../shared/config';
import { placeTower, bomb, upgradeTower, sellTower, detonateSacrifice } from '../shared/actions';
import { decideBotAction, BOT_DIFFICULTY } from './ai';

interface PlayerConn {
  ws: WebSocket | null; // null while the slot is disconnected but within grace
  id: PlayerId;
  loadout: TowerType[];
  connected: boolean;
  isAi?: boolean; // slot driven by the built-in bot (single-player)
}

function sanitizeLoadout(raw: TowerType[] | undefined): TowerType[] {
  const valid = (raw ?? []).filter((t): t is TowerType => t in TOWER_CONFIGS);
  const uniq = [...new Set(valid)];
  if (uniq.length === 0) return Object.keys(TOWER_CONFIGS) as TowerType[]; // fallback: allow all
  return uniq.slice(0, LOADOUT_SIZE);
}

export class Room {
  readonly code: string;
  private readonly mapId: string | undefined;
  private players: PlayerConn[] = [];
  private state = createInitialState();
  private timer: ReturnType<typeof setInterval> | null = null;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  // While a player is inside the grace window the match is frozen: no ticks,
  // no input, so neither side gains ground during the outage.
  private paused = false;
  private disposed = false;
  private readonly onDispose: () => void;
  // Single-player: the bot-controlled slot (if any) and its decision counter.
  private bot: { pid: PlayerId; loadout: TowerType[]; difficulty: Difficulty; decisionTicks: number } | null = null;
  private botTick = 0;

  constructor(code: string, onDispose: () => void, mapId?: string) {
    this.code = code;
    this.onDispose = onDispose;
    this.mapId = mapId;
  }

  get isFull() { return this.players.length >= 2; }
  get isEmpty() { return this.players.length === 0; }

  addPlayer(ws: WebSocket, loadout: TowerType[]): PlayerId {
    const id: PlayerId = this.players.length === 0 ? 'p1' : 'p2';
    this.players.push({ ws, id, loadout: sanitizeLoadout(loadout), connected: true });

    if (this.players.length === 2) this.startGame();

    return id;
  }

  // Add a bot as the second player and kick the match off immediately.
  addBot(loadout: TowerType[], difficulty: Difficulty = 'normal'): void {
    const id: PlayerId = this.players.length === 0 ? 'p1' : 'p2';
    const sane = sanitizeLoadout(loadout);
    this.players.push({ ws: null, id, loadout: sane, connected: true, isAi: true });
    this.bot = { pid: id, loadout: sane, difficulty, decisionTicks: BOT_DIFFICULTY[difficulty].decisionTicks };
    if (this.players.length === 2) this.startGame();
  }

  // Re-bind a dropped player's slot to a fresh socket during the grace window.
  // Returns false if there is no matching disconnected slot (grace expired,
  // wrong id, or that player is already connected).
  rejoin(ws: WebSocket, id: PlayerId): boolean {
    const slot = this.players.find(p => p.id === id && !p.connected);
    if (!slot) return false;

    slot.ws = ws;
    slot.connected = true;

    if (this.graceTimer) { clearTimeout(this.graceTimer); this.graceTimer = null; }
    this.paused = false;

    // Resync the returning player from scratch, then tell the opponent.
    this.send(ws, { type: 'GAME_START', state: this.state, playerId: id });
    this.broadcastExcept(ws, { type: 'OPPONENT_RECONNECTED' });
    return true;
  }

  // A socket closed. Detach it from its slot and react based on phase.
  detach(ws: WebSocket): void {
    const slot = this.players.find(p => p.ws === ws);
    if (!slot) return;
    slot.ws = null;
    slot.connected = false;

    if (this.state.phase === 'ended') {
      if (this.players.every(p => !p.connected)) this.dispose();
      return;
    }

    if (this.state.phase !== 'playing') {
      // Still in the lobby/waiting stage: the slot just goes away.
      this.players = this.players.filter(p => p !== slot);
      if (this.players.every(p => !p.connected)) this.dispose();
      return;
    }

    // Mid-match drop: if nobody is left, tear down immediately; otherwise
    // freeze the game and give the dropped player a window to come back.
    if (this.players.every(p => !p.connected)) { this.dispose(); return; }

    this.paused = true;
    this.broadcast({ type: 'OPPONENT_DISCONNECTED', graceMs: DISCONNECT_GRACE_MS });
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = setTimeout(() => this.forfeit(slot.id), DISCONNECT_GRACE_MS);
  }

  handleMessage(ws: WebSocket, msg: ClientMessage): void {
    if (this.paused) return; // ignore input while frozen for a reconnect
    const player = this.players.find(p => p.ws === ws && p.connected);
    if (!player || this.state.phase !== 'playing') return;

    if (msg.type === 'PLACE_TOWER') placeTower(this.state, player.loadout, player.id, msg.towerType, msg.x, msg.y);
    else if (msg.type === 'SELL_TOWER') sellTower(this.state, player.id, msg.towerId);
    else if (msg.type === 'UPGRADE_TOWER') upgradeTower(this.state, player.id, msg.towerId);
    else if (msg.type === 'BOMB') bomb(this.state, player.loadout, player.id, msg.x, msg.y);
    else if (msg.type === 'DETONATE') detonateSacrifice(this.state, player.id, msg.towerId, msg.x, msg.y);
  }

  private startGame(): void {
    this.state = createInitialState(this.mapId);
    this.state.phase = 'playing';

    for (const p of this.players) {
      this.send(p.ws, { type: 'GAME_START', state: this.state, playerId: p.id });
    }

    this.timer = setInterval(() => this.tick(), TICK_INTERVAL_MS);
  }

  private tick(): void {
    if (this.state.phase !== 'playing') { this.stop(); return; }
    if (this.paused) return; // frozen during a reconnect grace window

    stepGame(this.state);

    if (this.bot) this.stepBot();

    this.broadcast({ type: 'STATE', state: this.state });

    if ((this.state.phase as string) === 'ended') {
      this.broadcast({ type: 'GAME_OVER', winner: this.state.winner!, finalState: this.state });
      this.dispose();
    }
  }

  // Drive the bot slot: once per decision interval, apply one proposed action
  // through the same validated paths a human's messages would take.
  private stepBot(): void {
    if (!this.bot) return;
    if (++this.botTick % this.bot.decisionTicks !== 0) return;
    const { pid, loadout, difficulty } = this.bot;
    const action = decideBotAction(this.state, pid, loadout, difficulty);
    if (!action) return;
    if (action.kind === 'place') placeTower(this.state, loadout, pid, action.type, action.x, action.y);
    else if (action.kind === 'upgrade') upgradeTower(this.state, pid, action.towerId);
    else if (action.kind === 'bomb') bomb(this.state, loadout, pid, action.x, action.y);
    else if (action.kind === 'detonate') detonateSacrifice(this.state, pid, action.towerId, action.x, action.y);
  }

  // Award the match to `winner` because their opponent failed to reconnect.
  private forfeit(loserId: PlayerId): void {
    if (this.disposed || this.state.phase === 'ended') return;
    const winner: PlayerId = loserId === 'p1' ? 'p2' : 'p1';
    this.state.phase = 'ended';
    this.state.winner = winner;
    this.broadcast({ type: 'GAME_OVER', winner, finalState: this.state, reason: 'forfeit' });
    this.dispose();
  }

  private stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    if (this.graceTimer) { clearTimeout(this.graceTimer); this.graceTimer = null; }
    this.onDispose();
  }

  private broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const p of this.players) {
      if (p.ws && p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
    }
  }

  private broadcastExcept(exclude: WebSocket, msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const p of this.players) {
      if (p.ws && p.ws !== exclude && p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
    }
  }

  private send(ws: WebSocket | null, msg: ServerMessage): void {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }
}
