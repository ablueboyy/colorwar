import type { GameState, Tower, Projectile, PlayerId, CellColor } from './types';
import {
  BOARD_WIDTH, BOARD_HEIGHT, TICK_RATE, GAME_DURATION, KO_THRESHOLD,
  BASE_INCOME_PER_SECOND, CELL_INCOME_PER_SECOND, CELL_INCOME_CAP,
  INITIAL_P1_COLS, INITIAL_P2_COLS, STARTING_MONEY, TOWER_CONFIGS, LEVEL_MULTS,
} from './config';

let nextId = 0;
function uid(): string {
  return (++nextId).toString(36);
}

export function createInitialState(): GameState {
  const board: CellColor[][] = Array.from(
    { length: BOARD_HEIGHT },
    () => Array(BOARD_WIDTH).fill('neutral') as CellColor[],
  );
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    for (let x = 0; x < INITIAL_P1_COLS; x++) board[y][x] = 'p1';
    for (let x = BOARD_WIDTH - INITIAL_P2_COLS; x < BOARD_WIDTH; x++) board[y][x] = 'p2';
  }
  return {
    board,
    towers: [],
    projectiles: [],
    players: {
      p1: { id: 'p1', money: STARTING_MONEY, cells: BOARD_HEIGHT * INITIAL_P1_COLS },
      p2: { id: 'p2', money: STARTING_MONEY, cells: BOARD_HEIGHT * INITIAL_P2_COLS },
    },
    tick: 0,
    timeLeft: GAME_DURATION,
    phase: 'waiting',
    winner: null,
  };
}

function lm(tower: Tower) {
  return LEVEL_MULTS[tower.level - 1] ?? LEVEL_MULTS[0];
}

function findTarget(
  state: GameState,
  tower: Tower,
): { x: number; y: number } | null {
  const cfg = TOWER_CONFIGS[tower.type];
  const range = cfg.range * lm(tower).range;
  const tx = tower.x, ty = tower.y;

  // Sniper prefers enemy towers
  if (tower.type === 'sniper') {
    let best: Tower | null = null;
    let bestDist = Infinity;
    for (const t of state.towers) {
      if (t.owner === tower.owner) continue;
      const d = Math.hypot(t.x - tx, t.y - ty);
      if (d <= range && d < bestDist) { bestDist = d; best = t; }
    }
    if (best) return { x: best.x, y: best.y };
  }

  // Flak lobs onto the deepest reachable enemy cell (the back rows), falling
  // back to the farthest non-owned cell if no enemy ground is in range.
  if (tower.type === 'flak') {
    let enemy: { x: number; y: number } | null = null, enemyDist = -1;
    let any: { x: number; y: number } | null = null, anyDist = -1;
    const fx0 = Math.max(0, Math.floor(tx - range)), fx1 = Math.min(BOARD_WIDTH - 1, Math.ceil(tx + range));
    const fy0 = Math.max(0, Math.floor(ty - range)), fy1 = Math.min(BOARD_HEIGHT - 1, Math.ceil(ty + range));
    for (let y = fy0; y <= fy1; y++) {
      for (let x = fx0; x <= fx1; x++) {
        const cell = state.board[y][x];
        if (cell === tower.owner) continue;
        const d = Math.hypot(x - tx, y - ty);
        if (d > range) continue;
        if (d > anyDist) { anyDist = d; any = { x, y }; }
        if (cell !== 'neutral' && d > enemyDist) { enemyDist = d; enemy = { x, y }; }
      }
    }
    return enemy ?? any;
  }

  // Find nearest non-owned cell
  let bestCell: { x: number; y: number } | null = null;
  let bestDist = Infinity;
  const x0 = Math.max(0, Math.floor(tx - range)), x1 = Math.min(BOARD_WIDTH - 1, Math.ceil(tx + range));
  const y0 = Math.max(0, Math.floor(ty - range)), y1 = Math.min(BOARD_HEIGHT - 1, Math.ceil(ty + range));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (state.board[y][x] === tower.owner) continue;
      const d = Math.hypot(x - tx, y - ty);
      if (d <= range && d < bestDist) { bestDist = d; bestCell = { x, y }; }
    }
  }
  return bestCell;
}

function fireProjectiles(state: GameState, tower: Tower, target: { x: number; y: number }): void {
  const cfg = TOWER_CONFIGS[tower.type];
  const dx = (target.x + 0.5) - (tower.x + 0.5);
  const dy = (target.y + 0.5) - (tower.y + 0.5);
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return;

  const baseAngle = Math.atan2(dy, dx);
  const lifetime = cfg.lob ? Math.ceil(dist / cfg.bulletSpeed) + 2 : Math.ceil(dist / cfg.bulletSpeed) + 12;

  const count = cfg.spreadCount;
  for (let i = 0; i < count; i++) {
    const offset = count === 1 ? 0 : (i - Math.floor(count / 2)) * (cfg.spreadAngleDeg * Math.PI / 180);
    const angle = baseAngle + offset;
    const proj: Projectile = {
      id: uid(),
      owner: tower.owner,
      towerType: tower.type,
      x: tower.x + 0.5,
      y: tower.y + 0.5,
      vx: Math.cos(angle) * cfg.bulletSpeed,
      vy: Math.sin(angle) * cfg.bulletSpeed,
      towerDamage: cfg.towerDamage * lm(tower).dmg,
      splashRadius: cfg.splashRadius,
      lifetime,
    };
    if (cfg.lob) {
      proj.lob = true;
      proj.tx = target.x + 0.5;
      proj.ty = target.y + 0.5;
    }
    state.projectiles.push(proj);
  }
}

// Splash detonation: paint cells in radius, damage enemy towers, and capture a
// tower's cell only when the blast destroys it (living towers shield their
// ground). Shared by 範圍砲/榴彈砲 direct hits and 高射砲 lobbed shells.
function explodeSplash(state: GameState, cx: number, cy: number, proj: Projectile): void {
  const sr = Math.ceil(proj.splashRadius);
  for (let dy = -sr; dy <= sr; dy++) {
    for (let dx = -sr; dx <= sr; dx++) {
      if (Math.hypot(dx, dy) > proj.splashRadius) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= BOARD_WIDTH || ny < 0 || ny >= BOARD_HEIGHT) continue;
      const ei = state.towers.findIndex(t => t.x === nx && t.y === ny && t.owner !== proj.owner);
      if (ei !== -1) {
        state.towers[ei].hp -= proj.towerDamage * 0.6;
        if (state.towers[ei].hp <= 0) {
          state.board[ny][nx] = proj.owner;
          state.towers.splice(ei, 1);
        }
        continue;
      }
      if (state.board[ny][nx] !== proj.owner) state.board[ny][nx] = proj.owner;
    }
  }
}

function countCells(board: CellColor[][], owner: PlayerId): number {
  let n = 0;
  for (let y = 0; y < BOARD_HEIGHT; y++)
    for (let x = 0; x < BOARD_WIDTH; x++)
      if (board[y][x] === owner) n++;
  return n;
}

export function stepGame(state: GameState): void {
  if (state.phase !== 'playing') return;

  const dt = 1 / TICK_RATE;
  state.tick++;
  state.timeLeft -= dt;

  // 1a. Compute support speed boosts
  const boosts = new Map<string, number>();
  for (const sup of state.towers) {
    const cfg = TOWER_CONFIGS[sup.type];
    if (cfg.speedBoost <= 0 || !sup.active) continue;
    const effRange = cfg.supportRange * lm(sup).range;
    for (const t of state.towers) {
      if (t.owner !== sup.owner || t.id === sup.id || !t.active) continue;
      if (Math.hypot(t.x - sup.x, t.y - sup.y) <= effRange) {
        boosts.set(t.id, Math.min((boosts.get(t.id) ?? 1) + cfg.speedBoost, 2.5));
      }
    }
  }

  // 1b. Repair towers heal nearby friendly towers
  for (const medic of state.towers) {
    const cfg = TOWER_CONFIGS[medic.type];
    if (cfg.healPerTick <= 0 || !medic.active) continue;
    const effRange = cfg.healRange * lm(medic).range;
    const healAmt = cfg.healPerTick * lm(medic).speed;
    for (const t of state.towers) {
      if (t.owner !== medic.owner || t.id === medic.id || t.hp >= t.maxHp) continue;
      if (Math.hypot(t.x - medic.x, t.y - medic.y) <= effRange) {
        t.hp = Math.min(t.maxHp, t.hp + healAmt);
      }
    }
  }

  // 2. Tower activation + firing
  for (const tower of state.towers) {
    tower.active = state.board[tower.y]?.[tower.x] === tower.owner;
    const cfg = TOWER_CONFIGS[tower.type];
    if (!tower.active || cfg.shootInterval === 0) continue;

    const boost = boosts.get(tower.id) ?? 1;
    tower.cooldown -= boost * lm(tower).speed;

    // Track the current target every tick so the turret keeps facing it,
    // even between shots.
    const target = findTarget(state, tower);
    if (target) {
      tower.aim = Math.atan2(target.y - tower.y, target.x - tower.x);
    }

    if (tower.cooldown <= 0) {
      if (target) {
        fireProjectiles(state, tower, target);
        tower.cooldown = cfg.shootInterval;
      } else {
        tower.cooldown = 0;
      }
    }
  }

  // 3. Move & resolve projectiles
  const dead = new Set<string>();
  for (const proj of state.projectiles) {
    if (dead.has(proj.id)) continue;

    proj.x += proj.vx;
    proj.y += proj.vy;
    proj.lifetime--;

    if (
      proj.x < -1 || proj.x > BOARD_WIDTH + 1 ||
      proj.y < -1 || proj.y > BOARD_HEIGHT + 1
    ) {
      dead.add(proj.id);
      continue;
    }

    // Lobbed shells (高射砲) ignore everything mid-flight and only detonate
    // once they arrive at the target — letting them fly over walls/territory.
    if (proj.lob) {
      const reached = Math.hypot(proj.x - proj.tx!, proj.y - proj.ty!) <= Math.max(0.5, Math.hypot(proj.vx, proj.vy));
      if (reached || proj.lifetime <= 0) {
        const lx = Math.floor(proj.tx!), ly = Math.floor(proj.ty!);
        if (lx >= 0 && lx < BOARD_WIDTH && ly >= 0 && ly < BOARD_HEIGHT) explodeSplash(state, lx, ly, proj);
        dead.add(proj.id);
      }
      continue;
    }

    if (proj.lifetime <= 0) { dead.add(proj.id); continue; }

    const cx = Math.floor(proj.x);
    const cy = Math.floor(proj.y);
    if (cx < 0 || cx >= BOARD_WIDTH || cy < 0 || cy >= BOARD_HEIGHT) continue;

    // Check enemy tower collision — a living enemy tower (including walls)
    // shields its cell; the cell is captured only by the shot that destroys it.
    const hitIdx = state.towers.findIndex(t => t.x === cx && t.y === cy && t.owner !== proj.owner);
    if (hitIdx !== -1) {
      const hit = state.towers[hitIdx];
      hit.hp -= proj.towerDamage;
      if (hit.hp <= 0) {
        state.board[hit.y][hit.x] = proj.owner; // destroyed → attacker captures the ground
        state.towers.splice(hitIdx, 1);
      }
      dead.add(proj.id);
      continue;
    }

    // Check cell color
    const cell = state.board[cy][cx];
    if (cell === proj.owner) continue; // pass through own cells

    if (proj.splashRadius > 0) {
      explodeSplash(state, cx, cy, proj);
      dead.add(proj.id);
    } else {
      state.board[cy][cx] = proj.owner;
      dead.add(proj.id);
    }
  }
  state.projectiles = state.projectiles.filter(p => !dead.has(p.id));

  // 4. Income
  for (const pid of ['p1', 'p2'] as PlayerId[]) {
    const player = state.players[pid];
    const cells = countCells(state.board, pid);
    player.cells = cells;
    const cellBonus = Math.min(cells * CELL_INCOME_PER_SECOND, CELL_INCOME_CAP);
    player.money += (BASE_INCOME_PER_SECOND + cellBonus) * dt;
  }

  // 5. Win condition
  const total = BOARD_WIDTH * BOARD_HEIGHT;
  const p1c = state.players.p1.cells;
  const p2c = state.players.p2.cells;

  if (p1c / total >= KO_THRESHOLD) { state.phase = 'ended'; state.winner = 'p1'; }
  else if (p2c / total >= KO_THRESHOLD) { state.phase = 'ended'; state.winner = 'p2'; }
  else if (state.timeLeft <= 0) {
    state.phase = 'ended';
    state.winner = p1c > p2c ? 'p1' : p2c > p1c ? 'p2' : 'draw';
  }
}
