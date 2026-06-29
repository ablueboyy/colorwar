import type { GameState, PlayerId, TowerType } from '../shared/types';
import { BOARD_WIDTH, BOARD_HEIGHT, TOWER_CONFIGS } from '../shared/config';

export const CELL_SIZE = 30;
export const CANVAS_W = BOARD_WIDTH * CELL_SIZE;
export const CANVAS_H = BOARD_HEIGHT * CELL_SIZE;

const COLORS = {
  neutral: '#4a5568',
  neutralBorder: '#2d3748',
  p1: '#3b82f6',
  p1Dark: '#1d4ed8',
  p1Border: '#93c5fd',
  p1Proj: '#bfdbfe',
  p2: '#ef4444',
  p2Dark: '#b91c1c',
  p2Border: '#fca5a5',
  p2Proj: '#fecaca',
  towerInactive: '#374151',
};

export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
  }

  draw(
    state: GameState,
    myId: PlayerId | null,
    selectedTower: TowerType | null,
    hovered: { x: number; y: number } | null,
  ): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    this.drawBoard(state, myId, selectedTower, hovered);
    this.drawTowers(state, myId);
    this.drawProjectiles(state);

    if (state.phase === 'ended') this.drawEndOverlay(state);
  }

  private drawBoard(
    state: GameState,
    myId: PlayerId | null,
    selectedTower: TowerType | null,
    hovered: { x: number; y: number } | null,
  ): void {
    const ctx = this.ctx;
    const S = CELL_SIZE;

    for (let y = 0; y < BOARD_HEIGHT; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        const color = state.board[y][x];
        ctx.fillStyle = color === 'neutral' ? COLORS.neutral
          : color === 'p1' ? COLORS.p1
          : COLORS.p2;
        ctx.fillRect(x * S, y * S, S, S);

        // Grid lines
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x * S + 0.5, y * S + 0.5, S - 1, S - 1);
      }
    }

    // Hover placement preview
    if (hovered && myId && selectedTower) {
      const { x, y } = hovered;
      const canPlace = state.board[y]?.[x] === myId
        && !state.towers.some(t => t.x === x && t.y === y);
      ctx.strokeStyle = canPlace ? '#facc15' : '#ef4444';
      ctx.lineWidth = 2;
      ctx.strokeRect(x * S + 1, y * S + 1, S - 2, S - 2);
    }
  }

  private drawTowers(state: GameState, myId: PlayerId | null): void {
    const ctx = this.ctx;
    const S = CELL_SIZE;

    for (const tower of state.towers) {
      const x = tower.x * S, y = tower.y * S;
      const isOwn = tower.owner === myId;
      const bodyColor = !tower.active ? COLORS.towerInactive
        : tower.owner === 'p1' ? COLORS.p1Dark : COLORS.p2Dark;
      const borderColor = !tower.active ? '#6b7280'
        : tower.owner === 'p1' ? COLORS.p1Border : COLORS.p2Border;

      // Body
      ctx.fillStyle = bodyColor;
      ctx.fillRect(x + 3, y + 3, S - 6, S - 10);

      // Border (thicker for own towers)
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = isOwn ? 2 : 1.5;
      ctx.strokeRect(x + 3, y + 3, S - 6, S - 10);

      // Label
      ctx.fillStyle = '#f9fafb';
      ctx.font = `bold 10px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(TOWER_CONFIGS[tower.type].glyph, x + S / 2, y + S / 2 - 3);

      // HP bar
      const hpRatio = tower.hp / tower.maxHp;
      const bw = S - 8;
      ctx.fillStyle = '#111827';
      ctx.fillRect(x + 4, y + S - 8, bw, 5);
      ctx.fillStyle = hpRatio > 0.5 ? '#22c55e' : hpRatio > 0.25 ? '#eab308' : '#ef4444';
      ctx.fillRect(x + 4, y + S - 8, bw * hpRatio, 5);
    }
  }

  private drawProjectiles(state: GameState): void {
    const ctx = this.ctx;
    const S = CELL_SIZE;

    for (const proj of state.projectiles) {
      const px = proj.x * S;
      const py = proj.y * S;
      ctx.fillStyle = proj.owner === 'p1' ? COLORS.p1Proj : COLORS.p2Proj;

      if (proj.splashRadius > 0) {
        // Splash: bigger dot
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(px - 3, py - 3, 6, 6);
      }
    }
  }

  private drawEndOverlay(state: GameState): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const w = state.winner;
    const text = w === 'draw' ? 'DRAW!' : w === 'p1' ? 'PLAYER 1 WINS!' : 'PLAYER 2 WINS!';
    const color = w === 'p1' ? COLORS.p1Border : w === 'p2' ? COLORS.p2Border : '#facc15';

    ctx.fillStyle = color;
    ctx.font = 'bold 42px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, CANVAS_W / 2, CANVAS_H / 2);
  }
}
