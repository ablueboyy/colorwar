import type { GameState, Tower, Projectile, Barrier, PlayerId, CellColor } from './types';
import {
  BOARD_WIDTH, BOARD_HEIGHT, TICK_RATE, GAME_DURATION, KO_THRESHOLD,
  BASE_INCOME_PER_SECOND, CELL_INCOME_PER_SECOND, CELL_INCOME_CAP,
  INITIAL_P1_COLS, INITIAL_P2_COLS, STARTING_MONEY, TOWER_CONFIGS, LEVEL_MULTS, MAX_TOWER_LEVEL,
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
    barriers: [],
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

  // Sniper prefers enemy towers, and is taunted toward enemy decoys first.
  if (tower.type === 'sniper') {
    let best: Tower | null = null, bestDist = Infinity;
    let decoy: Tower | null = null, decoyDist = Infinity;
    for (const t of state.towers) {
      if (t.owner === tower.owner) continue;
      const d = Math.hypot(t.x - tx, t.y - ty);
      if (d > range) continue;
      if (d < bestDist) { bestDist = d; best = t; }
      if (TOWER_CONFIGS[t.type].decoy && d < decoyDist) { decoyDist = d; decoy = t; }
    }
    const pick = decoy ?? best;
    if (pick) return { x: pick.x, y: pick.y };
  }

  // Jammer lobs at a random enemy tower in range (to slow clusters).
  if (tower.type === 'jammer') {
    const enemies = state.towers.filter(t => t.owner !== tower.owner && Math.hypot(t.x - tx, t.y - ty) <= range);
    if (enemies.length === 0) return null;
    const e = enemies[Math.floor(Math.random() * enemies.length)];
    return { x: e.x, y: e.y };
  }

  // Flak lobs onto a RANDOM reachable cell, preferring enemy ground over
  // neutral, so its bombardment can't be predicted or fully focused.
  if (tower.type === 'flak') {
    const enemyCells: { x: number; y: number }[] = [];
    const anyCells: { x: number; y: number }[] = [];
    const fx0 = Math.max(0, Math.floor(tx - range)), fx1 = Math.min(BOARD_WIDTH - 1, Math.ceil(tx + range));
    const fy0 = Math.max(0, Math.floor(ty - range)), fy1 = Math.min(BOARD_HEIGHT - 1, Math.ceil(ty + range));
    for (let y = fy0; y <= fy1; y++) {
      for (let x = fx0; x <= fx1; x++) {
        const cell = state.board[y][x];
        if (cell === tower.owner) continue;
        if (Math.hypot(x - tx, y - ty) > range) continue;
        anyCells.push({ x, y });
        if (cell !== 'neutral') enemyCells.push({ x, y });
      }
    }
    const pool = enemyCells.length > 0 ? enemyCells : anyCells;
    return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;
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
// ground). Shared by 範圍砲/榴彈砲 direct hits, 高射砲 lobbed shells, 獻祭砲
// nuke and the 炸彈 airstrike.
export function explodeSplash(
  state: GameState, cx: number, cy: number,
  owner: PlayerId, towerDamage: number, splashRadius: number,
): void {
  const sr = Math.ceil(splashRadius);
  for (let dy = -sr; dy <= sr; dy++) {
    for (let dx = -sr; dx <= sr; dx++) {
      if (Math.hypot(dx, dy) > splashRadius) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= BOARD_WIDTH || ny < 0 || ny >= BOARD_HEIGHT) continue;
      const ei = state.towers.findIndex(t => t.x === nx && t.y === ny && t.owner !== owner);
      if (ei !== -1) {
        state.towers[ei].hp -= towerDamage * 0.6;
        if (state.towers[ei].hp <= 0) {
          state.board[ny][nx] = owner;
          state.towers.splice(ei, 1);
        }
        continue;
      }
      if (state.board[ny][nx] !== owner) state.board[ny][nx] = owner;
    }
  }
}

// 干擾砲: lobbed shell that, on landing, slows enemy towers in the blast area.
function applyJammer(state: GameState, cx: number, cy: number, proj: Projectile): void {
  const cfg = TOWER_CONFIGS[proj.towerType];
  const dur = cfg.slowDuration ?? 60;
  const sr = Math.ceil(proj.splashRadius);
  for (const t of state.towers) {
    if (t.owner === proj.owner) continue;
    if (Math.abs(t.x - cx) > sr || Math.abs(t.y - cy) > sr) continue;
    if (Math.hypot(t.x - cx, t.y - cy) <= proj.splashRadius) t.slow = Math.max(t.slow, dur);
  }
}

// Create a tower (used by 召喚塔 spawns).
function makeTower(owner: PlayerId, type: Tower['type'], x: number, y: number): Tower {
  const cfg = TOWER_CONFIGS[type];
  return {
    id: uid(), owner, type, x, y,
    hp: cfg.maxHp, maxHp: cfg.maxHp,
    cooldown: 0, active: true, level: 1, aim: -Math.PI / 2, slow: 0,
  };
}

// 章魚砲: one bullet in each of the 8 directions.
function fireOctopus(state: GameState, tower: Tower): void {
  const cfg = TOWER_CONFIGS[tower.type];
  const speed = cfg.bulletSpeed;
  const range = cfg.range * lm(tower).range;
  const lifetime = Math.ceil(range / speed) + 4;
  const dmg = cfg.towerDamage * lm(tower).dmg;
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    state.projectiles.push({
      id: uid(), owner: tower.owner, towerType: tower.type,
      x: tower.x + 0.5, y: tower.y + 0.5,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      towerDamage: dmg, splashRadius: cfg.splashRadius, lifetime,
    });
  }
}

// First adjacent cell owned by `tower`'s player that has no tower on it.
function findEmptyAdjacent(state: GameState, tower: Tower): { x: number; y: number } | null {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = tower.x + dx, y = tower.y + dy;
      if (x < 0 || x >= BOARD_WIDTH || y < 0 || y >= BOARD_HEIGHT) continue;
      if (state.board[y][x] !== tower.owner) continue;
      if (state.towers.some(t => t.x === x && t.y === y)) continue;
      return { x, y };
    }
  }
  return null;
}

// Perimeter cells of the (2*span+1) square centred on the generator, clamped
// to the board and skipping cells occupied by towers.
function ringCells(gen: Tower, span: number, state: GameState): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  for (let dy = -span; dy <= span; dy++) {
    for (let dx = -span; dx <= span; dx++) {
      if (Math.abs(dx) !== span && Math.abs(dy) !== span) continue; // border only
      const x = gen.x + dx, y = gen.y + dy;
      if (x < 0 || x >= BOARD_WIDTH || y < 0 || y >= BOARD_HEIGHT) continue;
      if (state.towers.some(t => t.x === x && t.y === y)) continue;
      cells.push({ x, y });
    }
  }
  return cells;
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
    if (tower.slow > 0) tower.slow--; // 干擾砲 slow ticks down regardless
    const cfg = TOWER_CONFIGS[tower.type];
    if (!tower.active || cfg.shootInterval === 0) continue;

    const boost = boosts.get(tower.id) ?? 1;
    const slowMul = tower.slow > 0 ? (1 - (TOWER_CONFIGS.jammer.slowFactor ?? 0.2)) : 1;
    tower.cooldown -= boost * lm(tower).speed * slowMul;

    // 章魚砲 fires radially, no aiming/targeting needed.
    if (cfg.octopus) {
      if (tower.cooldown <= 0) { fireOctopus(state, tower); tower.cooldown = cfg.shootInterval; }
      continue;
    }

    // Direct-fire turrets track their target every tick so they keep facing
    // it between shots. Lob turrets (flak/jammer) pick a fresh target only
    // when they fire, otherwise the barrel would jitter every tick.
    let target = cfg.lob ? null : findTarget(state, tower);
    if (target) tower.aim = Math.atan2(target.y - tower.y, target.x - tower.x);

    if (tower.cooldown <= 0) {
      if (cfg.lob) target = findTarget(state, tower);
      if (target) {
        tower.aim = Math.atan2(target.y - tower.y, target.x - tower.x);
        fireProjectiles(state, tower, target);
        tower.cooldown = cfg.shootInterval;
      } else {
        tower.cooldown = 0;
      }
    }
  }

  // 2c. 召喚塔 spawns a basic tower on an adjacent empty own cell on a timer.
  for (const t of [...state.towers]) { // snapshot: we push new towers below
    const cfg = TOWER_CONFIGS[t.type];
    if (!cfg.summonInterval || !t.active) continue;
    if (--t.cooldown > 0) continue;
    const spot = findEmptyAdjacent(state, t);
    if (spot) {
      state.towers.push(makeTower(t.owner, 'basic', spot.x, spot.y));
      t.cooldown = cfg.summonInterval;
    } else {
      t.cooldown = 0; // no room — retry next tick
    }
  }

  // 2d. 附魔塔 upgrades a random nearby friendly tower on a timer.
  for (const t of state.towers) {
    const cfg = TOWER_CONFIGS[t.type];
    if (!cfg.enchantInterval || !t.active) continue;
    if (--t.cooldown > 0) continue;
    const range = cfg.enchantRange ?? 3;
    const cands = state.towers.filter(o =>
      o.owner === t.owner && o.id !== t.id &&
      o.level < MAX_TOWER_LEVEL && !TOWER_CONFIGS[o.type].noUpgrade &&
      Math.hypot(o.x - t.x, o.y - t.y) <= range,
    );
    if (cands.length > 0) {
      const tgt = cands[Math.floor(Math.random() * cands.length)];
      tgt.level++;
      const m = LEVEL_MULTS[tgt.level - 1];
      tgt.maxHp = Math.round(TOWER_CONFIGS[tgt.type].maxHp * m.hp);
      tgt.hp = tgt.maxHp;
      t.cooldown = cfg.enchantInterval;
    } else {
      t.cooldown = 0;
    }
  }

  // 2e. 獻祭砲: when all 8 neighbours are friendly towers, consume them and nuke.
  for (const sac of [...state.towers]) { // snapshot: state.towers is rebuilt below
    if (!TOWER_CONFIGS[sac.type].sacrifice || !sac.active) continue;
    const neighbours = state.towers.filter(o =>
      o.owner === sac.owner && o.id !== sac.id &&
      Math.abs(o.x - sac.x) <= 1 && Math.abs(o.y - sac.y) <= 1,
    );
    if (neighbours.length >= 8) {
      const ids = new Set(neighbours.slice(0, 8).map(o => o.id));
      state.towers = state.towers.filter(o => !ids.has(o.id));
      const cfg = TOWER_CONFIGS[sac.type];
      explodeSplash(state, sac.x, sac.y, sac.owner, cfg.towerDamage, cfg.splashRadius);
    }
  }

  // 2b. Wall generators keep a shield ring. The ring does NOT self-heal; once
  // it is destroyed it stays down and only rebuilds after a cooldown counted
  // from the moment it fell (barrier.regen: -1 = alive, >0 = ticks until rebuild).
  const activeGens = state.towers.filter(t => TOWER_CONFIGS[t.type].wallHp && t.active);
  const genIds = new Set(activeGens.map(t => t.id));
  state.barriers = state.barriers.filter(b => genIds.has(b.ownerId)); // drop dead/inactive gens' walls
  for (const gen of activeGens) {
    const cfg = TOWER_CONFIGS[gen.type];
    const span = cfg.wallSpan ?? 2;
    const maxHp = cfg.wallHp!;
    const downtime = cfg.wallRegen ?? 300;
    const b = state.barriers.find(bb => bb.ownerId === gen.id);
    if (!b) {
      state.barriers.push({
        id: uid(), owner: gen.owner, ownerId: gen.id,
        cells: ringCells(gen, span, state), hp: maxHp, maxHp, regen: -1,
      });
    } else if (b.hp <= 0) {
      if (b.regen < 0) b.regen = downtime;        // just fell → start the rebuild timer
      else if (--b.regen <= 0) {                   // timer elapsed → rebuild at full HP
        b.hp = maxHp;
        b.cells = ringCells(gen, span, state);
        b.regen = -1;
      }
    }
  }

  // 3. Move & resolve projectiles
  const dead = new Set<string>();
  for (const proj of state.projectiles) {
    if (dead.has(proj.id)) continue;

    // 磁力塔: redirect non-lob enemy bullets toward the nearest enemy magnet.
    if (!proj.lob) {
      let mg: Tower | null = null, md = Infinity;
      for (const t of state.towers) {
        const mr = TOWER_CONFIGS[t.type].magnetRange;
        if (!mr || t.owner === proj.owner || !t.active) continue;
        const d = Math.hypot((t.x + 0.5) - proj.x, (t.y + 0.5) - proj.y);
        if (d <= mr && d < md) { md = d; mg = t; }
      }
      if (mg) {
        const sp = Math.hypot(proj.vx, proj.vy);
        const ang = Math.atan2((mg.y + 0.5) - proj.y, (mg.x + 0.5) - proj.x);
        proj.vx = Math.cos(ang) * sp;
        proj.vy = Math.sin(ang) * sp;
      }
    }

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
        if (lx >= 0 && lx < BOARD_WIDTH && ly >= 0 && ly < BOARD_HEIGHT) {
          if (proj.towerType === 'jammer') applyJammer(state, lx, ly, proj);
          else explodeSplash(state, lx, ly, proj.owner, proj.towerDamage, proj.splashRadius);
        }
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

    // Enemy wall ring blocks the shot and drains its shared HP pool; when the
    // pool empties the whole ring vanishes until the generator regenerates it.
    const barrier = state.barriers.find(b => b.owner !== proj.owner && b.cells.some(c => c.x === cx && c.y === cy));
    if (barrier) {
      barrier.hp -= proj.towerDamage;
      if (barrier.hp <= 0) { barrier.hp = 0; barrier.cells = []; }
      dead.add(proj.id);
      continue;
    }

    // Check cell color
    const cell = state.board[cy][cx];
    if (cell === proj.owner) continue; // pass through own cells

    if (proj.splashRadius > 0) {
      explodeSplash(state, cx, cy, proj.owner, proj.towerDamage, proj.splashRadius);
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
  // 金錢塔: extra income while active.
  for (const t of state.towers) {
    const inc = TOWER_CONFIGS[t.type].incomePerSec;
    if (inc && t.active) state.players[t.owner].money += inc * dt;
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
