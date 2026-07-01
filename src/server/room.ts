import { WebSocket } from 'ws';
import type { ClientMessage, ServerMessage, PlayerId, TowerType } from '../shared/types';
import { createInitialState, stepGame, explodeSplash } from '../shared/gameLogic';
import {
  BOARD_WIDTH, BOARD_HEIGHT, TICK_INTERVAL_MS, TOWER_CONFIGS, SELL_REFUND_RATIO,
  LEVEL_MULTS, UPGRADE_COST_RATIO, MAX_TOWER_LEVEL, LOADOUT_SIZE, DISCONNECT_GRACE_MS,
} from '../shared/config';
import { decideBotAction, BOT_DECISION_TICKS } from './ai';

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
  private bot: { pid: PlayerId; loadout: TowerType[] } | null = null;
  private botTick = 0;

  constructor(code: string, onDispose: () => void) {
    this.code = code;
    this.onDispose = onDispose;
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
  addBot(loadout: TowerType[]): void {
    const id: PlayerId = this.players.length === 0 ? 'p1' : 'p2';
    const sane = sanitizeLoadout(loadout);
    this.players.push({ ws: null, id, loadout: sane, connected: true, isAi: true });
    this.bot = { pid: id, loadout: sane };
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

    if (msg.type === 'PLACE_TOWER') this.placeTower(player.id, msg.towerType, msg.x, msg.y);
    else if (msg.type === 'SELL_TOWER') this.sellTower(player.id, msg.towerId);
    else if (msg.type === 'UPGRADE_TOWER') this.upgradeTower(player.id, msg.towerId);
    else if (msg.type === 'BOMB') this.bomb(player.id, msg.x, msg.y);
  }

  private placeTower(pid: PlayerId, type: TowerType, x: number, y: number): void {
    const s = this.state;
    const conn = this.players.find(p => p.id === pid);
    if (!conn || !conn.loadout.includes(type)) return; // only towers in this player's loadout
    const cfg = TOWER_CONFIGS[type];
    if (cfg.active) return; // active abilities (炸彈) aren't placed as towers
    if (x < 0 || x >= BOARD_WIDTH || y < 0 || y >= BOARD_HEIGHT) return;
    if (s.board[y][x] !== pid) return;
    if (s.towers.some(t => t.x === x && t.y === y)) return;
    if (s.players[pid].money < cfg.cost) return;

    s.players[pid].money -= cfg.cost;
    // Timed helper towers (召喚塔/附魔塔) wait a full interval before their first
    // trigger instead of firing instantly on placement.
    const initialCooldown = cfg.summonInterval ?? cfg.enchantInterval ?? 0;
    s.towers.push({
      id: `${pid}_${x}_${y}_${s.tick}`,
      owner: pid, type, x, y,
      hp: cfg.maxHp, maxHp: cfg.maxHp,
      cooldown: initialCooldown, active: true, level: 1,
      aim: -Math.PI / 2, // start pointing up; offensive towers snap to target on first tick
      slow: 0,
    });

    // 旗幟塔: one-time burst that paints a radius around the placement.
    if (cfg.banner) {
      const rad = cfg.bannerRadius ?? 2;
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (Math.hypot(dx, dy) > rad) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= BOARD_WIDTH || ny < 0 || ny >= BOARD_HEIGHT) continue;
          if (s.towers.some(t => t.x === nx && t.y === ny && t.owner !== pid)) continue; // enemy towers shield their cell
          s.board[ny][nx] = pid;
        }
      }
    }
  }

  private bomb(pid: PlayerId, x: number, y: number): void {
    const s = this.state;
    const conn = this.players.find(p => p.id === pid);
    if (!conn || !conn.loadout.includes('bomb')) return;
    if (x < 0 || x >= BOARD_WIDTH || y < 0 || y >= BOARD_HEIGHT) return;
    const cfg = TOWER_CONFIGS.bomb;
    if (s.players[pid].money < cfg.cost) return;
    s.players[pid].money -= cfg.cost;
    explodeSplash(s, x, y, pid, cfg.towerDamage, cfg.splashRadius);
  }

  private upgradeTower(pid: PlayerId, towerId: string): void {
    const tower = this.state.towers.find(t => t.id === towerId && t.owner === pid);
    if (!tower || tower.level >= MAX_TOWER_LEVEL) return;
    if (TOWER_CONFIGS[tower.type].noUpgrade) return; // 附魔塔 can't be upgraded
    const cfg = TOWER_CONFIGS[tower.type];
    const cost = Math.floor(cfg.cost * UPGRADE_COST_RATIO);
    if (this.state.players[pid].money < cost) return;
    this.state.players[pid].money -= cost;
    tower.level++;
    const m = LEVEL_MULTS[tower.level - 1];
    tower.maxHp = Math.round(cfg.maxHp * m.hp);
    tower.hp = tower.maxHp;
  }

  private sellTower(pid: PlayerId, towerId: string): void {
    const idx = this.state.towers.findIndex(t => t.id === towerId && t.owner === pid);
    if (idx === -1) return;
    const tower = this.state.towers[idx];
    this.state.players[pid].money += Math.floor(TOWER_CONFIGS[tower.type].cost * SELL_REFUND_RATIO);
    this.state.towers.splice(idx, 1);
  }

  private startGame(): void {
    this.state = createInitialState();
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
    if (++this.botTick % BOT_DECISION_TICKS !== 0) return;
    const action = decideBotAction(this.state, this.bot.pid, this.bot.loadout);
    if (!action) return;
    if (action.kind === 'place') this.placeTower(this.bot.pid, action.type, action.x, action.y);
    else this.upgradeTower(this.bot.pid, action.towerId);
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
