// Player actions, extracted from Room so the same validated logic drives online
// matches, the single-player bot, headless balance sims, and unit tests.
import type { GameState, PlayerId, TowerType } from './types';
import { explodeSplash, explodePercent, spawnEffect } from './gameLogic';
import {
  BOARD_WIDTH, BOARD_HEIGHT, TOWER_CONFIGS, SELL_REFUND_RATIO,
  LEVEL_MULTS, MAX_TOWER_LEVEL, BOMB_COOLDOWN_TICKS, upgradeCostFor,
} from './config';

const inBounds = (x: number, y: number) =>
  x >= 0 && x < BOARD_WIDTH && y >= 0 && y < BOARD_HEIGHT;

export function placeTower(
  s: GameState, loadout: TowerType[], pid: PlayerId, type: TowerType, x: number, y: number,
): void {
  if (!loadout.includes(type)) return; // only towers in this player's loadout
  const cfg = TOWER_CONFIGS[type];
  if (cfg.active) return; // active abilities (炸彈) aren't placed as towers
  if (!inBounds(x, y)) return;
  if (s.board[y][x] !== pid) return;
  if (s.towers.some(t => t.x === x && t.y === y)) return;
  if (s.players[pid].money < cfg.cost) return;

  s.players[pid].money -= cfg.cost;
  // Timed helper towers (召喚塔/附魔塔) wait a full interval before their first trigger.
  const initialCooldown = cfg.summonInterval ?? cfg.enchantInterval ?? 0;
  s.towers.push({
    id: `${pid}_${x}_${y}_${s.tick}`,
    owner: pid, type, x, y,
    hp: cfg.maxHp, maxHp: cfg.maxHp,
    cooldown: initialCooldown, active: true, level: 1,
    aim: -Math.PI / 2, // offensive towers snap to target on first tick
    slow: 0,
  });

  // 旗幟塔: one-time burst that paints a radius around the placement.
  if (cfg.banner) {
    const rad = cfg.bannerRadius ?? 2;
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (Math.hypot(dx, dy) > rad) continue;
        const nx = x + dx, ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        if (s.towers.some(t => t.x === nx && t.y === ny && t.owner !== pid)) continue; // enemy towers shield their cell
        s.board[ny][nx] = pid;
      }
    }
  }
}

export function bomb(s: GameState, loadout: TowerType[], pid: PlayerId, x: number, y: number): void {
  if (!loadout.includes('bomb')) return;
  if (!inBounds(x, y)) return;
  if (s.players[pid].bombCooldown > 0) return; // still on cooldown
  const cfg = TOWER_CONFIGS.bomb;
  if (s.players[pid].money < cfg.cost) return;
  s.players[pid].money -= cfg.cost;
  s.players[pid].bombCooldown = BOMB_COOLDOWN_TICKS;
  explodeSplash(s, x, y, pid, cfg.towerDamage, cfg.splashRadius); // spawns its own blast effect
}

export function upgradeTower(s: GameState, pid: PlayerId, towerId: string): void {
  const tower = s.towers.find(t => t.id === towerId && t.owner === pid);
  if (!tower || tower.level >= MAX_TOWER_LEVEL) return;
  const cfg = TOWER_CONFIGS[tower.type];
  if (cfg.noUpgrade) return; // 附魔塔 can't be upgraded
  const cost = upgradeCostFor(cfg);
  if (s.players[pid].money < cost) return;
  s.players[pid].money -= cost;
  tower.level++;
  tower.maxHp = Math.round(cfg.maxHp * LEVEL_MULTS[tower.level - 1].hp);
  tower.hp = tower.maxHp;
}

export function sellTower(s: GameState, pid: PlayerId, towerId: string): void {
  const idx = s.towers.findIndex(t => t.id === towerId && t.owner === pid);
  if (idx === -1) return;
  const tower = s.towers[idx];
  if (tower.charged) return; // a charged 獻祭砲 is a live nuke, not sellable
  s.players[pid].money += Math.floor(TOWER_CONFIGS[tower.type].cost * SELL_REFUND_RATIO);
  s.towers.splice(idx, 1);
}

// Fire a charged 獻祭砲: consume the armed tower and blast the target cell,
// painting the radius and chipping enemy towers by a % of their max HP.
export function detonateSacrifice(s: GameState, pid: PlayerId, towerId: string, x: number, y: number): void {
  if (!inBounds(x, y)) return;
  const idx = s.towers.findIndex(t => t.id === towerId && t.owner === pid && t.charged);
  if (idx === -1) return;
  const cfg = TOWER_CONFIGS.sacrifice;
  s.towers.splice(idx, 1);
  explodePercent(s, x, y, pid, cfg.sacrificeHpPercent ?? 0.5, cfg.splashRadius);
  spawnEffect(s, 'nuke', x, y, cfg.splashRadius, 30, pid);
}
