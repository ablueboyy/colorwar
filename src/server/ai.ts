import type { GameState, PlayerId, TowerType, Difficulty } from '../shared/types';
import { BOARD_WIDTH, BOARD_HEIGHT, TOWER_CONFIGS, MAX_TOWER_LEVEL, upgradeCostFor } from '../shared/config';

// The bot always fields this loadout regardless of what the human picked:
// painters to expand, a couple of attackers, and some economy/support.
export const BOT_LOADOUT: TowerType[] = [
  'basic', 'rapid', 'spread', 'sniper', 'artillery', 'support', 'money', 'repair',
];

export interface BotConfig {
  decisionTicks: number; // ticks between decisions
  smart: boolean;        // aim placements toward the front instead of at random
  focus: boolean;        // pick the highest-conversion cell + most paint-efficient tower
  actives: boolean;      // detonate a charged 獻祭砲 / bomb when flush
  upgradeAt: number;     // start spending spare cash on upgrades above this
}

// Tuned against the balance sim. Counter-intuitively, acting *faster* is worse
// here: it dribbles income into the cheapest tower before the bot can save for
// paint-efficient ones, and early economy / heavy upgrading lose the territory
// race outright. So the skill ladder is placement *quality*, not tempo — easy
// places at random, normal pushes the front, hard also picks the best cell,
// prefers efficient painters, and uses active abilities.
export const BOT_DIFFICULTY: Record<Difficulty, BotConfig> = {
  easy:   { decisionTicks: 16, smart: false, focus: false, actives: false, upgradeAt: 100000 },
  normal: { decisionTicks: 12, smart: true,  focus: false, actives: false, upgradeAt: 320 },
  hard:   { decisionTicks: 11, smart: true,  focus: true,  actives: true,  upgradeAt: 320 },
};

export type BotAction =
  | { kind: 'place'; type: TowerType; x: number; y: number }
  | { kind: 'upgrade'; towerId: string }
  | { kind: 'bomb'; x: number; y: number }
  | { kind: 'detonate'; towerId: string; x: number; y: number };

// Role buckets for placement: painters/attackers push the front, helpers sit back.
const PAINTERS: TowerType[] = ['basic', 'rapid', 'spread', 'octopus'];
// Paint-per-second order (best first), used by focus bots to prefer 散射砲 etc.
const PAINTER_RANK: TowerType[] = ['spread', 'rapid', 'octopus', 'basic'];
const ATTACKERS: TowerType[] = ['sniper', 'artillery', 'splash', 'flak'];
const HELPERS: TowerType[] = ['support', 'repair', 'money', 'enchant'];

function pickRandom<T>(a: T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}

// The enemy tower cell with the most enemy towers packed within `radius` —
// the juiciest target for an area attack (bomb / charged 獻祭砲).
function densestEnemyCell(state: GameState, pid: PlayerId, radius: number): { x: number; y: number } | null {
  const enemies = state.towers.filter(t => t.owner !== pid);
  if (enemies.length === 0) return null;
  let best = enemies[0], bestScore = -1;
  for (const c of enemies) {
    let score = 0;
    for (const o of enemies) if (Math.hypot(o.x - c.x, o.y - c.y) <= radius) score++;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return { x: best.x, y: best.y };
}

// Decide a single action for the bot this decision tick, or null to pass.
// Room re-validates every action, so proposals can be optimistic.
export function decideBotAction(
  state: GameState, pid: PlayerId, loadout: TowerType[], difficulty: Difficulty = 'normal',
): BotAction | null {
  const cfg = BOT_DIFFICULTY[difficulty];
  const me = state.players[pid];
  const money = me.money;
  const towerAt = (x: number, y: number) => state.towers.some(t => t.x === x && t.y === y);
  const affordable = (t: TowerType) => loadout.includes(t) && TOWER_CONFIGS[t].cost <= money;
  const pick = (types: TowerType[]) => {
    const ok = types.filter(affordable);
    return ok.length ? pickRandom(ok) : null;
  };

  // ── Active abilities (hard only) ──
  if (cfg.actives) {
    // A charged 獻祭砲 is a wasted asset sitting idle — throw it at the cluster.
    const charged = state.towers.find(t => t.owner === pid && t.charged);
    if (charged) {
      const tgt = densestEnemyCell(state, pid, TOWER_CONFIGS.sacrifice.splashRadius) ?? { x: charged.x, y: charged.y };
      return { kind: 'detonate', towerId: charged.id, x: tgt.x, y: tgt.y };
    }
    // Bomb the densest enemy cluster, but only from a cash surplus so it never
    // steals tempo from expanding the front (the sim showed greedy bombing loses).
    if (loadout.includes('bomb') && me.bombCooldown <= 0 && money >= 250) {
      const tgt = densestEnemyCell(state, pid, TOWER_CONFIGS.bomb.splashRadius);
      if (tgt) return { kind: 'bomb', x: tgt.x, y: tgt.y };
    }
  }

  // ── Upgrades: pour spare cash into a random frontline tower ──
  if (money > cfg.upgradeAt && Math.random() < 0.35) {
    const ups = state.towers.filter(
      t => t.owner === pid && t.level < MAX_TOWER_LEVEL && !TOWER_CONFIGS[t.type].noUpgrade && !t.charged,
    );
    if (ups.length) {
      const t = pickRandom(ups);
      if (money >= upgradeCostFor(TOWER_CONFIGS[t.type])) return { kind: 'upgrade', towerId: t.id };
    }
  }

  // ── Placement: split empty owned cells into frontier / backline ──
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
  if (frontier.length === 0 && backline.length === 0) return null;

  // Pick a *desired* tower by role weighting, ignoring cost for now: mostly
  // painters (expand), then attackers, a few helpers, else anything placeable.
  const inLoadout = (types: TowerType[]) => types.filter(t => loadout.includes(t));
  const placeable = loadout.filter(t => !TOWER_CONFIGS[t].active);
  // focus bots prefer the most paint-per-second painter (散射 > 連射 > 章魚 > 基礎).
  const wishPainter = () => {
    const l = inLoadout(PAINTERS);
    if (!l.length) return null;
    if (!cfg.focus) return pickRandom(l);
    return [...l].sort((a, b) => PAINTER_RANK.indexOf(a) - PAINTER_RANK.indexOf(b))[0];
  };
  const wish = (types: TowerType[]) => { const l = inLoadout(types); return l.length ? pickRandom(l) : null; };
  const r = Math.random();
  const desired =
    (r < 0.55 ? wishPainter() : null) ??
    (r < 0.80 ? wish(ATTACKERS) : null) ??
    (r < 0.90 ? wish(HELPERS) : null) ??
    (placeable.length ? pickRandom(placeable) : null);
  if (!desired) return null;

  // Afford it? If not, a smart bot mostly *saves up* (skips this turn) instead
  // of always dribbling money into the cheapest tower; a dumb bot just spams.
  let type = desired;
  if (TOWER_CONFIGS[desired].cost > money) {
    const cheap = pick(placeable);
    if (cfg.smart) {
      if (!cheap || Math.random() < 0.7) return null; // hold cash for the pricier pick
      type = cheap;
    } else {
      if (!cheap) return null;
      type = cheap;
    }
  }

  // Choose where: helpers hide in the backline; everything else pushes forward.
  let spot: { x: number; y: number };
  if (HELPERS.includes(type)) {
    spot = pickRandom(backline.length ? backline : frontier);
  } else {
    const pool = frontier.length ? frontier : backline;
    if (cfg.smart && pool === frontier) {
      // Spread along the most advanced third of the front (broad coverage beats
      // clumping on a single "best" cell — the sim is emphatic about this).
      const fwd = (c: { x: number }) => (pid === 'p2' ? -c.x : c.x); // toward the enemy
      const sorted = [...pool].sort((a, b) => fwd(b) - fwd(a));
      spot = pickRandom(sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 3))));
    } else {
      spot = pickRandom(pool);
    }
  }
  return { kind: 'place', type, x: spot.x, y: spot.y };
}
