import type { GameState, PlayerId, TowerType } from '../shared/types';
import { BOARD_WIDTH, BOARD_HEIGHT, TOWER_CONFIGS, MAX_TOWER_LEVEL, upgradeCostFor } from '../shared/config';

// How often (in game ticks) the bot makes a decision. 20 ticks = 1s.
export const BOT_DECISION_TICKS = 12;

// The bot always fields this loadout regardless of what the human picked:
// painters to expand, a couple of attackers, and some economy/support.
export const BOT_LOADOUT: TowerType[] = [
  'basic', 'rapid', 'spread', 'sniper', 'artillery', 'support', 'money', 'repair',
];

export type BotAction =
  | { kind: 'place'; type: TowerType; x: number; y: number }
  | { kind: 'upgrade'; towerId: string };

// Painters push the frontier by painting cells; attackers snipe enemy towers;
// the rest sit behind the line for economy / durability.
const PAINTERS: TowerType[] = ['basic', 'rapid', 'spread'];
const ATTACKERS: TowerType[] = ['sniper', 'artillery'];
const BACKLINE: TowerType[] = ['money', 'support', 'repair'];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Decide a single action for the bot to take this decision tick, or null to
// pass. Room re-validates every action, so proposals can be optimistic.
export function decideBotAction(state: GameState, pid: PlayerId, loadout: TowerType[]): BotAction | null {
  const money = state.players[pid].money;
  const towerAt = (x: number, y: number) => state.towers.some(t => t.x === x && t.y === y);
  const affordable = (t: TowerType) => loadout.includes(t) && TOWER_CONFIGS[t].cost <= money;
  const pick = (types: TowerType[]) => {
    const ok = types.filter(affordable);
    return ok.length ? pickRandom(ok) : null;
  };

  // Pour spare cash into upgrading a random frontline tower now and then.
  if (money > 220 && Math.random() < 0.3) {
    const upgradable = state.towers.filter(
      t => t.owner === pid && t.level < MAX_TOWER_LEVEL && !TOWER_CONFIGS[t.type].noUpgrade,
    );
    if (upgradable.length) {
      const t = pickRandom(upgradable);
      const cost = upgradeCostFor(TOWER_CONFIGS[t.type]);
      if (money >= cost) return { kind: 'upgrade', towerId: t.id };
    }
  }

  // Split our empty owned cells into frontier (bordering un-owned ground, where
  // painting makes progress) and backline (fully surrounded by our own cells).
  const frontier: { x: number; y: number }[] = [];
  const backline: { x: number; y: number }[] = [];
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    for (let x = 0; x < BOARD_WIDTH; x++) {
      if (state.board[y][x] !== pid || towerAt(x, y)) continue;
      const borders =
        state.board[y][x - 1] !== pid || state.board[y][x + 1] !== pid ||
        state.board[y - 1]?.[x] !== pid || state.board[y + 1]?.[x] !== pid;
      (borders ? frontier : backline).push({ x, y });
    }
  }

  const pool = frontier.length ? frontier : backline;
  if (pool.length === 0) return null;

  // Prefer a role-appropriate tower, but fall back to *anything* placeable in
  // the loadout so every tower sees play (matters for the balance sim, and
  // keeps varied loadouts from stalling the bot).
  const r = Math.random();
  const type =
    (r < 0.15 ? pick(BACKLINE) : null) ??
    (r < 0.45 ? pick(ATTACKERS) : null) ??
    pick(PAINTERS) ??
    pick(loadout.filter(t => !TOWER_CONFIGS[t].active));
  if (!type) return null;
  return { kind: 'place', type, x: pickRandom(pool).x, y: pickRandom(pool).y };
}
