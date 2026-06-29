import type { GameState, Tower, Projectile, PlayerId, CellColor } from './types';
import {
  BOARD_WIDTH, BOARD_HEIGHT, TICK_RATE, GAME_DURATION, KO_THRESHOLD,
  BASE_INCOME_PER_SECOND, CELL_INCOME_PER_SECOND, CELL_INCOME_CAP,
  INITIAL_P1_COLS, INITIAL_P2_COLS, STARTING_MONEY, TOWER_CONFIGS,
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

function findTarget(
  state: GameState,
  tower: Tower,
): { x: number; y: number } | null {
  const cfg = TOWER_CONFIGS[tower.type];
  const range = cfg.range;
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

  // Find nearest non-owned cell
  let bestCell: { x: number; y: number } | null = null;
  let bestDist = Infinity;
  const x0 = Math.max(0, tx - range), x1 = Math.min(BOARD_WIDTH - 1, tx + range);
  const y0 = Math.max(0, ty - range), y1 = Math.min(BOARD_HEIGHT - 1, ty + range);

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
  const lifetime = Math.ceil(dist / cfg.bulletSpeed) + 12;

  const count = cfg.spreadCount;
  for (let i = 0; i < count; i++) {
    const offset = count === 1 ? 0 : (i - Math.floor(count / 2)) * (cfg.spreadAngleDeg * Math.PI / 180);
    const angle = baseAngle + offset;
    state.projectiles.push({
      id: uid(),
      owner: tower.owner,
      towerType: tower.type,
      x: tower.x + 0.5,
      y: tower.y + 0.5,
      vx: Math.cos(angle) * cfg.bulletSpeed,
      vy: Math.sin(angle) * cfg.bulletSpeed,
      towerDamage: cfg.towerDamage,
      splashRadius: cfg.splashRadius,
      lifetime,
    });
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
    for (const t of state.towers) {
      if (t.owner !== sup.owner || t.id === sup.id || !t.active) continue;
      if (Math.hypot(t.x - sup.x, t.y - sup.y) <= cfg.supportRange) {
        boosts.set(t.id, Math.min((boosts.get(t.id) ?? 1) + cfg.speedBoost, 2.5));
      }
    }
  }

  // 1b. Repair towers heal nearby friendly towers
  for (const medic of state.towers) {
    const cfg = TOWER_CONFIGS[medic.type];
    if (cfg.healPerTick <= 0 || !medic.active) continue;
    for (const t of state.towers) {
      if (t.owner !== medic.owner || t.id === medic.id || t.hp >= t.maxHp) continue;
      if (Math.hypot(t.x - medic.x, t.y - medic.y) <= cfg.healRange) {
        t.hp = Math.min(t.maxHp, t.hp + cfg.healPerTick);
      }
    }
  }

  // 2. Tower activation + firing
  for (const tower of state.towers) {
    tower.active = state.board[tower.y]?.[tower.x] === tower.owner;
    const cfg = TOWER_CONFIGS[tower.type];
    if (!tower.active || cfg.shootInterval === 0) continue;

    const boost = boosts.get(tower.id) ?? 1;
    tower.cooldown -= boost;

    if (tower.cooldown <= 0) {
      const target = findTarget(state, tower);
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
      proj.lifetime <= 0 ||
      proj.x < -1 || proj.x > BOARD_WIDTH + 1 ||
      proj.y < -1 || proj.y > BOARD_HEIGHT + 1
    ) {
      dead.add(proj.id);
      continue;
    }

    const cx = Math.floor(proj.x);
    const cy = Math.floor(proj.y);
    if (cx < 0 || cx >= BOARD_WIDTH || cy < 0 || cy >= BOARD_HEIGHT) continue;

    // Check enemy tower collision
    const hitIdx = state.towers.findIndex(t => t.x === cx && t.y === cy && t.owner !== proj.owner);
    if (hitIdx !== -1) {
      const hit = state.towers[hitIdx];
      hit.hp -= proj.towerDamage;
      if (hit.hp <= 0) {
        state.board[hit.y][hit.x] = 'neutral';
        state.towers.splice(hitIdx, 1);
      }
      dead.add(proj.id);
      continue;
    }

    // Check cell color
    const cell = state.board[cy][cx];
    if (cell === proj.owner) continue; // pass through own cells

    if (proj.splashRadius > 0) {
      // Splash explosion
      const sr = Math.ceil(proj.splashRadius);
      for (let dy = -sr; dy <= sr; dy++) {
        for (let dx = -sr; dx <= sr; dx++) {
          if (Math.hypot(dx, dy) > proj.splashRadius) continue;
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || nx >= BOARD_WIDTH || ny < 0 || ny >= BOARD_HEIGHT) continue;
          // Damage enemy towers in splash radius
          const ei = state.towers.findIndex(t => t.x === nx && t.y === ny && t.owner !== proj.owner);
          if (ei !== -1) {
            state.towers[ei].hp -= proj.towerDamage * 0.6;
            if (state.towers[ei].hp <= 0) {
              state.board[state.towers[ei].y][state.towers[ei].x] = 'neutral';
              state.towers.splice(ei, 1);
            }
          }
          if (state.board[ny][nx] !== proj.owner) {
            state.board[ny][nx] = proj.owner;
          }
        }
      }
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
