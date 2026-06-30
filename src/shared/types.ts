export type PlayerId = 'p1' | 'p2';
export type CellColor = 'neutral' | PlayerId;
export type TowerType =
  | 'basic' | 'rapid' | 'spread' | 'sniper'
  | 'artillery' | 'splash' | 'flak' | 'wallgen'
  | 'support' | 'repair'
  | 'money' | 'jammer' | 'sacrifice' | 'bomb' | 'octopus'
  | 'summon' | 'magnet' | 'decoy' | 'banner' | 'enchant';
export type GamePhase = 'waiting' | 'playing' | 'ended';

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
  towers: Tower[];
  projectiles: Projectile[];
  barriers: Barrier[];
  players: { p1: PlayerState; p2: PlayerState };
  tick: number;
  timeLeft: number;
  phase: GamePhase;
  winner: PlayerId | 'draw' | null;
}

export type ClientMessage =
  | { type: 'CREATE_ROOM'; loadout: TowerType[] }
  | { type: 'JOIN_ROOM'; code: string; loadout: TowerType[] }
  | { type: 'PLACE_TOWER'; towerType: TowerType; x: number; y: number }
  | { type: 'SELL_TOWER'; towerId: string }
  | { type: 'UPGRADE_TOWER'; towerId: string }
  | { type: 'BOMB'; x: number; y: number };

export type ServerMessage =
  | { type: 'ROOM_CREATED'; code: string; playerId: PlayerId }
  | { type: 'ROOM_JOINED'; code: string; playerId: PlayerId }
  | { type: 'WAITING_FOR_OPPONENT' }
  | { type: 'GAME_START'; state: GameState; playerId: PlayerId }
  | { type: 'STATE'; state: GameState }
  | { type: 'GAME_OVER'; winner: PlayerId | 'draw'; finalState: GameState }
  | { type: 'ERROR'; message: string };
