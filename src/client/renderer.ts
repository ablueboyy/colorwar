import type { GameState, PlayerId, Tower, TowerType } from '../shared/types';
import { BOARD_WIDTH, BOARD_HEIGHT, TOWER_CONFIGS, LEVEL_MULTS } from '../shared/config';

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
  // Smoothly-interpolated facing angle per tower, so turrets visibly rotate
  // toward their authoritative aim rather than snapping each STATE.
  private displayAngles = new Map<string, number>();

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
    selectedTowerId: string | null,
  ): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    this.drawBoard(state, myId, selectedTower, hovered);
    this.drawRangeCircles(state, selectedTowerId);
    this.drawTowers(state, myId, selectedTowerId);
    this.drawProjectiles(state);

    if (state.phase === 'ended') this.drawEndOverlay(state);
  }

  private drawRangeCircles(state: GameState, selectedTowerId: string | null): void {
    for (const t of state.towers) {
      if (t.type === 'support' || t.type === 'repair' || t.id === selectedTowerId) {
        this.drawRangeCircle(t);
      }
    }
  }

  private drawRangeCircle(tower: Tower): void {
    const ctx = this.ctx;
    const S = CELL_SIZE;
    const cfg = TOWER_CONFIGS[tower.type];
    const m = LEVEL_MULTS[tower.level - 1] ?? LEVEL_MULTS[0];
    const baseRange = Math.max(cfg.range, cfg.supportRange, cfg.healRange);
    const effRange = baseRange * m.range;
    if (effRange <= 0) return;

    const cx = (tower.x + 0.5) * S;
    const cy = (tower.y + 0.5) * S;
    const p1 = tower.owner === 'p1';

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, effRange * S, 0, Math.PI * 2);
    ctx.fillStyle = p1 ? 'rgba(59,130,246,0.07)' : 'rgba(239,68,68,0.07)';
    ctx.fill();
    ctx.strokeStyle = p1 ? 'rgba(147,197,253,0.45)' : 'rgba(252,165,165,0.45)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
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

  private drawTowers(state: GameState, myId: PlayerId | null, selectedTowerId: string | null): void {
    const ctx = this.ctx;
    const S = CELL_SIZE;

    for (const tower of state.towers) {
      const px = tower.x * S;
      const py = tower.y * S;
      const active = tower.active;
      const isOwn = tower.owner === myId;
      const p1 = tower.owner === 'p1';
      const isSelected = tower.id === selectedTowerId;

      const dark = !active ? '#2d3748' : p1 ? '#1e3a8a' : '#7f1d1d';
      const mid  = !active ? '#4a5568' : p1 ? '#2563eb' : '#dc2626';
      const lite = !active ? '#718096' : p1 ? '#93c5fd' : '#fca5a5';

      // Only towers that actually fire rotate to face their aim; walls,
      // support and repair stay upright. UI overlays never rotate.
      const rotates = TOWER_CONFIGS[tower.type].shootInterval > 0;
      ctx.save();
      if (rotates) {
        const ang = this.smoothAngle(tower.id, tower.aim);
        ctx.translate(px + S / 2, py + S / 2);
        ctx.rotate(ang + Math.PI / 2);
        ctx.translate(-S / 2, -S / 2);
      } else {
        ctx.translate(px, py);
      }
      this.drawTowerSprite(ctx, tower.type, S, dark, mid, lite);
      ctx.restore();

      // ── Overlays (always upright) ──
      ctx.save();
      ctx.translate(px, py);

      // Selection outline
      if (isSelected) {
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, S - 2, S - 2);
      }

      // Level pips (L2 = 1 pip, L3 = 2 pips)
      for (let i = 0; i < tower.level - 1; i++) {
        ctx.fillStyle = '#facc15';
        ctx.fillRect(3 + i * 5, 2, 4, 4);
      }

      // HP bar
      const hp = tower.hp / tower.maxHp;
      const bw = S - 6;
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(3, S - 6, bw, 4);
      ctx.fillStyle = hp > 0.6 ? '#22c55e' : hp > 0.3 ? '#eab308' : '#ef4444';
      ctx.fillRect(3, S - 6, Math.round(bw * hp), 4);

      // Own-tower dot
      if (isOwn && !isSelected) {
        ctx.fillStyle = lite;
        ctx.fillRect(S - 5, 2, 3, 3);
      }

      ctx.restore();
    }

    // Drop angle state for towers that no longer exist.
    if (this.displayAngles.size > state.towers.length + 16) {
      const live = new Set(state.towers.map(t => t.id));
      for (const id of this.displayAngles.keys()) {
        if (!live.has(id)) this.displayAngles.delete(id);
      }
    }
  }

  // Rotate the displayed angle a fraction of the way toward the target each
  // frame, taking the shorter way around the circle.
  private smoothAngle(id: string, target: number): number {
    const cur = this.displayAngles.get(id);
    if (cur === undefined) { this.displayAngles.set(id, target); return target; }
    let diff = target - cur;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // normalize to [-PI, PI]
    const next = cur + diff * 0.25;
    this.displayAngles.set(id, next);
    return next;
  }

  private drawTowerSprite(
    ctx: CanvasRenderingContext2D,
    type: TowerType,
    S: number,
    dark: string,
    mid: string,
    lite: string,
  ): void {
    const GD = '#1e293b'; // gun metal dark
    const GM = '#334155'; // gun metal mid
    const GL = '#4a5568'; // gun metal light
    const WH = '#f8fafc'; // white highlight

    const r = (x: number, y: number, w: number, h: number, c: string) => {
      ctx.fillStyle = c;
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    };

    switch (type) {
      case 'basic': {
        // Wide base with side ports + single center barrel
        r(5, 13, 20, 9, dark);
        r(6, 14, 18, 7, mid);
        r(8, 15, 5, 4, dark);     // left port
        r(17, 15, 5, 4, dark);    // right port
        r(12, 3, 6, 12, GD);      // barrel
        r(13, 4, 4, 10, GM);
        r(13, 4, 2, 8, GL);
        r(11, 2, 8, 3, GM);       // muzzle cap
        r(11, 2, 8, 1, GL);
        break;
      }
      case 'rapid': {
        // Narrow base + twin thin barrels
        r(7, 15, 16, 7, dark);
        r(8, 16, 14, 5, mid);
        r(13, 9, 4, 8, dark);     // center link
        r(8, 4, 4, 14, GD);       // left barrel
        r(9, 5, 2, 12, GL);
        r(7, 3, 5, 3, GM);        // left muzzle
        r(18, 4, 4, 14, GD);      // right barrel
        r(19, 5, 2, 12, GL);
        r(18, 3, 5, 3, GM);       // right muzzle
        break;
      }
      case 'spread': {
        // Very wide base + three barrels fanning out
        r(3, 15, 24, 7, dark);
        r(4, 16, 22, 5, mid);
        r(13, 5, 4, 12, GD);      // center barrel
        r(14, 6, 2, 10, GL);
        ctx.save();               // left barrel (angled)
        ctx.translate(9, 16);
        ctx.rotate(-0.52);
        r(-2, -12, 4, 12, GD);
        r(-1, -11, 2, 10, GL);
        ctx.restore();
        ctx.save();               // right barrel (angled)
        ctx.translate(21, 16);
        ctx.rotate(0.52);
        r(-2, -12, 4, 12, GD);
        r(-1, -11, 2, 10, GL);
        ctx.restore();
        break;
      }
      case 'sniper': {
        // Small base + ultra-long thin barrel + scope
        r(9, 16, 12, 6, dark);
        r(10, 17, 10, 4, mid);
        r(14, 1, 2, 17, GD);      // ultra-long barrel
        r(14, 2, 1, 15, GL);
        r(8, 6, 14, 4, GD);       // scope body
        r(9, 7, 12, 2, GM);
        r(13, 7, 4, 2, GL);       // scope lens
        r(13, 1, 4, 2, GM);       // muzzle
        r(13, 0, 2, 2, GL);
        break;
      }
      case 'artillery': {
        // Heavy wide base with treads + short wide barrel
        r(3, 14, 24, 8, dark);
        r(4, 15, 22, 6, mid);
        r(2, 18, 5, 4, GD);       // left tread
        r(23, 18, 5, 4, GD);      // right tread
        r(3, 19, 3, 2, GL);
        r(24, 19, 3, 2, GL);
        r(8, 5, 14, 10, GD);      // short wide barrel
        r(9, 6, 12, 8, GM);
        r(9, 6, 5, 5, GL);
        r(6, 3, 18, 4, GM);       // wide muzzle
        r(7, 4, 16, 2, GL);
        break;
      }
      case 'splash': {
        // Round body + wide mortar barrel
        ctx.beginPath();
        ctx.arc(15, 16, 9, 0, Math.PI * 2);
        ctx.fillStyle = dark; ctx.fill();
        ctx.beginPath();
        ctx.arc(15, 16, 7, 0, Math.PI * 2);
        ctx.fillStyle = mid; ctx.fill();
        ctx.beginPath();          // ring detail
        ctx.arc(15, 16, 5, 0, Math.PI * 2);
        ctx.strokeStyle = lite; ctx.lineWidth = 1; ctx.stroke();
        r(10, 3, 10, 8, GD);     // wide barrel
        r(11, 4, 8, 6, GM);
        r(11, 4, 4, 3, GL);
        r(8, 1, 14, 4, GM);      // wide muzzle
        r(9, 2, 12, 2, GL);
        break;
      }
      case 'flak': {
        // Boxy carriage + long high-angle barrel pointing up
        r(6, 16, 18, 8, dark);
        r(7, 17, 16, 6, mid);
        r(3, 20, 5, 3, GD);       // left outrigger
        r(22, 20, 5, 3, GD);      // right outrigger
        r(10, 12, 10, 6, GM);     // breech block
        r(13, 1, 4, 16, GD);      // long barrel
        r(14, 2, 2, 14, GL);
        r(11, 0, 8, 3, GM);       // muzzle brake
        r(11, 0, 8, 1, GL);
        break;
      }
      case 'wall': {
        // Brick wall — staggered courses, ownership-tinted
        r(2, 5, 26, 20, dark);
        r(3, 6, 24, 18, mid);
        r(3, 6, 24, 1, lite);     // top highlight
        // horizontal mortar lines
        r(3, 12, 24, 2, dark);
        r(3, 18, 24, 2, dark);
        // staggered vertical seams
        r(15, 6, 2, 6, dark);
        r(9, 14, 2, 4, dark);
        r(21, 14, 2, 4, dark);
        r(15, 20, 2, 4, dark);
        break;
      }
      case 'support': {
        // Square body + yellow lightning bolt + side energy bars
        r(4, 4, 22, 18, dark);
        r(5, 5, 20, 16, mid);
        r(3, 7, 2, 12, lite);    // left energy bar
        r(25, 7, 2, 12, lite);   // right energy bar
        r(3, 8, 1, 10, WH);
        r(26, 8, 1, 10, WH);
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();          // lightning bolt (outer)
        ctx.moveTo(16, 7);
        ctx.lineTo(12, 15); ctx.lineTo(15, 15);
        ctx.lineTo(14, 21);
        ctx.lineTo(19, 13); ctx.lineTo(16, 13);
        ctx.lineTo(19, 7);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#fde68a';
        ctx.beginPath();          // lightning bolt (inner highlight)
        ctx.moveTo(16, 8);
        ctx.lineTo(13, 14); ctx.lineTo(15, 14);
        ctx.lineTo(14, 19);
        ctx.lineTo(18, 13); ctx.lineTo(16, 13);
        ctx.lineTo(18, 8);
        ctx.closePath(); ctx.fill();
        break;
      }
      case 'repair': {
        // Square body + white medical cross
        r(4, 4, 22, 18, dark);
        r(5, 5, 20, 16, mid);
        r(6, 6, 4, 4, dark);     // corner accents
        r(20, 6, 4, 4, dark);
        r(6, 18, 4, 2, dark);
        r(20, 18, 4, 2, dark);
        r(12, 8, 6, 10, WH);    // cross vertical
        r(8, 11, 14, 4, WH);    // cross horizontal
        r(13, 9, 4, 8, '#bfdbfe');  // cross inner highlight
        r(9, 12, 12, 2, '#bfdbfe');
        break;
      }
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
