export type PlayerId = 'p1' | 'p2';
export type CellColor = 'neutral' | PlayerId;
// Static per-cell terrain (set at match start from the chosen map). 'rock' is an
// impassable obstacle: can't be painted or built on, and blocks bullets.
export type TerrainType = 'normal' | 'rock';
export type TowerType =
  | 'basic' | 'rapid' | 'spread' | 'sniper'
  | 'artillery' | 'splash' | 'flak' | 'wallgen'
  | 'support' | 'repair'
  | 'money' | 'jammer' | 'sacrifice' | 'bomb' | 'octopus'
  | 'summon' | 'magnet' | 'decoy' | 'tesla' | 'enchant';
export type GamePhase = 'waiting' | 'playing' | 'ended';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface Tower {
  id: string;
  owner: PlayerId;
  type: TowerType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  cooldown: number;
  active: boolean;
  level: number;
  aim: number; // radians, atan2(dy,dx) toward current target; sprite's natural orientation is "up"
  slow: number; // ticks of remaining fire-rate slow (干擾砲); 0 = normal
  charged?: boolean; // 獻祭砲: swallowed its 8 neighbours and is armed as a draggable nuke
}

// Short-lived visual effect (jammer field / sacrifice blast) that the client
// animates. Purely cosmetic but lives in shared state so both players see it.
export interface Effect {
  id: string;
  kind: 'jammer' | 'nuke' | 'blast' | 'zap';
  x: number;
  y: number;
  radius: number;
  ttl: number;    // ticks remaining
  maxTtl: number; // ticks it started with (for fade)
  owner: PlayerId;
  // 電磁塔 zap: the bolt's far end (the tower it struck).
  tx?: number;
  ty?: number;
}

export interface Projectile {
  id: string;
  owner: PlayerId;
  towerType: TowerType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  towerDamage: number;
  splashRadius: number;
  lifetime: number;
  // Lobbed shells (高射砲) fly over everything and only detonate at (tx, ty).
  lob?: boolean;
  tx?: number;
  ty?: number;
}

export interface PlayerState {
  id: PlayerId;
  money: number;
  cells: number;
  bombCooldown: number; // ticks until 炸彈 can be used again (0 = ready)
}

// A protective wall ring spawned by a 護牆塔 (wallgen). Shares one HP pool;
// when hp hits 0 the ring vanishes (cells emptied) until the next regen tick.
export interface Barrier {
  id: string;
  owner: PlayerId;
  ownerId: string; // generator tower id
  cells: { x: number; y: number }[];
  hp: number;
  maxHp: number;
  regen: number; // ticks until next full regeneration
}

export interface GameState {
  board: CellColor[][];
  terrain: TerrainType[][];
  towers: Tower[];
  projectiles: Projectile[];
  barriers: Barrier[];
  effects: Effect[];
  players: { p1: PlayerState; p2: PlayerState };
  tick: number;
  timeLeft: number;
  phase: GamePhase;
  winner: PlayerId | 'draw' | null;
}

export type ClientMessage =
  | { type: 'CREATE_ROOM'; loadout: TowerType[]; mapId?: string }
  | { type: 'CREATE_SOLO'; loadout: TowerType[]; difficulty?: Difficulty; mapId?: string }
  | { type: 'JOIN_ROOM'; code: string; loadout: TowerType[] }
  | { type: 'REJOIN_ROOM'; code: string; playerId: PlayerId }
  | { type: 'PLACE_TOWER'; towerType: TowerType; x: number; y: number }
  | { type: 'SELL_TOWER'; towerId: string }
  | { type: 'UPGRADE_TOWER'; towerId: string }
  | { type: 'BOMB'; x: number; y: number }
  | { type: 'DETONATE'; towerId: string; x: number; y: number }; // fire a charged 獻祭砲

export type ServerMessage =
  | { type: 'ROOM_CREATED'; code: string; playerId: PlayerId }
  | { type: 'ROOM_JOINED'; code: string; playerId: PlayerId }
  | { type: 'WAITING_FOR_OPPONENT' }
  | { type: 'GAME_START'; state: GameState; playerId: PlayerId }
  | { type: 'STATE'; state: GameState }
  // Opponent dropped mid-match; a grace timer is running for them to rejoin.
  | { type: 'OPPONENT_DISCONNECTED'; graceMs: number }
  // Opponent rebound their socket within the grace window.
  | { type: 'OPPONENT_RECONNECTED' }
  | { type: 'GAME_OVER'; winner: PlayerId | 'draw'; finalState: GameState; reason?: 'forfeit' }
  | { type: 'ERROR'; message: string };
