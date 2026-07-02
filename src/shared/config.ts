import type { TowerType } from './types';

export const BOARD_WIDTH = 30;
export const BOARD_HEIGHT = 20;
export const TICK_RATE = 20;
export const TICK_INTERVAL_MS = 1000 / TICK_RATE;
export const GAME_DURATION = 180;
// Territory share that ends the match instantly. 1 = effectively disabled (only
// a 100% wipe ends early), so games are decided by who leads when time runs out.
export const KO_THRESHOLD = 1;

export const MAX_TOWER_LEVEL = 3;
export const UPGRADE_COST_RATIO = 0.5;

// 金錢塔: each level above 1 adds this fraction of its base income (L2 +25%,
// L3 +50%) — a mild economic bump, not a runaway.
export const MONEY_LEVEL_INCOME_BONUS = 0.25;

// 炸彈: shared cooldown between drops, so it can't be spammed to grab territory.
export const BOMB_COOLDOWN_TICKS = 10 * TICK_RATE; // 10 seconds
export const LEVEL_MULTS: { range: number; speed: number; dmg: number; hp: number }[] = [
  { range: 1.0,  speed: 1.0,  dmg: 1.0,  hp: 1.0 },
  { range: 1.2,  speed: 1.35, dmg: 1.4,  hp: 1.5 },
  { range: 1.45, speed: 1.8,  dmg: 1.85, hp: 2.2 },
];

// 加速器 fire-rate boost stacks additively but is capped here, so at +35% each
// two accelerators reach the cap and a third adds nothing.
export const SPEED_BOOST_CAP = 1.7;

export const BASE_INCOME_PER_SECOND = 8;
export const CELL_INCOME_PER_SECOND = 0.07;
export const CELL_INCOME_CAP = 22;
export const SELL_REFUND_RATIO = 0.5;

export const INITIAL_P1_COLS = 3;
export const INITIAL_P2_COLS = 3;
export const STARTING_MONEY = 100;

// How many towers each player brings into a match (chosen pre-game).
export const LOADOUT_SIZE = 8;

// If a player drops mid-match, keep their slot alive this long for a rejoin
// before awarding the match to the opponent by forfeit.
export const DISCONNECT_GRACE_MS = 20000;

export interface TowerConfig {
  cost: number;
  maxHp: number;
  shootInterval: number;
  range: number;
  bulletSpeed: number;
  towerDamage: number;
  splashRadius: number;
  spreadCount: number;
  spreadAngleDeg: number;
  supportRange: number;
  speedBoost: number;
  healPerTick: number;
  healRange: number;
  lob?: boolean; // shells fly over territory and detonate at the target (高射砲/干擾砲)
  pierce?: boolean; // 狙擊砲: bullet flies over ground & walls, only hits enemy towers
  fixedFireRate?: boolean; // 狙擊砲: fire rate never speeds up (ignores level speed & 加速器); can still be slowed by 干擾砲
  wallHp?: number;    // 護牆塔: shared HP pool of the generated wall ring
  wallRegen?: number; // 護牆塔: ticks between full regenerations
  wallSpan?: number;  // 護牆塔: half-size of the square ring (2 → 5×5)
  incomePerSec?: number; // 金錢塔: extra money/sec while active
  slowFactor?: number;   // 干擾砲: enemy fire-rate reduction (0.2 = -20%)
  slowDuration?: number; // 干擾砲: slow duration in ticks
  sacrifice?: boolean;   // 獻祭砲: consume 8 neighbour towers → arm a draggable nuke
  sacrificeHpPercent?: number; // 獻祭砲: charged blast damages enemy towers by this fraction of their max HP
  active?: boolean;      // 炸彈: a click-anywhere ability, not a placed tower
  octopus?: boolean;     // 章魚砲: fire 8 bullets radially
  summonInterval?: number; // 召喚塔: ticks between spawning a basic tower
  magnetRange?: number;    // 磁力塔: pulls enemy bullets within this range to itself
  decoy?: boolean;       // 誘餌塔: enemy snipers target it first
  chainCount?: number;   // 電磁塔: instantly zaps up to N nearest enemy towers
  enchantInterval?: number; // 附魔塔: ticks between upgrading a random nearby ally
  enchantRange?: number;    // 附魔塔: range for the random upgrade
  noUpgrade?: boolean;   // tower can't be manually/auto upgraded (附魔塔)
  upgradeCostRatio?: number; // override UPGRADE_COST_RATIO (召喚塔 pays full price)
  label: string;
  glyph: string;
  role: string;
  description: string;
}

// 順序即為下方面板按鈕的排列順序
export const TOWER_CONFIGS: Record<TowerType, TowerConfig> = {
  basic: {
    cost: 50, maxHp: 80,
    shootInterval: 48, range: 5, bulletSpeed: 0.4,
    towerDamage: 16, splashRadius: 0,
    spreadCount: 1, spreadAngleDeg: 0,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0, healRange: 0,
    label: '基礎砲', glyph: 'B', role: '通用前線',
    description: '便宜耐用的全能砲，單發染一格。升到 Lv3 後射程與傷害大幅提升。',
  },
  rapid: {
    cost: 85, maxHp: 55,
    shootInterval: 13, range: 4, bulletSpeed: 0.5,
    towerDamage: 5, splashRadius: 0,
    spreadCount: 1, spreadAngleDeg: 0,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0, healRange: 0,
    label: '連射砲', glyph: 'R', role: '快速推進',
    description: '射速極快、單發傷害低，靠數量快速把附近地板染成自己的顏色。',
  },
  spread: {
    cost: 75, maxHp: 50,
    shootInterval: 42, range: 4, bulletSpeed: 0.45,
    towerDamage: 8, splashRadius: 0,
    spreadCount: 3, spreadAngleDeg: 22,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0, healRange: 0,
    label: '散射砲', glyph: 'S', role: '近距擴張',
    description: '一次扇形噴三發，近距離快速鋪面，但血薄、射程短。',
  },
  sniper: {
    cost: 220, maxHp: 30,
    shootInterval: 80, range: 6, bulletSpeed: 0.9,
    towerDamage: 45, splashRadius: 0,
    spreadCount: 1, spreadAngleDeg: 0,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0, healRange: 0,
    pierce: true, fixedFireRate: true,
    label: '狙擊砲', glyph: 'N', role: '遠程拆塔',
    description: '單發高傷的位置型精準拆塔手：造價高、射程中等，無法鋪成一整排。子彈飛越地形、只對敵塔造成傷害（不染色），但會被敵方護牆擋下。固定每 4 秒一發，射速不隨升級或加速器加快（升級只加傷害/射程/血量）。多把會分散鎖定不同目標，怕護牆、肉盾與誘餌。',
  },
  artillery: {
    cost: 150, maxHp: 60,
    shootInterval: 110, range: 12, bulletSpeed: 0.45,
    towerDamage: 32, splashRadius: 1.1,
    spreadCount: 1, spreadAngleDeg: 0,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0, healRange: 0,
    label: '榴彈砲', glyph: 'A', role: '遠程攻城',
    description: '全場最遠射程＋高拆塔傷害，隔空狙殺敵方砲台，但爆炸染色範圍很小、射速慢、血薄。',
  },
  splash: {
    cost: 210, maxHp: 75,
    shootInterval: 80, range: 6, bulletSpeed: 0.3,
    towerDamage: 10, splashRadius: 2.3,
    spreadCount: 1, spreadAngleDeg: 0,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0, healRange: 0,
    label: '範圍砲', glyph: 'P', role: '範圍翻盤',
    description: '命中點大範圍一次染色，適合近距離大面積翻盤，但又貴又脆、射程短、幾乎不能拆塔。',
  },
  flak: {
    cost: 240, maxHp: 70,
    shootInterval: 220, range: 16, bulletSpeed: 0.35,
    towerDamage: 22, splashRadius: 1.5,
    spreadCount: 1, spreadAngleDeg: 0,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0, healRange: 0,
    lob: true,
    label: '高射砲', glyph: 'F', role: '後排轟炸',
    description: '拋射砲彈越過領地與牆壁，隨機砸向敵方領地並範圍染色。射程極遠，但極慢、又貴、血薄。',
  },
  wallgen: {
    cost: 200, maxHp: 100,
    shootInterval: 0, range: 0, bulletSpeed: 0,
    towerDamage: 0, splashRadius: 0,
    spreadCount: 0, spreadAngleDeg: 0,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0, healRange: 0,
    wallHp: 150, wallRegen: 300, wallSpan: 2,
    label: '護牆塔', glyph: 'W', role: '生成護牆',
    description: '不發射。在周圍生成一圈 5×5 護牆攔截敵方子彈（自己的子彈可穿過），可延伸到中立或敵方領地。護牆只是護盾、不佔地也不算領地，你仍可在牆格上蓋塔。共用血量、不自動回血，被打爆消失後要等 15 秒才重建。高射砲可越頂無視它。',
  },
  support: {
    cost: 95, maxHp: 120,
    shootInterval: 0, range: 0, bulletSpeed: 0,
    towerDamage: 0, splashRadius: 0,
    spreadCount: 0, spreadAngleDeg: 0,
    supportRange: 2.5, speedBoost: 0.35,
    healPerTick: 0, healRange: 0,
    label: '加速器', glyph: 'U', role: '輔助加速',
    description: '不發射。提升周圍友方砲台射速 +35%（最多兩台疊加、上限 ×1.7），放在砲台群中央效果最好。',
  },
  repair: {
    cost: 100, maxHp: 110,
    shootInterval: 0, range: 0, bulletSpeed: 0,
    towerDamage: 0, splashRadius: 0,
    spreadCount: 0, spreadAngleDeg: 0,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0.5, healRange: 2.5,
    label: '維修車', glyph: '+', role: '維修補血',
    description: '不發射。持續修復周圍友方砲台的血量，讓前線砲台更耐打。',
  },
  money: {
    cost: 120, maxHp: 60,
    shootInterval: 0, range: 0, bulletSpeed: 0,
    towerDamage: 0, splashRadius: 0,
    spreadCount: 0, spreadAngleDeg: 0,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0, healRange: 0,
    incomePerSec: 6,
    label: '金錢塔', glyph: '$', role: '經濟生產',
    description: '不發射。運作時每秒額外產出 $6，約 20 秒回本。血薄，要放在後方保護。',
  },
  jammer: {
    cost: 180, maxHp: 60,
    shootInterval: 300, range: 14, bulletSpeed: 0.4,
    towerDamage: 0, splashRadius: 1.8,
    spreadCount: 1, spreadAngleDeg: 0,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0, healRange: 0,
    lob: true, slowFactor: 0.2, slowDuration: 60,
    label: '干擾砲', glyph: 'J', role: '投射干擾',
    description: '拋射越頂干擾彈，落點 3×3 使敵方砲台射速 -20% 持續 3 秒。自身 15 秒一發、不造成傷害，無法全場覆蓋。',
  },
  sacrifice: {
    cost: 60, maxHp: 70,
    shootInterval: 0, range: 0, bulletSpeed: 0,
    towerDamage: 0, splashRadius: 4.5,
    spreadCount: 0, spreadAngleDeg: 0,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0, healRange: 0,
    sacrifice: true, sacrificeHpPercent: 0.5,
    label: '獻祭砲', glyph: 'X', role: '犧牲蓄能',
    description: '當八個相鄰格都是己方砲台時，吞噬這 8 座砲台並「蓄能」——自身變成發光核彈。之後點選它、再點地圖任意處即可投擲，大範圍染色並對敵方砲台造成其最大血量 50% 的傷害（不會整片直接清塔）。超便宜，建議搭配基礎砲當祭品。',
  },
  bomb: {
    cost: 70, maxHp: 0,
    shootInterval: 0, range: 0, bulletSpeed: 0,
    towerDamage: 50, splashRadius: 1.5,
    spreadCount: 0, spreadAngleDeg: 0,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0, healRange: 0,
    active: true,
    label: '炸彈', glyph: '*', role: '主動空襲',
    description: '主動技：選取後可點地圖上「任意」格子，花 $70 立即在該處 3×3 造成傷害與染色。有 10 秒冷卻，不能連續轟炸。不佔格、無實體。',
  },
  octopus: {
    cost: 110, maxHp: 60,
    shootInterval: 55, range: 5, bulletSpeed: 0.45,
    towerDamage: 8, splashRadius: 0,
    spreadCount: 1, spreadAngleDeg: 0,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0, healRange: 0,
    octopus: true,
    label: '章魚砲', glyph: 'O', role: '八方齊射',
    description: '一次朝八個方向各射一發染色彈，自衛與鋪面兼具，但每個方向火力都不強。',
  },
  summon: {
    cost: 160, maxHp: 90,
    shootInterval: 0, range: 0, bulletSpeed: 0,
    towerDamage: 0, splashRadius: 0,
    spreadCount: 0, spreadAngleDeg: 0,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0, healRange: 0,
    summonInterval: 160,
    upgradeCostRatio: 1, // full-price upgrades:升級後召喚的基礎砲直接同級
    label: '召喚塔', glyph: 'M', role: '召喚增援',
    description: '不攻擊。每 8 秒在旁邊的己方空格召喚一座基礎砲，慢慢鋪出砲海。本體被拆就停止召喚。升級後召喚出的基礎砲會直接是同等級（升級為原價）。',
  },
  magnet: {
    cost: 130, maxHp: 200,
    shootInterval: 0, range: 0, bulletSpeed: 0,
    towerDamage: 0, splashRadius: 0,
    spreadCount: 0, spreadAngleDeg: 0,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0, healRange: 0,
    magnetRange: 4,
    label: '磁力塔', glyph: 'G', role: '吸引肉盾',
    description: '不發射。把附近飛來的敵方子彈吸到自己身上，當肉盾保護後排砲台。高血量，搭配維修車超耐。',
  },
  decoy: {
    cost: 40, maxHp: 180,
    shootInterval: 0, range: 0, bulletSpeed: 0,
    towerDamage: 0, splashRadius: 0,
    spreadCount: 0, spreadAngleDeg: 0,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0, healRange: 0,
    decoy: true,
    label: '誘餌塔', glyph: 'D', role: '嘲諷誘餌',
    description: '不發射。便宜又高血，敵方狙擊砲會優先打它，幫真正的砲台吸火。',
  },
  tesla: {
    cost: 200, maxHp: 70,
    shootInterval: 40, range: 4, bulletSpeed: 0,
    towerDamage: 7, splashRadius: 0,
    spreadCount: 0, spreadAngleDeg: 0,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0, healRange: 0,
    chainCount: 3,
    label: '電磁塔', glyph: 'T', role: '連鎖電擊',
    description: '每 2 秒瞬間放電，同時電擊射程內最近的 3 座敵方砲台（不染色）。專打擠成一團的敵方陣型，但射程短、血薄，且電擊會被敵方護牆擋住視線（牆後的敵塔電不到），要放在前線並保護好。',
  },
  enchant: {
    cost: 170, maxHp: 90,
    shootInterval: 0, range: 0, bulletSpeed: 0,
    towerDamage: 0, splashRadius: 0,
    spreadCount: 0, spreadAngleDeg: 0,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0, healRange: 0,
    enchantInterval: 200, enchantRange: 3, noUpgrade: true,
    label: '附魔塔', glyph: 'E', role: '隨機強化',
    description: '不攻擊。每 10 秒隨機把周圍一座友方砲台升一級。自身無法被升級，需要保護。',
  },
};

// Cost to upgrade one level of the given tower. Most towers pay half their base
// cost; those with an upgradeCostRatio override (召喚塔) pay a different rate.
export function upgradeCostFor(cfg: TowerConfig): number {
  return Math.floor(cfg.cost * (cfg.upgradeCostRatio ?? UPGRADE_COST_RATIO));
}
