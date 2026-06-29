import type { TowerType } from './types';

export const BOARD_WIDTH = 24;
export const BOARD_HEIGHT = 16;
export const TICK_RATE = 20;
export const TICK_INTERVAL_MS = 1000 / TICK_RATE;
export const GAME_DURATION = 180;
export const KO_THRESHOLD = 0.8;

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
  label: string;
  glyph: string;
  role: string;
  description: string;
}

// 順序即為下方面板按鈕的排列順序
export const TOWER_CONFIGS: Record<TowerType, TowerConfig> = {
  basic: {
    cost: 50, maxHp: 100,
    shootInterval: 40, range: 6, bulletSpeed: 0.4,
    towerDamage: 20, splashRadius: 0,
    spreadCount: 1, spreadAngleDeg: 0,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0, healRange: 0,
    label: '基礎砲', glyph: 'B', role: '通用前線',
    description: '便宜耐用的全能砲，單發染一格。資金不足時的好起手。',
  },
  rapid: {
    cost: 90, maxHp: 70,
    shootInterval: 11, range: 5, bulletSpeed: 0.5,
    towerDamage: 6, splashRadius: 0,
    spreadCount: 1, spreadAngleDeg: 0,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0, healRange: 0,
    label: '連射砲', glyph: 'R', role: '快速推進',
    description: '射速極快、單發傷害低，靠數量快速把附近地板染成自己的顏色。',
  },
  spread: {
    cost: 80, maxHp: 60,
    shootInterval: 28, range: 4, bulletSpeed: 0.45,
    towerDamage: 10, splashRadius: 0,
    spreadCount: 3, spreadAngleDeg: 22,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0, healRange: 0,
    label: '散射砲', glyph: 'S', role: '近距擴張',
    description: '一次扇形噴三發，近距離快速鋪面，但血薄、射程短。',
  },
  sniper: {
    cost: 130, maxHp: 50,
    shootInterval: 55, range: 13, bulletSpeed: 0.9,
    towerDamage: 55, splashRadius: 0,
    spreadCount: 1, spreadAngleDeg: 0,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0, healRange: 0,
    label: '狙擊砲', glyph: 'N', role: '遠程拆塔',
    description: '超長射程，優先狙擊敵方砲台，高傷害但染色弱。專拆對方陣型。',
  },
  artillery: {
    cost: 180, maxHp: 80,
    shootInterval: 100, range: 11, bulletSpeed: 0.35,
    towerDamage: 25, splashRadius: 2.2,
    spreadCount: 1, spreadAngleDeg: 0,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0, healRange: 0,
    label: '榴彈砲', glyph: 'A', role: '遠程砲擊',
    description: '遠射程＋大範圍爆炸染色，射速很慢。隔空轟炸對方深處領地。',
  },
  splash: {
    cost: 200, maxHp: 100,
    shootInterval: 80, range: 7, bulletSpeed: 0.3,
    towerDamage: 18, splashRadius: 1.8,
    spreadCount: 1, spreadAngleDeg: 0,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0, healRange: 0,
    label: '範圍砲', glyph: 'P', role: '範圍翻盤',
    description: '命中點 3x3 範圍一次染色，適合大面積翻盤，但又貴又慢。',
  },
  support: {
    cost: 100, maxHp: 150,
    shootInterval: 0, range: 0, bulletSpeed: 0,
    towerDamage: 0, splashRadius: 0,
    spreadCount: 0, spreadAngleDeg: 0,
    supportRange: 3, speedBoost: 0.6,
    healPerTick: 0, healRange: 0,
    label: '加速器', glyph: 'U', role: '輔助加速',
    description: '不發射。提升周圍友方砲台的射速，放在砲台群中央效果最好。',
  },
  repair: {
    cost: 110, maxHp: 140,
    shootInterval: 0, range: 0, bulletSpeed: 0,
    towerDamage: 0, splashRadius: 0,
    spreadCount: 0, spreadAngleDeg: 0,
    supportRange: 0, speedBoost: 0,
    healPerTick: 0.6, healRange: 3,
    label: '維修車', glyph: '+', role: '維修補血',
    description: '不發射。持續修復周圍友方砲台的血量，讓前線砲台更耐打。',
  },
};
