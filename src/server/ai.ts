import type { GameState, PlayerId, TowerType } from '../shared/types';
import { BOARD_WIDTH, BOARD_HEIGHT, TOWER_CONFIGS, MAX_TOWER_LEVEL, UPGRADE_COST_RATIO } from '../shared/config';

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
      const cost = Math.floor(TOWER_CONFIGS[t.type].cost * UPGRADE_COST_RATIO);
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

  const r = Math.random();
  let type: TowerType | null = null;
  let spot: { x: number; y: number } | null = null;

  if (r < 0.15 && backline.length) {
    type = pick(BACKLINE);
    spot = pickRandom(backline);
  } else if (r < 0.4 && frontier.length) {
    type = pick(ATTACKERS);
    spot = pickRandom(frontier);
  }

  // Default (and fallback): a painter on the frontier to keep expanding.
  if (!type) {
    type = pick(PAINTERS);
    const pool = frontier.length ? frontier : backline;
    spot = pool.length ? pickRandom(pool) : null;
  }

  if (!type || !spot) return null;
  return { kind: 'place', type, x: spot.x, y: spot.y };
}
