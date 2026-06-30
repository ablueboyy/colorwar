export type PlayerId = 'p1' | 'p2';
export type CellColor = 'neutral' | PlayerId;
export type TowerType =
  | 'basic' | 'rapid' | 'spread' | 'sniper'
  | 'artillery' | 'splash' | 'support' | 'repair';
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
}

export interface PlayerState {
  id: PlayerId;
  money: number;
  cells: number;
}

export interface GameState {
  board: CellColor[][];
  towers: Tower[];
  projectiles: Projectile[];
  players: { p1: PlayerState; p2: PlayerState };
  tick: number;
  timeLeft: number;
  phase: GamePhase;
  winner: PlayerId | 'draw' | null;
}

export type ClientMessage =
  | { type: 'CREATE_ROOM' }
  | { type: 'JOIN_ROOM'; code: string }
  | { type: 'PLACE_TOWER'; towerType: TowerType; x: number; y: number }
  | { type: 'SELL_TOWER'; towerId: string }
  | { type: 'UPGRADE_TOWER'; towerId: string };

export type ServerMessage =
  | { type: 'ROOM_CREATED'; code: string; playerId: PlayerId }
  | { type: 'ROOM_JOINED'; code: string; playerId: PlayerId }
  | { type: 'WAITING_FOR_OPPONENT' }
  | { type: 'GAME_START'; state: GameState; playerId: PlayerId }
  | { type: 'STATE'; state: GameState }
  | { type: 'GAME_OVER'; winner: PlayerId | 'draw'; finalState: GameState }
  | { type: 'ERROR'; message: string };
