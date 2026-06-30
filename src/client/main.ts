import type { GameState, PlayerId, Tower, TowerType, ServerMessage } from '../shared/types';
import { TOWER_CONFIGS, LEVEL_MULTS, UPGRADE_COST_RATIO, MAX_TOWER_LEVEL, SELL_REFUND_RATIO, LOADOUT_SIZE, TICK_RATE } from '../shared/config';
import { WsClient, type ConnStatus } from './wsClient';
import { Renderer, CELL_SIZE, CANVAS_W, CANVAS_H } from './renderer';

// ── DOM ─────────────────────────────────────────────────────────────────────
const lobbyEl = document.getElementById('lobby')!;
const waitEl = document.getElementById('waiting')!;
const gameEl = document.getElementById('game-container')!;
const gameOverEl = document.getElementById('game-over')!;

const createBtn = document.getElementById('create-btn') as HTMLButtonElement;
const joinBtn = document.getElementById('join-btn') as HTMLButtonElement;
const codeInput = document.getElementById('code-input') as HTMLInputElement;
const lobbyError = document.getElementById('lobby-error')!;
const connStatus = document.getElementById('conn-status')!;
const loadoutGrid = document.getElementById('loadout-grid')!;
const loadoutCount = document.getElementById('loadout-count')!;
const loadoutDetail = document.getElementById('loadout-detail')!;

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
  dmg: Math.max(...TOWER_ENTRIES.map(([, c]) => c.towerDamage)),
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

// ── State ────────────────────────────────────────────────────────────────────
const ws = new WsClient();
const renderer = new Renderer(canvas);

let myId: PlayerId | null = null;
let currentState: GameState | null = null;
let selectedTower: TowerType | null = 'basic';
let selectedTowerId: string | null = null;
let hovered: { x: number; y: number } | null = null;
let myRoomCode = '';
let wsOpen = false;

// Pre-game loadout: which towers this player brings into the match.
const DEFAULT_LOADOUT: TowerType[] = ['basic', 'rapid', 'spread', 'sniper', 'artillery', 'splash', 'support', 'repair'];
const myLoadout = new Set<TowerType>(DEFAULT_LOADOUT.slice(0, LOADOUT_SIZE));

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

// ── Loadout picker (lobby) ────────────────────────────────────────────────────
function buildLoadoutPicker(): void {
  loadoutGrid.innerHTML = '';
  for (const [type, cfg] of TOWER_ENTRIES) {
    const btn = document.createElement('button');
    btn.className = 'lo-btn';
    btn.dataset.type = type;
    btn.innerHTML = `<span class="lo-glyph">${cfg.glyph}</span><span class="lo-label">${cfg.label}</span><span class="lo-cost">$${cfg.cost}</span>`;
    // Tap shows the detail panel (touch-friendly) and toggles the pick; desktop
    // also previews on hover.
    btn.addEventListener('click', () => { toggleLoadout(type); renderLoadoutDetail(type); });
    btn.addEventListener('mouseenter', () => renderLoadoutDetail(type));
    loadoutGrid.appendChild(btn);
  }
  refreshLoadoutUI();
  renderLoadoutDetail(TOWER_ENTRIES[0][0]);
}

function toggleLoadout(type: TowerType): void {
  if (myLoadout.has(type)) myLoadout.delete(type);
  else if (myLoadout.size < LOADOUT_SIZE) myLoadout.add(type);
  refreshLoadoutUI();
}

// Shared special-ability description, used by both the lobby detail panel and
// the in-game tower info panel.
function specialText(c: (typeof TOWER_CONFIGS)[TowerType]): string {
  if (c.lob) return '越頂拋射、隨機砸落';
  if (c.wallHp) return '5×5 護牆，破壞後 15 秒重建';
  if (c.spreadCount > 1) return `扇形 ${c.spreadCount} 連發`;
  if (c.splashRadius > 0) return '範圍爆炸染色';
  if (c.speedBoost > 0) return `周圍友軍射速 +${Math.round(c.speedBoost * 100)}%`;
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
      <span class="ld-glyph">${c.glyph}</span>
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
  joinBtn.disabled = !ready;
}

// ── Tower panel buttons ───────────────────────────────────────────────────────
function buildTowerPanel(): void {
  towerPanel.innerHTML = '';
  for (const [type, cfg] of loadoutOrdered()) {
    const btn = document.createElement('button');
    btn.className = 'tower-btn';
    btn.dataset.type = type;
    btn.innerHTML = `<span class="tw-glyph">${cfg.glyph}</span><span class="tw-label">${cfg.label}</span><span class="tw-cost">$${cfg.cost}</span>`;
    btn.addEventListener('click', () => selectTower(type));
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

  towerInfo.innerHTML = `
    <div class="ti-header">
      <span class="ti-glyph">${cfg.glyph}</span>
      <span class="ti-name">${cfg.label}</span>
      <span class="ti-role" style="background:#22c55e;color:#052e16">Lv.${tower.level}</span>
      <span class="ti-cost">${cfg.role}</span>
    </div>
    <div class="ti-desc">
      範圍×${m.range.toFixed(1)} &nbsp;射速×${m.speed.toFixed(1)} &nbsp;傷害×${m.dmg.toFixed(1)} &nbsp;血量×${m.hp.toFixed(1)}
      ${nextM ? `<span style="color:#334155"> → Lv.${tower.level + 1}: 範圍×${nextM.range.toFixed(1)} 射速×${nextM.speed.toFixed(1)} 傷害×${nextM.dmg.toFixed(1)}</span>` : ''}
    </div>
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
    const upgCost = Math.floor(cfg.cost * UPGRADE_COST_RATIO);
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
      <span class="ti-glyph">${c.glyph}</span>
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
  if (x >= 0 && x < 24 && y >= 0 && y < 16) hovered = { x, y };
  else hovered = null;

  if (!currentState || !myId || !selectedTower) { canvas.style.cursor = 'default'; return; }
  const state = currentState;
  const canPlace = state.board[y]?.[x] === myId && !state.towers.some(t => t.x === x && t.y === y);
  canvas.style.cursor = canPlace ? 'crosshair' : 'default';
});

canvas.addEventListener('mouseleave', () => { hovered = null; });

canvas.addEventListener('click', (e) => {
  if (!currentState || !myId) return;
  const { x, y } = getCell(e);
  if (x < 0 || x >= 24 || y < 0 || y >= 16) return;

  const hitTower = currentState.towers.find(t => t.x === x && t.y === y && t.owner === myId);
  if (hitTower) {
    selectedTowerId = hitTower.id;
    renderSelectedTowerInfo(hitTower);
    return;
  }

  if (selectedTowerId !== null) deselectTower();

  if (selectedTower) ws.send({ type: 'PLACE_TOWER', towerType: selectedTower, x, y });
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (!currentState || !myId) return;
  const { x, y } = getCell(e);
  const tower = currentState.towers.find(t => t.x === x && t.y === y && t.owner === myId);
  if (tower) {
    if (selectedTowerId === tower.id) deselectTower();
    ws.send({ type: 'SELL_TOWER', towerId: tower.id });
  }
});

// ── Floating action buttons (created once → reliable clicks) ──
actUpgradeBtn.addEventListener('click', () => {
  if (selectedTowerId) ws.send({ type: 'UPGRADE_TOWER', towerId: selectedTowerId });
});
actSellBtn.addEventListener('click', () => {
  if (!selectedTowerId) return;
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

  const total = 24 * 16;
  p1MoneyEl.textContent = `$${Math.floor(state.players.p1.money)}`;
  p2MoneyEl.textContent = `$${Math.floor(state.players.p2.money)}`;
  p1CellsEl.textContent = `${state.players.p1.cells} (${Math.round(state.players.p1.cells / total * 100)}%)`;
  p2CellsEl.textContent = `${state.players.p2.cells} (${Math.round(state.players.p2.cells / total * 100)}%)`;

  const p1pct = state.players.p1.cells / total * 100;
  const p2pct = state.players.p2.cells / total * 100;
  terrP1El.style.width      = p1pct + '%';
  terrNeutralEl.style.width = Math.max(0, 100 - p1pct - p2pct) + '%';
  terrP2El.style.width      = p2pct + '%';

  // Dim tower buttons if can't afford
  if (myId) {
    const money = state.players[myId].money;
    document.querySelectorAll<HTMLButtonElement>('.tower-btn').forEach(btn => {
      const type = btn.dataset.type as TowerType;
      btn.disabled = TOWER_CONFIGS[type].cost > money;
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
      break;
    case 'STATE':
      currentState = msg.state;
      if (selectedTowerId) {
        const sel = currentState.towers.find(t => t.id === selectedTowerId);
        if (sel) renderSelectedTowerInfo(sel);
        else deselectTower();
      }
      break;
    case 'GAME_OVER': {
      selectedTowerId = null;
      towerActionsEl.style.display = 'none';
      currentState = msg.finalState;
      const w = msg.winner;
      overTitle.textContent = w === 'draw' ? 'DRAW!' : w === myId ? 'YOU WIN!' : 'YOU LOSE!';
      overTitle.style.color = w === 'draw' ? '#facc15' : w === myId ? '#4ade80' : '#f87171';
      const fs = msg.finalState;
      const p1p = Math.round(fs.players.p1.cells / 384 * 100);
      const p2p = Math.round(fs.players.p2.cells / 384 * 100);
      overTerrP1El.style.width      = p1p + '%';
      overTerrNeutralEl.style.width = Math.max(0, 100 - p1p - p2p) + '%';
      overTerrP2El.style.width      = p2p + '%';
      overP1LabelEl.textContent = `P1  ${p1p}%`;
      overP2LabelEl.textContent = `${p2p}%  P2`;
      overStats.textContent = `${fs.players.p1.cells} 格 vs ${fs.players.p2.cells} 格`;
      showScreen('gameover');
      break;
    }
    case 'ERROR':
      lobbyError.textContent = msg.message;
      break;
  }
});

// ── Lobby buttons ─────────────────────────────────────────────────────────────
function currentLoadout(): TowerType[] {
  return loadoutOrdered().map(([t]) => t);
}

createBtn.addEventListener('click', () => {
  lobbyError.textContent = '';
  ws.send({ type: 'CREATE_ROOM', loadout: currentLoadout() });
});

joinBtn.addEventListener('click', () => {
  const code = codeInput.value.trim().toUpperCase();
  if (!code) { lobbyError.textContent = 'Enter a room code'; return; }
  lobbyError.textContent = '';
  ws.send({ type: 'JOIN_ROOM', code, loadout: currentLoadout() });
});

codeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinBtn.click();
});

playAgainBtn.addEventListener('click', () => location.reload());

// ── Render loop ───────────────────────────────────────────────────────────────
function loop(): void {
  if (currentState) {
    renderer.draw(currentState, myId, selectedTower, hovered, selectedTowerId);
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
  } else {
    connStatus.textContent = '連線中斷，自動重新連線中…';
    wsOpen = false;
  }
  refreshLobby();
});

// ── Init ──────────────────────────────────────────────────────────────────────
showScreen('lobby');
buildLoadoutPicker();
refreshLobby();
ws.connect();
requestAnimationFrame(loop);
