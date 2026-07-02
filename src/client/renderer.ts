import type { GameState, PlayerId, Tower, TowerType } from '../shared/types';
import { BOARD_WIDTH, BOARD_HEIGHT, TOWER_CONFIGS, LEVEL_MULTS } from '../shared/config';

export const CELL_SIZE = 24;
export const CANVAS_W = BOARD_WIDTH * CELL_SIZE;
export const CANVAS_H = BOARD_HEIGHT * CELL_SIZE;
// Tower sprites are hand-authored in a 30×30 coordinate space; we scale them to
// the actual CELL_SIZE so the board can change size without redrawing art.
export const SPRITE_UNIT = 30;

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
    armedBlast: { x: number; y: number; radius: number; color?: string } | null = null,
  ): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    this.updateSparks(state);
    this.drawBoard(state, myId, selectedTower, hovered);
    this.drawRangeCircles(state, selectedTowerId);
    this.drawEffects(state);
    this.drawBarriers(state);
    this.drawTowers(state, myId, selectedTowerId);
    this.drawProjectiles(state);
    this.drawSparks();
    if (armedBlast) this.drawArmedBlast(armedBlast);

    if (state.phase === 'ended') this.drawEndOverlay(state);
  }

  // Target preview for an area ability the player is aiming (charged 獻祭砲 in
  // gold, 炸彈 in orange).
  private drawArmedBlast(a: { x: number; y: number; radius: number; color?: string }): void {
    const ctx = this.ctx, S = CELL_SIZE;
    const cx = (a.x + 0.5) * S, cy = (a.y + 0.5) * S;
    const fill = a.color ?? '#fbbf24';
    ctx.save();
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 200);
    ctx.globalAlpha = 0.12 + 0.10 * pulse;
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.arc(cx, cy, a.radius * S, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = fill;
    ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.arc(cx, cy, a.radius * S, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Cosmetic effects: lingering jammer fields and sacrifice nuke flashes.
  private drawEffects(state: GameState): void {
    const ctx = this.ctx, S = CELL_SIZE;
    const now = performance.now();
    for (const e of state.effects) {
      const cx = (e.x + 0.5) * S, cy = (e.y + 0.5) * S;
      const R = e.radius * S;
      const life = e.maxTtl > 0 ? e.ttl / e.maxTtl : 0;
      const p1 = e.owner === 'p1';

      if (e.kind === 'jammer') {
        ctx.save();
        ctx.globalAlpha = 0.10 + 0.05 * Math.sin(now / 180);
        ctx.fillStyle = p1 ? '#3b82f6' : '#ef4444';
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = p1 ? '#93c5fd' : '#fca5a5';
        ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        // orbiting interference particles
        const n = 7;
        ctx.fillStyle = p1 ? '#bfdbfe' : '#fecaca';
        for (let i = 0; i < n; i++) {
          const a = now / 350 + (i * Math.PI * 2) / n;
          const rr = R * (0.35 + 0.6 * (((i * 7) % 5) / 5));
          ctx.globalAlpha = 0.85;
          ctx.fillRect(cx + Math.cos(a) * rr - 1.5, cy + Math.sin(a) * rr - 1.5, 3, 3);
        }
        ctx.restore();
      } else if (e.kind === 'nuke') { // 獻祭砲: big golden shockwave
        ctx.save();
        const grow = 0.3 + 0.7 * (1 - life);
        ctx.globalAlpha = Math.max(0, life);
        ctx.strokeStyle = '#fde68a'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(cx, cy, R * grow, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 0.28 * life;
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath(); ctx.arc(cx, cy, R * grow, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else if (e.kind === 'zap') { // 電磁塔: jagged lightning bolt to its target
        const tx = (e.tx! + 0.5) * S, ty = (e.ty! + 0.5) * S;
        ctx.save();
        const bolt = () => {
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          const segs = 5;
          for (let i = 1; i < segs; i++) {
            const t = i / segs;
            ctx.lineTo(cx + (tx - cx) * t + (Math.random() - 0.5) * 7,
                       cy + (ty - cy) * t + (Math.random() - 0.5) * 7);
          }
          ctx.lineTo(tx, ty); ctx.stroke();
        };
        ctx.globalAlpha = Math.max(0, life);
        ctx.strokeStyle = '#a5f3fc'; ctx.lineWidth = 2.5; bolt();
        ctx.strokeStyle = '#ecfeff'; ctx.lineWidth = 1; bolt(); // bright core
        ctx.restore();
      } else { // blast: quick owner-coloured explosion (splash weapons / 炸彈)
        ctx.save();
        const grow = 0.35 + 0.65 * (1 - life);
        ctx.globalAlpha = 0.5 * life;
        ctx.fillStyle = p1 ? '#93c5fd' : '#fca5a5';
        ctx.beginPath(); ctx.arc(cx, cy, R * grow, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = Math.max(0, life);
        ctx.strokeStyle = '#fef3c7'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, R * grow, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }
  }

  // ── Client-only impact sparks (not synced) ──────────────────────────────────
  // A projectile that vanishes between STATE updates has hit or expired; throw a
  // few short-lived sparks at its last spot so bullets feel like they land.
  private lastProj = new Map<string, { x: number; y: number; owner: PlayerId }>();
  private sparks: { x: number; y: number; vx: number; vy: number; life: number; p1: boolean }[] = [];

  private updateSparks(state: GameState): void {
    const S = CELL_SIZE;
    const alive = new Set(state.projectiles.map(p => p.id));
    for (const [id, p] of this.lastProj) {
      if (alive.has(id)) continue;
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * Math.PI * 2, sp = 0.4 + Math.random() * 1.1;
        this.sparks.push({
          x: p.x * S, y: p.y * S,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 1, p1: p.owner === 'p1',
        });
      }
    }
    this.lastProj.clear();
    for (const p of state.projectiles) this.lastProj.set(p.id, { x: p.x, y: p.y, owner: p.owner });
    if (this.sparks.length > 400) this.sparks.splice(0, this.sparks.length - 400); // safety cap
  }

  private drawSparks(): void {
    const ctx = this.ctx;
    ctx.save();
    for (const s of this.sparks) {
      s.x += s.vx; s.y += s.vy; s.life -= 0.08;
      if (s.life <= 0) continue;
      ctx.globalAlpha = s.life;
      ctx.fillStyle = s.p1 ? '#dbeafe' : '#fee2e2';
      ctx.fillRect(s.x - 1, s.y - 1, 2, 2);
    }
    ctx.restore();
    this.sparks = this.sparks.filter(s => s.life > 0);
  }

  private drawRangeCircles(state: GameState, selectedTowerId: string | null): void {
    for (const t of state.towers) {
      // Aura towers (加速器/維修車/磁力塔) always show their reach; everything
      // else only reveals its range while selected.
      if (t.type === 'support' || t.type === 'repair' || t.type === 'magnet' || t.id === selectedTowerId) {
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
    let effRange = baseRange * m.range;
    // 磁力塔's pull radius is a flat magnetRange (it doesn't scale with level).
    if (cfg.magnetRange) effRange = Math.max(effRange, cfg.magnetRange);
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
        if (state.terrain[y][x] === 'rock') {
          this.drawRock(x * S, y * S, S);
          continue;
        }
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
      const canPlace = TOWER_CONFIGS[selectedTower].active // 炸彈 lands anywhere
        || (state.board[y]?.[x] === myId && state.terrain[y]?.[x] !== 'rock' && !state.towers.some(t => t.x === x && t.y === y));
      ctx.strokeStyle = canPlace ? '#facc15' : '#ef4444';
      ctx.lineWidth = 2;
      ctx.strokeRect(x * S + 1, y * S + 1, S - 2, S - 2);
    }
  }

  // A rock obstacle tile: dark base with a lighter faceted boulder on top.
  private drawRock(x: number, y: number, S: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#18181b';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#3f3f46';
    ctx.beginPath();
    ctx.moveTo(x + S * 0.15, y + S * 0.8);
    ctx.lineTo(x + S * 0.28, y + S * 0.28);
    ctx.lineTo(x + S * 0.62, y + S * 0.16);
    ctx.lineTo(x + S * 0.86, y + S * 0.5);
    ctx.lineTo(x + S * 0.78, y + S * 0.85);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#52525b'; // top-left highlight facet
    ctx.beginPath();
    ctx.moveTo(x + S * 0.28, y + S * 0.28);
    ctx.lineTo(x + S * 0.62, y + S * 0.16);
    ctx.lineTo(x + S * 0.5, y + S * 0.46);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#71717a';
    ctx.fillRect(x + S * 0.34, y + S * 0.3, S * 0.12, S * 0.1);
  }

  private drawBarriers(state: GameState): void {
    const ctx = this.ctx;
    const S = CELL_SIZE;
    const m = 2.5, L = Math.max(4, S * 0.3); // bracket margin + arm length
    for (const b of state.barriers) {
      if (b.cells.length === 0) continue;
      const ratio = b.maxHp > 0 ? b.hp / b.maxHp : 0;
      const p1 = b.owner === 'p1';
      const base = p1 ? '#3b82f6' : '#ef4444';
      const lite = p1 ? '#bfdbfe' : '#fecaca';
      for (const c of b.cells) {
        const x = c.x * S, y = c.y * S;
        // Faint tint only, so the tile colour (and any tower built on it) stays
        // clearly visible — the cell reads as "shielded", not "occupied".
        ctx.globalAlpha = 0.10 + 0.12 * ratio;
        ctx.fillStyle = base;
        ctx.fillRect(x + 1, y + 1, S - 2, S - 2);
        // Corner brackets: a shield frame that leaves the centre open.
        ctx.globalAlpha = 0.5 + 0.4 * ratio;
        ctx.strokeStyle = lite;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + m, y + m + L);       ctx.lineTo(x + m, y + m);         ctx.lineTo(x + m + L, y + m);
        ctx.moveTo(x + S - m - L, y + m);   ctx.lineTo(x + S - m, y + m);     ctx.lineTo(x + S - m, y + m + L);
        ctx.moveTo(x + S - m, y + S - m - L); ctx.lineTo(x + S - m, y + S - m); ctx.lineTo(x + S - m - L, y + S - m);
        ctx.moveTo(x + m + L, y + S - m);   ctx.lineTo(x + m, y + S - m);     ctx.lineTo(x + m, y + S - m - L);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
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

      // Aimed turrets rotate to face their target; radial (章魚砲) and
      // non-firing towers stay upright. UI overlays never rotate.
      const tcfg = TOWER_CONFIGS[tower.type];
      const rotates = tcfg.shootInterval > 0 && !tcfg.octopus;
      ctx.save();
      if (rotates) {
        const ang = this.smoothAngle(tower.id, tower.aim);
        ctx.translate(px + S / 2, py + S / 2);
        ctx.rotate(ang + Math.PI / 2);
        ctx.translate(-S / 2, -S / 2);
      } else {
        ctx.translate(px, py);
      }
      ctx.scale(S / SPRITE_UNIT, S / SPRITE_UNIT); // sprites authored in 30px space
      this.drawTowerSprite(ctx, tower.type, dark, mid, lite);
      ctx.restore();

      // ── Overlays (always upright) ──
      ctx.save();
      ctx.translate(px, py);

      // Charged 獻祭砲: pulsing golden glow so it reads as "armed".
      if (tower.charged) {
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 250);
        ctx.save();
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = 6 + 6 * pulse;
        ctx.globalAlpha = 0.5 + 0.4 * pulse;
        ctx.strokeStyle = '#fde68a';
        ctx.lineWidth = 2;
        ctx.strokeRect(1.5, 1.5, S - 3, S - 3);
        ctx.restore();
      }

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

  // Renders a tower to a small data-URL icon (used for the DOM tower buttons).
  iconDataUrl(type: TowerType, size = 26): string {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.scale(size / SPRITE_UNIT, size / SPRITE_UNIT);
    this.drawTowerSprite(ctx, type, '#1e3a8a', '#2563eb', '#93c5fd');
    return c.toDataURL();
  }

  private drawTowerSprite(
    ctx: CanvasRenderingContext2D,
    type: TowerType,
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
      case 'wallgen': {
        // Shield emitter: hexish core with four corner pylons that "project"
        // the surrounding wall ring.
        r(6, 6, 4, 4, GD);        // corner pylons
        r(20, 6, 4, 4, GD);
        r(6, 20, 4, 4, GD);
        r(20, 20, 4, 4, GD);
        r(7, 7, 2, 2, lite);
        r(21, 7, 2, 2, lite);
        r(7, 21, 2, 2, lite);
        r(21, 21, 2, 2, lite);
        r(9, 9, 12, 12, dark);    // core housing
        r(10, 10, 10, 10, mid);
        r(12, 12, 6, 6, lite);    // emitter lens
        r(13, 13, 4, 4, '#f8fafc');
        break;
      }
      case 'money': {
        // Gold coin with a $ sign
        ctx.beginPath(); ctx.arc(15, 15, 11, 0, Math.PI * 2);
        ctx.fillStyle = '#b45309'; ctx.fill();
        ctx.beginPath(); ctx.arc(15, 15, 9, 0, Math.PI * 2);
        ctx.fillStyle = '#fbbf24'; ctx.fill();
        ctx.beginPath(); ctx.arc(15, 15, 9, 0, Math.PI * 2);
        ctx.strokeStyle = '#fde68a'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#92400e';
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('$', 15, 16);
        break;
      }
      case 'jammer': {
        // Tilted radar dish on a base
        r(9, 18, 12, 6, dark);
        r(10, 19, 10, 4, mid);
        ctx.save();
        ctx.translate(15, 13); ctx.rotate(-0.5);
        ctx.beginPath(); ctx.ellipse(0, 0, 9, 5, 0, 0, Math.PI * 2);
        ctx.fillStyle = GD; ctx.fill();
        ctx.beginPath(); ctx.ellipse(0, 0, 7, 3.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = GL; ctx.fill();
        ctx.restore();
        r(14, 11, 2, 8, GM); // mast
        break;
      }
      case 'sacrifice': {
        // Dark altar with a glowing red core + spikes
        r(6, 14, 18, 10, dark);
        r(7, 15, 16, 8, mid);
        r(8, 10, 3, 5, GD); r(13, 8, 3, 7, GD); r(19, 10, 3, 5, GD); // spikes
        ctx.beginPath(); ctx.arc(15, 17, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#7f1d1d'; ctx.fill();
        ctx.beginPath(); ctx.arc(15, 17, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#ef4444'; ctx.fill();
        ctx.beginPath(); ctx.arc(15, 17, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = '#fecaca'; ctx.fill();
        break;
      }
      case 'bomb': {
        // Round bomb with a lit fuse (fixed colours — it's an item, not a turret)
        ctx.beginPath(); ctx.arc(14, 18, 8, 0, Math.PI * 2); ctx.fillStyle = '#111827'; ctx.fill();
        ctx.beginPath(); ctx.arc(14, 18, 6.5, 0, Math.PI * 2); ctx.fillStyle = '#374151'; ctx.fill();
        ctx.beginPath(); ctx.arc(11.5, 15.5, 2, 0, Math.PI * 2); ctx.fillStyle = '#9ca3af'; ctx.fill(); // gloss
        r(15, 7, 4, 5, '#4b5563'); // fuse cap
        ctx.strokeStyle = '#9ca3af'; ctx.lineWidth = 1.5; // fuse
        ctx.beginPath(); ctx.moveTo(18, 8); ctx.quadraticCurveTo(24, 5, 22, 1); ctx.stroke();
        ctx.beginPath(); ctx.arc(22, 1, 2.6, 0, Math.PI * 2); ctx.fillStyle = '#f59e0b'; ctx.fill(); // spark
        ctx.beginPath(); ctx.arc(22, 1, 1.2, 0, Math.PI * 2); ctx.fillStyle = '#fde68a'; ctx.fill();
        break;
      }
      case 'octopus': {
        // Central hub with 8 short barrels
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          const bx = 15 + Math.cos(a) * 9, by = 15 + Math.sin(a) * 9;
          ctx.save(); ctx.translate(bx, by); ctx.rotate(a);
          r(-1.5, -2, 5, 4, GD);
          ctx.restore();
        }
        ctx.beginPath(); ctx.arc(15, 15, 7, 0, Math.PI * 2);
        ctx.fillStyle = dark; ctx.fill();
        ctx.beginPath(); ctx.arc(15, 15, 5, 0, Math.PI * 2);
        ctx.fillStyle = mid; ctx.fill();
        ctx.beginPath(); ctx.arc(15, 15, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = lite; ctx.fill();
        break;
      }
      case 'summon': {
        // Portal: rings with an up-arrow
        r(6, 6, 18, 18, dark);
        r(7, 7, 16, 16, mid);
        ctx.beginPath(); ctx.arc(15, 15, 7, 0, Math.PI * 2);
        ctx.strokeStyle = lite; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.moveTo(15, 9); ctx.lineTo(20, 16); ctx.lineTo(16.5, 16);
        ctx.lineTo(16.5, 21); ctx.lineTo(13.5, 21); ctx.lineTo(13.5, 16);
        ctx.lineTo(10, 16); ctx.closePath(); ctx.fill();
        break;
      }
      case 'magnet': {
        // Horseshoe magnet (U shape) with red/grey poles
        ctx.fillStyle = '#dc2626';
        ctx.fillRect(6, 6, 6, 14);
        ctx.fillRect(18, 6, 6, 14);
        ctx.fillStyle = '#e5e7eb';
        ctx.fillRect(6, 6, 6, 5);
        ctx.fillRect(18, 6, 6, 5);
        ctx.fillStyle = '#dc2626';
        ctx.fillRect(6, 17, 18, 7); // bottom curve (blocky)
        ctx.fillStyle = '#7f1d1d';
        ctx.fillRect(12, 11, 6, 9); // inner gap shadow
        ctx.fillStyle = dark;
        ctx.fillRect(12, 12, 6, 8);
        break;
      }
      case 'decoy': {
        // Bullseye target dummy
        ctx.beginPath(); ctx.arc(15, 15, 11, 0, Math.PI * 2);
        ctx.fillStyle = '#e5e7eb'; ctx.fill();
        ctx.beginPath(); ctx.arc(15, 15, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#ef4444'; ctx.fill();
        ctx.beginPath(); ctx.arc(15, 15, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#e5e7eb'; ctx.fill();
        ctx.beginPath(); ctx.arc(15, 15, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ef4444'; ctx.fill();
        break;
      }
      case 'tesla': {
        // Tesla coil: tapered coil body + glowing orb throwing sparks
        r(9, 25, 12, 3, dark);   // base
        ctx.fillStyle = mid;     // tapered coil body
        ctx.beginPath();
        ctx.moveTo(11, 24); ctx.lineTo(19, 24); ctx.lineTo(17, 14); ctx.lineTo(13, 14);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = lite; ctx.lineWidth = 1; // coil rings
        for (let yy = 16; yy <= 23; yy += 2) { ctx.beginPath(); ctx.moveTo(12, yy); ctx.lineTo(18, yy); ctx.stroke(); }
        ctx.beginPath(); ctx.arc(15, 11, 5, 0, Math.PI * 2); ctx.fillStyle = '#312e81'; ctx.fill();
        ctx.beginPath(); ctx.arc(15, 11, 4, 0, Math.PI * 2); ctx.fillStyle = '#818cf8'; ctx.fill();
        ctx.beginPath(); ctx.arc(15, 11, 2, 0, Math.PI * 2); ctx.fillStyle = '#e0e7ff'; ctx.fill();
        ctx.strokeStyle = '#67e8f9'; ctx.lineWidth = 1; // electric sparks
        ctx.beginPath();
        ctx.moveTo(15, 6); ctx.lineTo(13, 4); ctx.lineTo(15, 3);
        ctx.moveTo(20, 11); ctx.lineTo(23, 9); ctx.lineTo(22, 12);
        ctx.moveTo(10, 11); ctx.lineTo(7, 9); ctx.lineTo(8, 12);
        ctx.stroke();
        break;
      }
      case 'enchant': {
        // Magic crystal with sparkle
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.moveTo(15, 3); ctx.lineTo(23, 14); ctx.lineTo(15, 26);
        ctx.lineTo(7, 14); ctx.closePath(); ctx.fill();
        ctx.fillStyle = mid;
        ctx.beginPath();
        ctx.moveTo(15, 6); ctx.lineTo(20, 14); ctx.lineTo(15, 23);
        ctx.lineTo(10, 14); ctx.closePath(); ctx.fill();
        ctx.fillStyle = lite;
        ctx.beginPath();
        ctx.moveTo(15, 6); ctx.lineTo(17, 14); ctx.lineTo(15, 14);
        ctx.closePath(); ctx.fill();
        r(14, 9, 2, 2, '#f8fafc'); // sparkle
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
