import type { GameState, PlayerId, Tower, TowerType, ServerMessage, Difficulty } from '../shared/types';
import { TOWER_CONFIGS, LEVEL_MULTS, upgradeCostFor, MAX_TOWER_LEVEL, SELL_REFUND_RATIO, LOADOUT_SIZE, TICK_RATE, BOARD_WIDTH, BOARD_HEIGHT, SPEED_BOOST_CAP, MAPS, DEFAULT_MAP_ID, RANDOM_MAP_ID } from '../shared/config';
import { WsClient, type ConnStatus } from './wsClient';
import { Renderer, CELL_SIZE, CANVAS_W, CANVAS_H } from './renderer';
import { play as playSfx, setMuted, isMuted, resumeAudio } from './sound';

// ── DOM ─────────────────────────────────────────────────────────────────────
const lobbyEl = document.getElementById('lobby')!;
const waitEl = document.getElementById('waiting')!;
const gameEl = document.getElementById('game-container')!;
const gameOverEl = document.getElementById('game-over')!;

const createBtn = document.getElementById('create-btn') as HTMLButtonElement;
const soloBtn = document.getElementById('solo-btn') as HTMLButtonElement;
const joinBtn = document.getElementById('join-btn') as HTMLButtonElement;
const codeInput = document.getElementById('code-input') as HTMLInputElement;
const lobbyError = document.getElementById('lobby-error')!;
const connStatus = document.getElementById('conn-status')!;
const loadoutGrid = document.getElementById('loadout-grid')!;
const loadoutCount = document.getElementById('loadout-count')!;
const loadoutDetail = document.getElementById('loadout-detail')!;
const mapGrid = document.getElementById('map-grid')!;
const mapName = document.getElementById('map-name')!;
const mapDesc = document.getElementById('map-desc')!;

const roomCodeEl = document.getElementById('room-code-display')!;
const waitStatus = document.getElementById('wait-status')!;

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const timerEl = document.getElementById('timer')!;
const p1MoneyEl = document.getElementById('p1-money')!;
const p2MoneyEl = document.getElementById('p2-money')!;
const p1CellsEl = document.getElementById('p1-cells')!;
const p2CellsEl = document.getElementById('p2-cells')!;
const myIdLabel = document.getElementById('my-id-label')!;
const towerPanel = document.getElementById('tower-panel')!;
const towerInfo = document.getElementById('tower-info')!;
const sellHint = document.getElementById('sell-hint')!;

// Pre-compute stat maxima across all towers for the rating bars
const TOWER_ENTRIES = Object.entries(TOWER_CONFIGS) as [TowerType, (typeof TOWER_CONFIGS)[TowerType]][];
const STAT_MAX = {
  hp: Math.max(...TOWER_ENTRIES.map(([, c]) => c.maxHp)),
  range: Math.max(...TOWER_ENTRIES.map(([, c]) => Math.max(c.range, c.supportRange, c.healRange))),
  speed: Math.max(...TOWER_ENTRIES.map(([, c]) => (c.shootInterval > 0 ? 1 / c.shootInterval : 0))),
  // Exclude 獻祭砲's nuke and 炸彈 — they aren't normal attacks and would skew the bars.
  dmg: Math.max(...TOWER_ENTRIES.filter(([, c]) => !c.sacrifice && !c.active).map(([, c]) => c.towerDamage)),
};

const overTitle = document.getElementById('over-title')!;
const overStats = document.getElementById('over-stats')!;
const playAgainBtn = document.getElementById('play-again-btn') as HTMLButtonElement;

const terrP1El      = document.getElementById('terr-p1')      as HTMLElement;
const terrNeutralEl = document.getElementById('terr-neutral') as HTMLElement;
const terrP2El      = document.getElementById('terr-p2')      as HTMLElement;

const overTerrP1El      = document.getElementById('over-terr-p1')      as HTMLElement;
const overTerrNeutralEl = document.getElementById('over-terr-neutral') as HTMLElement;
const overTerrP2El      = document.getElementById('over-terr-p2')      as HTMLElement;
const overP1LabelEl     = document.getElementById('over-p1-label')!;
const overP2LabelEl     = document.getElementById('over-p2-label')!;

const towerActionsEl = document.getElementById('tower-actions') as HTMLElement;
const actUpgradeBtn  = document.getElementById('act-upgrade')   as HTMLButtonElement;
const actSellBtn     = document.getElementById('act-sell')      as HTMLButtonElement;

const netBannerEl    = document.getElementById('net-banner')    as HTMLElement;
const muteBtn        = document.getElementById('mute-btn')       as HTMLButtonElement;

const TOTAL_CELLS = BOARD_WIDTH * BOARD_HEIGHT;

// ── State ────────────────────────────────────────────────────────────────────
const ws = new WsClient();
const renderer = new Renderer(canvas);

// Tower sprite icons for the DOM buttons/panels (cached data URLs), replacing
// the old single-letter glyphs with the actual pixel-art turret.
const iconUrlCache = new Map<string, string>();
function towerIcon(type: TowerType, cls: string, px: number): string {
  const key = `${type}@${px}`;
  let url = iconUrlCache.get(key);
  if (!url) { url = renderer.iconDataUrl(type, px); iconUrlCache.set(key, url); }
  return `<img class="${cls}" width="${px}" height="${px}" src="${url}" alt="">`;
}

let myId: PlayerId | null = null;
let currentState: GameState | null = null;
let selectedTower: TowerType | null = 'basic';
let selectedTowerId: string | null = null;
let hovered: { x: number; y: number } | null = null;
let myRoomCode = '';
let wsOpen = false;

// Network-resilience state: whether we're mid-match (so a socket drop should
// trigger a REJOIN), and the two banner conditions.
let inGame = false;
let selfDown = false; // our own socket is down while in a match
let oppDown = false;  // opponent dropped and we're waiting on their grace window

// A charged 獻祭砲 the player has picked up and is aiming; next map click fires it.
let armedSacrificeId: string | null = null;

// SFX derived from the authoritative state each tick: we diff against the last
// snapshot so combat events (shots, kills, wall breaks, jammer fields, a charged
// 獻祭砲) each get a sound as they happen, for either player. Bursty events are
// throttled so a splash barrage doesn't machine-gun the speaker.
let seenEffects = new Set<string>();
let prevTowerIds = new Set<string>();
let prevCharged = new Set<string>();
let prevProjIds = new Set<string>();
let prevBarrierDown = new Set<string>();
const soldIds = new Set<string>(); // towers we sold — don't also play a 'destroy' for them
let lastBoomAt = 0, lastShootAt = 0, lastDestroyAt = 0, lastZapAt = 0;
let lastTickSec = -1; // last whole-second we played a countdown tick for

function processStateSfx(state: GameState): void {
  const now = performance.now();

  // Effects: explosions / nukes / jammer fields.
  const eff = new Set<string>();
  for (const e of state.effects) {
    eff.add(e.id);
    if (seenEffects.has(e.id)) continue;
    if (e.kind === 'nuke') playSfx('nuke');
    else if (e.kind === 'jammer') playSfx('jammer');
    else if (e.kind === 'zap' && now - lastZapAt > 60) { playSfx('zap'); lastZapAt = now; }
    else if (e.kind === 'blast' && now - lastBoomAt > 70) { playSfx('explosion'); lastBoomAt = now; }
  }
  seenEffects = eff;

  // Towers: a newly-charged 獻祭砲, and any tower that vanished (destroyed — but
  // not one we sold ourselves, which already played its own sound).
  const towerIds = new Set<string>();
  const charged = new Set<string>();
  for (const t of state.towers) {
    towerIds.add(t.id);
    if (t.charged) { charged.add(t.id); if (!prevCharged.has(t.id)) playSfx('charge'); }
  }
  let destroyed = false;
  for (const id of prevTowerIds) {
    if (towerIds.has(id)) continue;
    if (soldIds.has(id)) { soldIds.delete(id); continue; }
    destroyed = true;
  }
  if (destroyed && now - lastDestroyAt > 80) { playSfx('destroy'); lastDestroyAt = now; }
  prevTowerIds = towerIds;
  prevCharged = charged;

  // Projectiles: our own new shots (throttled — many towers fire at once).
  let shot = false;
  const projIds = new Set<string>();
  for (const p of state.projectiles) {
    projIds.add(p.id);
    if (p.owner === myId && !prevProjIds.has(p.id)) shot = true;
  }
  if (shot && now - lastShootAt > 90) { playSfx('shoot'); lastShootAt = now; }
  prevProjIds = projIds;

  // Barriers: a wall ring that just dropped to zero HP.
  const down = new Set<string>();
  for (const b of state.barriers) {
    if (b.hp > 0) continue;
    down.add(b.id);
    if (!prevBarrierDown.has(b.id)) playSfx('shatter');
  }
  prevBarrierDown = down;
}

// Seed the diff snapshots from a state without sounding anything (used on
// GAME_START / rejoin so pre-existing objects don't all fire at once).
function seedStateSfx(state: GameState): void {
  seenEffects = new Set(state.effects.map(e => e.id));
  prevTowerIds = new Set(state.towers.map(t => t.id));
  prevCharged = new Set(state.towers.filter(t => t.charged).map(t => t.id));
  prevProjIds = new Set(state.projectiles.map(p => p.id));
  prevBarrierDown = new Set(state.barriers.filter(b => b.hp <= 0).map(b => b.id));
}

// Pre-game loadout: which towers this player brings into the match.
const DEFAULT_LOADOUT: TowerType[] = ['basic', 'rapid', 'spread', 'sniper', 'artillery', 'splash', 'support', 'repair'];
const myLoadout = new Set<TowerType>(DEFAULT_LOADOUT.slice(0, LOADOUT_SIZE));

// Chosen map (host of a room / solo match picks it; joiners inherit the room's).
let selectedMapId = DEFAULT_MAP_ID;

// Towers in config order, used for both the picker and the in-game panel.
function loadoutOrdered(): [TowerType, (typeof TOWER_CONFIGS)[TowerType]][] {
  return TOWER_ENTRIES.filter(([t]) => myLoadout.has(t));
}

// ── Screens ──────────────────────────────────────────────────────────────────
function showScreen(name: 'lobby' | 'waiting' | 'game' | 'gameover'): void {
  lobbyEl.style.display = name === 'lobby' ? '' : 'none';
  waitEl.style.display = name === 'waiting' ? '' : 'none';
  gameEl.style.display = name === 'game' ? '' : 'none';
  gameOverEl.style.display = name === 'gameover' ? '' : 'none';
}

// Show/hide the in-game network banner. Our own outage takes priority over an
// opponent outage, since we can't do anything until we're back.
function updateNetBanner(): void {
  if (!inGame) { netBannerEl.style.display = 'none'; return; }
  if (selfDown) {
    netBannerEl.textContent = '⚠ 與伺服器連線中斷，正在重新連線…';
    netBannerEl.style.display = '';
  } else if (oppDown) {
    netBannerEl.textContent = '⚠ 對手連線中斷，等待重新連線…';
    netBannerEl.style.display = '';
  } else {
    netBannerEl.style.display = 'none';
  }
}

// ── Loadout picker (lobby) ────────────────────────────────────────────────────
function buildLoadoutPicker(): void {
  loadoutGrid.innerHTML = '';
  for (const [type, cfg] of TOWER_ENTRIES) {
    const btn = document.createElement('button');
    btn.className = 'lo-btn';
    btn.dataset.type = type;
    btn.innerHTML = `${towerIcon(type, 'lo-glyph', 22)}<span class="lo-label">${cfg.label}</span><span class="lo-cost">$${cfg.cost}</span>`;
    // Tap shows the detail panel (touch-friendly) and toggles the pick; desktop
    // also previews on hover.
    btn.addEventListener('click', () => {
      const before = myLoadout.has(type);
      toggleLoadout(type);
      const after = myLoadout.has(type);
      playSfx(after && !before ? 'pick' : before && !after ? 'unpick' : 'click');
      renderLoadoutDetail(type);
    });
    btn.addEventListener('mouseenter', () => renderLoadoutDetail(type));
    loadoutGrid.appendChild(btn);
  }
  refreshLoadoutUI();
  renderLoadoutDetail(TOWER_ENTRIES[0][0]);
}

// ── Map picker (lobby) ────────────────────────────────────────────────────────
function buildMapPicker(): void {
  mapGrid.innerHTML = '';
  const entries: { id: string; name: string }[] = [
    ...MAPS.map(m => ({ id: m.id, name: m.name })),
    { id: RANDOM_MAP_ID, name: '🎲 隨機' },
  ];
  for (const e of entries) {
    const btn = document.createElement('button');
    btn.className = 'map-btn';
    btn.dataset.map = e.id;
    btn.textContent = e.name;
    btn.addEventListener('click', () => { playSfx('click'); selectMap(e.id); });
    mapGrid.appendChild(btn);
  }
  selectMap(selectedMapId);
}

function selectMap(id: string): void {
  selectedMapId = id;
  if (id === RANDOM_MAP_ID) {
    mapName.textContent = '🎲 隨機';
    mapDesc.textContent = '每局開打時隨機抽一張地圖。';
  } else {
    const m = MAPS.find(mm => mm.id === id) ?? MAPS[0];
    mapName.textContent = m.name;
    mapDesc.textContent = m.desc;
  }
  mapGrid.querySelectorAll<HTMLButtonElement>('.map-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.map === id);
  });
}

function toggleLoadout(type: TowerType): void {
  if (myLoadout.has(type)) myLoadout.delete(type);
  else if (myLoadout.size < LOADOUT_SIZE) myLoadout.add(type);
  refreshLoadoutUI();
}

// Shared special-ability description, used by both the lobby detail panel and
// the in-game tower info panel.
function specialText(c: (typeof TOWER_CONFIGS)[TowerType]): string {
  if (c.active) return '主動技：點任意格投彈';
  if (c.pierce) return '飛越地形只打敵塔（護牆可擋）';
  if (c.slowDuration) return `落點敵塔降速 ${Math.round((c.slowFactor ?? 0.2) * 100)}%／${c.slowDuration / TICK_RATE} 秒`;
  if (c.lob) return '越頂拋射、隨機砸落';
  if (c.sacrifice) return '吞噬 8 塔 → 蓄能，可拖曳投擲';
  if (c.octopus) return '八方向齊射';
  if (c.summonInterval) return `每 ${c.summonInterval / TICK_RATE} 秒召喚基礎砲`;
  if (c.magnetRange) return '吸附附近敵方子彈';
  if (c.decoy) return '嘲諷：吸引敵方狙擊';
  if (c.chainCount) return `連鎖電擊最近 ${c.chainCount} 座敵塔`;
  if (c.enchantInterval) return `每 ${c.enchantInterval / TICK_RATE} 秒隨機升級友軍`;
  if (c.incomePerSec) return `運作時每秒 +$${c.incomePerSec}`;
  if (c.wallHp) return '5×5 護牆，破壞後 15 秒重建';
  if (c.spreadCount > 1) return `扇形 ${c.spreadCount} 連發`;
  if (c.splashRadius > 0) return '範圍爆炸染色';
  if (c.speedBoost > 0) {
    const maxStacks = Math.max(1, Math.floor((SPEED_BOOST_CAP - 1) / c.speedBoost + 1e-9));
    return `周圍友軍射速 +${Math.round(c.speedBoost * 100)}%（最多疊 ${maxStacks} 台，上限 ×${SPEED_BOOST_CAP}）`;
  }
  if (c.healPerTick > 0) return '持續修復周圍友軍血量';
  return '單發單格染色';
}

function renderLoadoutDetail(type: TowerType): void {
  const c = TOWER_CONFIGS[type];
  const range = Math.max(c.range, c.supportRange, c.healRange);
  const speed = c.shootInterval > 0 ? 1 / c.shootInterval : 0;
  const shotsPerSec = c.shootInterval > 0 ? TICK_RATE / c.shootInterval : 0;
  const EMPTY = '<span class="empty">●●●●●</span>';
  const picked = myLoadout.has(type);

  const fireVal  = c.shootInterval > 0 ? `${shotsPerSec.toFixed(1)} 發/秒` : '不攻擊';
  const fireBars = c.shootInterval > 0 ? bars(speed, STAT_MAX.speed) : EMPTY;
  const dmgVal   = c.towerDamage > 0 ? `${c.towerDamage}` : '—';
  const dmgBars  = c.towerDamage > 0 ? bars(c.towerDamage, STAT_MAX.dmg) : EMPTY;
  const rangeVal = range > 0 ? `${range} 格` : '—';
  const rangeBars = range > 0 ? bars(range, STAT_MAX.range) : EMPTY;

  loadoutDetail.innerHTML = `
    <div class="ld-header">
      ${towerIcon(type, 'ld-glyph', 24)}
      <span class="ld-name">${c.label}</span>
      <span class="ld-role">${c.role}</span>
      <span class="ld-status ${picked ? 'in' : 'out'}">${picked ? '✓ 已帶上場' : '未帶'}</span>
      <span class="ld-cost">$${c.cost}</span>
    </div>
    <div class="ld-stats">
      <div class="ld-stat"><span class="lab">耐久</span><span class="val">${c.maxHp} HP</span><span class="bars">${bars(c.maxHp, STAT_MAX.hp)}</span></div>
      <div class="ld-stat"><span class="lab">射程</span><span class="val">${rangeVal}</span><span class="bars">${rangeBars}</span></div>
      <div class="ld-stat"><span class="lab">射速</span><span class="val">${fireVal}</span><span class="bars">${fireBars}</span></div>
      <div class="ld-stat"><span class="lab">拆塔</span><span class="val">${dmgVal}</span><span class="bars">${dmgBars}</span></div>
    </div>
    <div class="ld-desc"><b style="color:#cbd5e1">特性：</b>${specialText(c)}<br>${c.description}</div>`;
}

function refreshLoadoutUI(): void {
  const full = myLoadout.size >= LOADOUT_SIZE;
  loadoutCount.textContent = `${myLoadout.size} / ${LOADOUT_SIZE}`;
  loadoutCount.classList.toggle('full', myLoadout.size === LOADOUT_SIZE);
  loadoutGrid.querySelectorAll<HTMLButtonElement>('.lo-btn').forEach(btn => {
    const t = btn.dataset.type as TowerType;
    const picked = myLoadout.has(t);
    btn.classList.toggle('picked', picked);
    btn.classList.toggle('locked', !picked && full); // can't add more once full
  });
  refreshLobby();
}

function refreshLobby(): void {
  const ready = wsOpen && myLoadout.size === LOADOUT_SIZE;
  createBtn.disabled = !ready;
  soloBtn.disabled = !ready;
  joinBtn.disabled = !ready;
}

// ── Tower panel buttons ───────────────────────────────────────────────────────
function buildTowerPanel(): void {
  towerPanel.innerHTML = '';
  for (const [type, cfg] of loadoutOrdered()) {
    const btn = document.createElement('button');
    btn.className = 'tower-btn';
    btn.dataset.type = type;
    btn.innerHTML = `${towerIcon(type, 'tw-glyph', 24)}<span class="tw-label">${cfg.label}</span><span class="tw-cost">$${cfg.cost}</span>`;
    btn.addEventListener('click', () => { playSfx('click'); selectTower(type); });
    btn.addEventListener('mouseenter', () => renderTowerInfo(type));
    towerPanel.appendChild(btn);
  }
  towerPanel.addEventListener('mouseleave', () => {
    if (selectedTowerId && currentState) {
      const t = currentState.towers.find(t => t.id === selectedTowerId);
      if (t) { renderSelectedTowerInfo(t); return; }
    }
    if (selectedTower) renderTowerInfo(selectedTower);
  });
  const first = loadoutOrdered()[0]?.[0] ?? 'basic';
  selectTower(first);
}

function selectTower(type: TowerType): void {
  selectedTowerId = null;
  panelTowerId = null;
  selectedTower = type;
  document.querySelectorAll('.tower-btn').forEach(b => {
    (b as HTMLElement).classList.toggle('selected', (b as HTMLElement).dataset.type === type);
  });
  renderTowerInfo(type);
}

// Tracks what the upgrade panel currently shows, so per-tick STATE updates
// only touch the volatile values (HP / afford state) instead of rebuilding the
// whole panel — rebuilding innerHTML 20x/sec destroys the button mid-click.
let panelTowerId: string | null = null;
let panelLevel = -1;

function renderSelectedTowerInfo(tower: Tower): void {
  // Same tower + same level → just refresh volatile bits in place.
  if (tower.id === panelTowerId && tower.level === panelLevel) {
    updateSelectedTowerVolatile(tower);
    return;
  }

  const cfg = TOWER_CONFIGS[tower.type];
  const m = LEVEL_MULTS[tower.level - 1];
  const canUp = tower.level < MAX_TOWER_LEVEL;
  const nextM = canUp ? LEVEL_MULTS[tower.level] : null;
  // 狙擊砲's fire rate is fixed, so show ×1.0 instead of the level's speed mult.
  const spd = (mult: (typeof LEVEL_MULTS)[number]) => (cfg.fixedFireRate ? '1.0' : mult.speed.toFixed(1));

  towerInfo.innerHTML = `
    <div class="ti-header">
      ${towerIcon(tower.type, 'ti-glyph', 26)}
      <span class="ti-name">${cfg.label}</span>
      <span class="ti-role" style="background:#22c55e;color:#052e16">Lv.${tower.level}</span>
      <span class="ti-cost">${cfg.role}</span>
    </div>
    <div class="ti-desc">
      範圍×${m.range.toFixed(1)} &nbsp;射速×${spd(m)} &nbsp;傷害×${m.dmg.toFixed(1)} &nbsp;血量×${m.hp.toFixed(1)}
      ${nextM ? `<span style="color:#334155"> → Lv.${tower.level + 1}: 範圍×${nextM.range.toFixed(1)} 射速×${spd(nextM)} 傷害×${nextM.dmg.toFixed(1)}</span>` : ''}
    </div>
    <div class="ti-desc" style="color:#94a3b8">特性：${specialText(cfg)}</div>
    <div class="ti-stats">
      <div class="ti-stat"><span class="lab">HP</span><span class="bars" id="sel-hp">${Math.floor(tower.hp)} / ${tower.maxHp}</span></div>
      <div class="ti-stat"><span class="lab">等級</span><span class="bars">${'★'.repeat(tower.level)}${'<span class="empty">★</span>'.repeat(MAX_TOWER_LEVEL - tower.level)}</span></div>
      <div class="ti-stat"><span class="lab">操作</span><span class="bars" style="color:#64748b">點砲台上方按鈕升級／賣出</span></div>
    </div>`;

  panelTowerId = tower.id;
  panelLevel = tower.level;
  updateSelectedTowerVolatile(tower);
}

function updateSelectedTowerVolatile(tower: Tower): void {
  const hpEl = document.getElementById('sel-hp');
  if (hpEl) hpEl.textContent = `${Math.floor(tower.hp)} / ${tower.maxHp}`;
}

// Floating upgrade/sell menu anchored to the top of the selected tower's
// range circle. Buttons are never recreated — only repositioned and relabelled
// — so clicks stay reliable despite 20 Hz state updates.
function updateTowerActions(): void {
  if (!selectedTowerId || !currentState || currentState.phase !== 'playing') {
    towerActionsEl.style.display = 'none';
    return;
  }
  const tower = currentState.towers.find(t => t.id === selectedTowerId);
  if (!tower || tower.owner !== myId) {
    towerActionsEl.style.display = 'none';
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const dispCell = rect.width / 24;
  const cfg = TOWER_CONFIGS[tower.type];
  const m = LEVEL_MULTS[tower.level - 1];
  const effRange = Math.max(cfg.range, cfg.supportRange, cfg.healRange) * m.range;
  const cx = (tower.x + 0.5) * dispCell;
  const cy = (tower.y + 0.5) * dispCell;
  // Sit on the range arc, but always at least one cell above the sprite so
  // zero-range towers (e.g. the wall) don't get covered by the menu.
  const radiusPx = Math.max(effRange * dispCell, dispCell);

  const menuX = Math.max(54, Math.min(rect.width - 54, cx));
  const menuY = Math.max(14, cy - radiusPx);
  towerActionsEl.style.left = `${menuX}px`;
  towerActionsEl.style.top = `${menuY}px`;

  const money = myId ? (currentState.players[myId].money ?? 0) : 0;
  const canUp = tower.level < MAX_TOWER_LEVEL;
  if (canUp) {
    const upgCost = upgradeCostFor(cfg);
    actUpgradeBtn.textContent = `▲ 升級 $${upgCost}`;
    actUpgradeBtn.disabled = money < upgCost;
  } else {
    actUpgradeBtn.textContent = '★ MAX';
    actUpgradeBtn.disabled = true;
  }
  actSellBtn.textContent = `✕ 賣出 $${Math.floor(cfg.cost * SELL_REFUND_RATIO)}`;

  towerActionsEl.style.display = 'flex';
}

function deselectTower(): void {
  selectedTowerId = null;
  panelTowerId = null;
  towerActionsEl.style.display = 'none';
  if (selectedTower) renderTowerInfo(selectedTower);
}

function bars(value: number, max: number): string {
  const n = max > 0 && value > 0 ? Math.max(1, Math.min(5, Math.round((value / max) * 5))) : 0;
  let s = '';
  for (let i = 0; i < 5; i++) s += i < n ? '●' : '<span class="empty">●</span>';
  return s;
}

function renderTowerInfo(type: TowerType): void {
  const c = TOWER_CONFIGS[type];
  const range = Math.max(c.range, c.supportRange, c.healRange);
  const speed = c.shootInterval > 0 ? 1 / c.shootInterval : 0;
  const fireBars = c.shootInterval > 0 ? bars(speed, STAT_MAX.speed) : '<span class="empty">●●●●●</span>';
  const dmgBars = c.towerDamage > 0 ? bars(c.towerDamage, STAT_MAX.dmg) : '<span class="empty">●●●●●</span>';

  const special = specialText(c);

  towerInfo.innerHTML = `
    <div class="ti-header">
      ${towerIcon(type, 'ti-glyph', 26)}
      <span class="ti-name">${c.label}</span>
      <span class="ti-role">${c.role}</span>
      <span class="ti-cost">$${c.cost}</span>
    </div>
    <div class="ti-desc">${c.description} <span style="color:#334155">— ${special}</span></div>
    <div class="ti-stats">
      <div class="ti-stat"><span class="lab">血量</span><span class="bars">${bars(c.maxHp, STAT_MAX.hp)}</span></div>
      <div class="ti-stat"><span class="lab">射程</span><span class="bars">${bars(range, STAT_MAX.range)}</span></div>
      <div class="ti-stat"><span class="lab">射速</span><span class="bars">${fireBars}</span></div>
      <div class="ti-stat"><span class="lab">拆塔</span><span class="bars">${dmgBars}</span></div>
    </div>`;
}

// ── Canvas input ─────────────────────────────────────────────────────────────
function getCell(e: MouseEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width;
  const sy = canvas.height / rect.height;
  return {
    x: Math.floor((e.clientX - rect.left) * sx / CELL_SIZE),
    y: Math.floor((e.clientY - rect.top) * sy / CELL_SIZE),
  };
}

canvas.addEventListener('mousemove', (e) => {
  const { x, y } = getCell(e);
  if (x >= 0 && x < BOARD_WIDTH && y >= 0 && y < BOARD_HEIGHT) hovered = { x, y };
  else hovered = null;

  if (armedSacrificeId) { canvas.style.cursor = 'crosshair'; return; } // aiming a charged 獻祭砲
  if (!currentState || !myId || !selectedTower) { canvas.style.cursor = 'default'; return; }
  if (TOWER_CONFIGS[selectedTower].active) { canvas.style.cursor = 'crosshair'; return; } // 炸彈 anywhere
  const state = currentState;
  const canPlace = state.board[y]?.[x] === myId && !state.towers.some(t => t.x === x && t.y === y);
  canvas.style.cursor = canPlace ? 'crosshair' : 'default';
});

canvas.addEventListener('mouseleave', () => { hovered = null; });

canvas.addEventListener('click', (e) => {
  if (!currentState || !myId) return;
  const { x, y } = getCell(e);
  if (x < 0 || x >= BOARD_WIDTH || y < 0 || y >= BOARD_HEIGHT) return;

  // A charged 獻祭砲 is armed → this click detonates it at the target cell.
  if (armedSacrificeId) {
    playSfx('bomb');
    ws.send({ type: 'DETONATE', towerId: armedSacrificeId, x, y });
    armedSacrificeId = null;
    return;
  }

  // Clicking your own charged 獻祭砲 arms it (pick up the nuke, then aim).
  const charged = currentState.towers.find(t => t.x === x && t.y === y && t.owner === myId && t.charged);
  if (charged) { playSfx('arm'); armedSacrificeId = charged.id; deselectTower(); return; }

  // 炸彈 (active ability): click any cell to drop it.
  if (selectedTower && TOWER_CONFIGS[selectedTower].active) {
    const me = currentState.players[myId];
    if (me.bombCooldown > 0 || me.money < TOWER_CONFIGS[selectedTower].cost) playSfx('deny');
    else { playSfx('bomb'); ws.send({ type: 'BOMB', x, y }); }
    return;
  }

  const hitTower = currentState.towers.find(t => t.x === x && t.y === y && t.owner === myId);
  if (hitTower) {
    playSfx('select');
    selectedTowerId = hitTower.id;
    renderSelectedTowerInfo(hitTower);
    return;
  }

  if (selectedTowerId !== null) deselectTower();

  if (selectedTower) {
    // Feedback only for a real placement intent (clicking your own empty cell):
    // chirp if affordable, buzz if broke, stay silent on misclicks elsewhere.
    const state = currentState;
    const onOwnEmpty = state.board[y]?.[x] === myId && !state.towers.some(t => t.x === x && t.y === y);
    if (!onOwnEmpty) return;
    if (state.players[myId].money >= TOWER_CONFIGS[selectedTower].cost) {
      playSfx('place');
      ws.send({ type: 'PLACE_TOWER', towerType: selectedTower, x, y });
    } else {
      playSfx('deny');
    }
  }
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (!currentState || !myId) return;
  // Right-click cancels an armed 獻祭砲 instead of selling.
  if (armedSacrificeId) { playSfx('cancel'); armedSacrificeId = null; return; }
  const { x, y } = getCell(e);
  const tower = currentState.towers.find(t => t.x === x && t.y === y && t.owner === myId);
  if (tower) {
    if (tower.charged) return; // don't sell a charged nuke by accident
    if (selectedTowerId === tower.id) deselectTower();
    playSfx('sell');
    soldIds.add(tower.id); // suppress the 'destroy' sound for our own sell
    ws.send({ type: 'SELL_TOWER', towerId: tower.id });
  }
});

// ── Floating action buttons (created once → reliable clicks) ──
actUpgradeBtn.addEventListener('click', () => {
  if (selectedTowerId) { playSfx('upgrade'); ws.send({ type: 'UPGRADE_TOWER', towerId: selectedTowerId }); }
});
actSellBtn.addEventListener('click', () => {
  if (!selectedTowerId) return;
  playSfx('sell');
  soldIds.add(selectedTowerId); // suppress the 'destroy' sound for our own sell
  ws.send({ type: 'SELL_TOWER', towerId: selectedTowerId });
  deselectTower();
});

// ── HUD update ────────────────────────────────────────────────────────────────
function updateHud(state: GameState): void {
  const t = Math.max(0, state.timeLeft);
  const m = Math.floor(t / 60).toString().padStart(2, '0');
  const s = Math.floor(t % 60).toString().padStart(2, '0');
  timerEl.textContent = `${m}:${s}`;
  if (t < 30) timerEl.classList.add('warning');
  else timerEl.classList.remove('warning');

  // Countdown ticks over the final 10 seconds.
  if (t > 10) lastTickSec = -1;
  else if (t > 0) {
    const sec = Math.ceil(t);
    if (sec !== lastTickSec) { playSfx('tick'); lastTickSec = sec; }
  }

  const total = TOTAL_CELLS;
  p1MoneyEl.textContent = `$${Math.floor(state.players.p1.money)}`;
  p2MoneyEl.textContent = `$${Math.floor(state.players.p2.money)}`;
  p1CellsEl.textContent = `${state.players.p1.cells} (${Math.round(state.players.p1.cells / total * 100)}%)`;
  p2CellsEl.textContent = `${state.players.p2.cells} (${Math.round(state.players.p2.cells / total * 100)}%)`;

  const p1pct = state.players.p1.cells / total * 100;
  const p2pct = state.players.p2.cells / total * 100;
  terrP1El.style.width      = p1pct + '%';
  terrNeutralEl.style.width = Math.max(0, 100 - p1pct - p2pct) + '%';
  terrP2El.style.width      = p2pct + '%';

  // Dim tower buttons if can't afford; 炸彈 also greys out during its cooldown
  // and shows the remaining seconds in place of its cost.
  if (myId) {
    const me = state.players[myId];
    document.querySelectorAll<HTMLButtonElement>('.tower-btn').forEach(btn => {
      const type = btn.dataset.type as TowerType;
      const cfg = TOWER_CONFIGS[type];
      let disabled = cfg.cost > me.money;
      if (cfg.active) {
        const costEl = btn.querySelector('.tw-cost');
        if (me.bombCooldown > 0) {
          disabled = true;
          if (costEl) costEl.textContent = `🕒 ${Math.ceil(me.bombCooldown / TICK_RATE)}s`;
        } else if (costEl) {
          costEl.textContent = `$${cfg.cost}`;
        }
      }
      btn.disabled = disabled;
    });
  }
}

// ── WS messages ──────────────────────────────────────────────────────────────
ws.on((msg: ServerMessage) => {
  switch (msg.type) {
    case 'ROOM_CREATED':
      myId = msg.playerId;
      myRoomCode = msg.code;
      break;
    case 'WAITING_FOR_OPPONENT':
      roomCodeEl.textContent = myRoomCode;
      showScreen('waiting');
      break;
    case 'ROOM_JOINED':
      myId = msg.playerId;
      myRoomCode = msg.code.toUpperCase();
      break;
    case 'GAME_START':
      myId = msg.playerId;
      currentState = msg.state;
      selectedTowerId = null;
      panelTowerId = null;
      towerActionsEl.style.display = 'none';
      myIdLabel.textContent = myId === 'p1' ? 'You: P1 (Blue)' : 'You: P2 (Red)';
      myIdLabel.style.color = myId === 'p1' ? '#60a5fa' : '#f87171';
      buildTowerPanel();
      showScreen('game');
      seedStateSfx(currentState); // don't replay pre-existing objects on rejoin
      if (!inGame) playSfx('start'); // fresh match start (not a rejoin resync)
      // GAME_START also arrives as a resync after our own rejoin.
      inGame = true;
      oppDown = false;
      updateNetBanner();
      break;
    case 'STATE':
      currentState = msg.state;
      processStateSfx(currentState);
      if (selectedTowerId) {
        const sel = currentState.towers.find(t => t.id === selectedTowerId);
        if (sel) renderSelectedTowerInfo(sel);
        else deselectTower();
      }
      break;
    case 'OPPONENT_DISCONNECTED':
      oppDown = true;
      updateNetBanner();
      break;
    case 'OPPONENT_RECONNECTED':
      oppDown = false;
      updateNetBanner();
      break;
    case 'GAME_OVER': {
      inGame = false;
      oppDown = false;
      updateNetBanner();
      selectedTowerId = null;
      towerActionsEl.style.display = 'none';
      currentState = msg.finalState;
      const w = msg.winner;
      const forfeit = msg.reason === 'forfeit';
      if (forfeit && w === myId) overTitle.textContent = '對手離開，你獲勝！';
      else overTitle.textContent = w === 'draw' ? 'DRAW!' : w === myId ? 'YOU WIN!' : 'YOU LOSE!';
      overTitle.style.color = w === 'draw' ? '#facc15' : w === myId ? '#4ade80' : '#f87171';
      const fs = msg.finalState;
      const p1p = Math.round(fs.players.p1.cells / TOTAL_CELLS * 100);
      const p2p = Math.round(fs.players.p2.cells / TOTAL_CELLS * 100);
      overTerrP1El.style.width      = p1p + '%';
      overTerrNeutralEl.style.width = Math.max(0, 100 - p1p - p2p) + '%';
      overTerrP2El.style.width      = p2p + '%';
      overP1LabelEl.textContent = `P1  ${p1p}%`;
      overP2LabelEl.textContent = `${p2p}%  P2`;
      overStats.textContent = `${fs.players.p1.cells} 格 vs ${fs.players.p2.cells} 格`;
      playSfx(w === myId ? 'win' : 'lose');
      showScreen('gameover');
      break;
    }
    case 'ERROR':
      if (inGame) {
        // A failed rejoin (grace expired / match already over) lands here.
        inGame = false;
        selfDown = false;
        oppDown = false;
        netBannerEl.textContent = `⚠ ${msg.message}`;
        netBannerEl.style.display = '';
      } else {
        lobbyError.textContent = msg.message;
      }
      break;
  }
});

// ── Lobby buttons ─────────────────────────────────────────────────────────────
function currentLoadout(): TowerType[] {
  return loadoutOrdered().map(([t]) => t);
}

createBtn.addEventListener('click', () => {
  playSfx('click');
  lobbyError.textContent = '';
  ws.send({ type: 'CREATE_ROOM', loadout: currentLoadout(), mapId: selectedMapId });
});

let botDifficulty: Difficulty = 'normal';
document.querySelectorAll<HTMLButtonElement>('.diff-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    playSfx('click');
    botDifficulty = btn.dataset.diff as Difficulty;
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.toggle('selected', b === btn));
  });
});

soloBtn.addEventListener('click', () => {
  playSfx('click');
  lobbyError.textContent = '';
  ws.send({ type: 'CREATE_SOLO', loadout: currentLoadout(), difficulty: botDifficulty, mapId: selectedMapId });
});

joinBtn.addEventListener('click', () => {
  const code = codeInput.value.trim();
  if (!code) { playSfx('deny'); lobbyError.textContent = '請輸入房間代號'; return; }
  playSfx('click');
  lobbyError.textContent = '';
  ws.send({ type: 'JOIN_ROOM', code, loadout: currentLoadout() });
});

// Room codes are numeric now — keep the input to digits only.
codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.replace(/\D/g, '');
});

codeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinBtn.click();
});

playAgainBtn.addEventListener('click', () => { playSfx('click'); location.reload(); });

// ── Render loop ───────────────────────────────────────────────────────────────
const SACRIFICE_BLAST = TOWER_CONFIGS.sacrifice.splashRadius;
function loop(): void {
  if (currentState) {
    // Drop a stale arming if the charged tower is gone (detonated/destroyed).
    if (armedSacrificeId && !currentState.towers.some(t => t.id === armedSacrificeId && t.charged)) {
      armedSacrificeId = null;
    }
    // Area-ability aiming reticle: gold for a charged 獻祭砲, orange for 炸彈.
    let armedBlast: { x: number; y: number; radius: number; color?: string } | null = null;
    if (armedSacrificeId && hovered) {
      armedBlast = { x: hovered.x, y: hovered.y, radius: SACRIFICE_BLAST };
    } else if (hovered && selectedTower && TOWER_CONFIGS[selectedTower].active) {
      armedBlast = { x: hovered.x, y: hovered.y, radius: TOWER_CONFIGS[selectedTower].splashRadius, color: '#fb923c' };
    }
    renderer.draw(currentState, myId, selectedTower, hovered, selectedTowerId, armedBlast);
    updateHud(currentState);
    updateTowerActions();
  }
  requestAnimationFrame(loop);
}

// ── Connection status ─────────────────────────────────────────────────────────
ws.onStatus((status: ConnStatus) => {
  connStatus.className = status;
  if (status === 'connecting') {
    connStatus.textContent = '連線中…（伺服器休眠時需等約 30 秒喚醒）';
    wsOpen = false;
  } else if (status === 'open') {
    connStatus.textContent = '● 已連線';
    wsOpen = true;
    // If the socket dropped mid-match, ask the server to rebind our slot. The
    // REJOIN is sent before any queued input because setStatus runs first.
    if (inGame && myId && myRoomCode) {
      ws.send({ type: 'REJOIN_ROOM', code: myRoomCode, playerId: myId });
    }
    selfDown = false;
  } else {
    connStatus.textContent = '連線中斷，自動重新連線中…';
    wsOpen = false;
    if (inGame) selfDown = true;
  }
  updateNetBanner();
  refreshLobby();
});

// ── Sound ─────────────────────────────────────────────────────────────────────
muteBtn.addEventListener('click', () => {
  setMuted(!isMuted());
  muteBtn.textContent = isMuted() ? '🔇' : '🔊';
  muteBtn.classList.toggle('muted', isMuted());
  if (!isMuted()) { resumeAudio(); playSfx('click'); }
});
// Browsers block audio until a user gesture — unlock the context on the first one.
window.addEventListener('pointerdown', resumeAudio, { once: true });
window.addEventListener('keydown', resumeAudio, { once: true });

// ── Init ──────────────────────────────────────────────────────────────────────
showScreen('lobby');
buildLoadoutPicker();
buildMapPicker();
refreshLobby();
ws.connect();
requestAnimationFrame(loop);
