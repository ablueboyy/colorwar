import { WebSocket } from 'ws';
import type { ClientMessage, ServerMessage, PlayerId, TowerType } from '../shared/types';
import { createInitialState, stepGame } from '../shared/gameLogic';
import { BOARD_WIDTH, BOARD_HEIGHT, TICK_INTERVAL_MS, TOWER_CONFIGS, SELL_REFUND_RATIO, LEVEL_MULTS, UPGRADE_COST_RATIO, MAX_TOWER_LEVEL } from '../shared/config';

interface PlayerConn {
  ws: WebSocket;
  id: PlayerId;
}

export class Room {
  readonly code: string;
  private players: PlayerConn[] = [];
  private state = createInitialState();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(code: string) {
    this.code = code;
  }

  get isFull() { return this.players.length >= 2; }
  get isEmpty() { return this.players.length === 0; }

  addPlayer(ws: WebSocket): PlayerId {
    const id: PlayerId = this.players.length === 0 ? 'p1' : 'p2';
    this.players.push({ ws, id });

    if (this.players.length === 2) this.startGame();

    return id;
  }

  removePlayer(ws: WebSocket): void {
    this.players = this.players.filter(p => p.ws !== ws);
    this.stop();
  }

  handleMessage(ws: WebSocket, msg: ClientMessage): void {
    const player = this.players.find(p => p.ws === ws);
    if (!player || this.state.phase !== 'playing') return;

    if (msg.type === 'PLACE_TOWER') this.placeTower(player.id, msg.towerType, msg.x, msg.y);
    else if (msg.type === 'SELL_TOWER') this.sellTower(player.id, msg.towerId);
    else if (msg.type === 'UPGRADE_TOWER') this.upgradeTower(player.id, msg.towerId);
  }

  private placeTower(pid: PlayerId, type: TowerType, x: number, y: number): void {
    const s = this.state;
    if (x < 0 || x >= BOARD_WIDTH || y < 0 || y >= BOARD_HEIGHT) return;
    if (s.board[y][x] !== pid) return;
    if (s.towers.some(t => t.x === x && t.y === y)) return;
    const cfg = TOWER_CONFIGS[type];
    if (s.players[pid].money < cfg.cost) return;

    s.players[pid].money -= cfg.cost;
    s.towers.push({
      id: `${pid}_${x}_${y}_${s.tick}`,
      owner: pid, type, x, y,
      hp: cfg.maxHp, maxHp: cfg.maxHp,
      cooldown: 0, active: true, level: 1,
    });
  }

  private upgradeTower(pid: PlayerId, towerId: string): void {
    const tower = this.state.towers.find(t => t.id === towerId && t.owner === pid);
    if (!tower || tower.level >= MAX_TOWER_LEVEL) return;
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

    stepGame(this.state);

    const stateMsg = JSON.stringify({ type: 'STATE', state: this.state } satisfies ServerMessage);
    for (const p of this.players) {
      if (p.ws.readyState === WebSocket.OPEN) p.ws.send(stateMsg);
    }

    if ((this.state.phase as string) === 'ended') {
      const overMsg: ServerMessage = { type: 'GAME_OVER', winner: this.state.winner!, finalState: this.state };
      for (const p of this.players) {
        if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify(overMsg));
      }
      this.stop();
    }
  }

  private stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }
}
