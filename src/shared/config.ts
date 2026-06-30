import type { TowerType } from './types';

export const BOARD_WIDTH = 24;
export const BOARD_HEIGHT = 16;
export const TICK_RATE = 20;
export const TICK_INTERVAL_MS = 1000 / TICK_RATE;
export const GAME_DURATION = 180;
export const KO_THRESHOLD = 0.8;

export const MAX_TOWER_LEVEL = 3;
export const UPGRADE_COST_RATIO = 0.5;
export const LEVEL_MULTS: { range: number; speed: number; dmg: number; hp: number }[] = [
  { range: 1.0,  speed: 1.0,  dmg: 1.0,  hp: 1.0 },
  { range: 1.2,  speed: 1.35, dmg: 1.4,  hp: 1.5 },
  { range: 1.45, speed: 1.8,  dmg: 1.85, hp: 2.2 },
];

export const BASE_INCOME_PER_SECOND = 8;
export const CELL_INCOME_PER_SECOND = 0.07;
export const CELL_INCOME_CAP = 22;
export const SELL_REFUND_RATIO = 0.5;

export const INITIAL_P1_COLS = 3;
export const INITIAL_P2_COLS = 3;
export const STARTING_MONEY = 100;

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
  lob?: boolean; // shells fly over territory and detonate at the target (高射砲)
  wallHp?: number;    // 護牆塔: shared HP pool of the generated wall ring
  wallRegen?: number; // 護牆塔: ticks between full regenerations
  wallSpan?: number;  // 護牆塔: half-size of the square ring (2 → 5×5)
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
    shootInterval: 34, range: 4, bulletSpeed: 0.45,
    towerDamage: 8, splashRadius: 0,
    spreadCount: 3, spreadAngleDeg: 22,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0, healRange: 0,
    label: '散射砲', glyph: 'S', role: '近距擴張',
    description: '一次扇形噴三發，近距離快速鋪面，但血薄、射程短。',
  },
  sniper: {
    cost: 120, maxHp: 40,
    shootInterval: 65, range: 11, bulletSpeed: 0.9,
    towerDamage: 45, splashRadius: 0,
    spreadCount: 1, spreadAngleDeg: 0,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0, healRange: 0,
    label: '狙擊砲', glyph: 'N', role: '遠程拆塔',
    description: '超長射程，優先狙擊敵方砲台，高傷害但染色弱。專拆對方陣型。',
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
    cost: 200, maxHp: 75,
    shootInterval: 80, range: 6, bulletSpeed: 0.3,
    towerDamage: 10, splashRadius: 2.3,
    spreadCount: 1, spreadAngleDeg: 0,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0, healRange: 0,
    label: '範圍砲', glyph: 'P', role: '範圍翻盤',
    description: '命中點大範圍一次染色，適合近距離大面積翻盤，但又貴又脆、射程短、幾乎不能拆塔。',
  },
  flak: {
    cost: 260, maxHp: 70,
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
    wallHp: 220, wallRegen: 200, wallSpan: 2,
    label: '護牆塔', glyph: 'W', role: '生成護牆',
    description: '不發射。每 10 秒在周圍生成一圈 5×5 護牆攔截敵方子彈（自己的子彈可穿過）；護牆有共用血量，被打爆會暫時消失，下次週期再重建。高射砲可越頂無視它。',
  },
  support: {
    cost: 95, maxHp: 120,
    shootInterval: 0, range: 0, bulletSpeed: 0,
    towerDamage: 0, splashRadius: 0,
    spreadCount: 0, spreadAngleDeg: 0,
    supportRange: 2.5, speedBoost: 0.5,
    healPerTick: 0, healRange: 0,
    label: '加速器', glyph: 'U', role: '輔助加速',
    description: '不發射。提升周圍友方砲台的射速，放在砲台群中央效果最好。',
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
};
