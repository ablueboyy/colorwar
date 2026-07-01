// Headless balance simulator: runs many bot-vs-bot games with random loadouts
// and reports each tower's win rate + usage, to surface over/under-powered ones.
//
//   npx tsx src/server/sim.ts [games]     (default 300)
//
// Caveat: results reflect the naive built-in bot. It can't use 炸彈 (an active
// ability it never places) and rarely sets up 獻祭砲, so those rows are noise.
import { createInitialState, stepGame } from '../shared/gameLogic';
import { placeTower, upgradeTower } from '../shared/actions';
import { decideBotAction, BOT_DECISION_TICKS } from './ai';
import { TOWER_CONFIGS, GAME_DURATION, TICK_RATE, LOADOUT_SIZE } from '../shared/config';
import type { PlayerId, TowerType } from '../shared/types';

const ALL = Object.keys(TOWER_CONFIGS) as TowerType[];

function randomLoadout(): TowerType[] {
  const pool = [...ALL];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, LOADOUT_SIZE);
}

type Placed = Record<PlayerId, Partial<Record<TowerType, number>>>;

function runGame(loadouts: Record<PlayerId, TowerType[]>, placed: Placed): PlayerId | 'draw' {
  const state = createInitialState();
  state.phase = 'playing';
  const cap = Math.ceil(GAME_DURATION * TICK_RATE) + 40;
  let ticks = 0;
  while (state.phase === 'playing' && ticks < cap) {
    stepGame(state);
    ticks++;
    if (ticks % BOT_DECISION_TICKS !== 0) continue;
    for (const pid of ['p1', 'p2'] as PlayerId[]) {
      const action = decideBotAction(state, pid, loadouts[pid]);
      if (!action) continue;
      if (action.kind === 'place') {
        const before = state.towers.length;
        placeTower(state, loadouts[pid], pid, action.type, action.x, action.y);
        if (state.towers.length > before) placed[pid][action.type] = (placed[pid][action.type] ?? 0) + 1;
      } else {
        upgradeTower(state, pid, action.towerId);
      }
    }
  }
  return state.winner ?? 'draw';
}

interface Stat { games: number; wins: number; losses: number; placed: number; }

function main(): void {
  const games = Number(process.argv[2] ?? 200);
  const stat = new Map<TowerType, Stat>(ALL.map(t => [t, { games: 0, wins: 0, losses: 0, placed: 0 }]));
  let p1 = 0, p2 = 0, draws = 0;

  const t0 = Date.now();
  for (let g = 0; g < games; g++) {
    const loadouts = { p1: randomLoadout(), p2: randomLoadout() };
    const placed: Placed = { p1: {}, p2: {} };
    const winner = runGame(loadouts, placed);
    if (winner === 'p1') p1++; else if (winner === 'p2') p2++; else draws++;

    for (const pid of ['p1', 'p2'] as PlayerId[]) {
      const won = winner === pid;
      const lost = winner !== 'draw' && winner !== pid;
      for (const t of loadouts[pid]) {
        const s = stat.get(t)!;
        s.games++;
        if (won) s.wins++; else if (lost) s.losses++;
        s.placed += placed[pid][t] ?? 0;
      }
    }
  }

  const rows = [...stat.entries()]
    .map(([t, s]) => ({
      t,
      label: TOWER_CONFIGS[t].label,
      cost: TOWER_CONFIGS[t].cost,
      games: s.games,
      winRate: s.wins + s.losses > 0 ? (100 * s.wins) / (s.wins + s.losses) : 0,
      avgPlaced: s.games > 0 ? s.placed / s.games : 0,
    }))
    .sort((a, b) => b.winRate - a.winRate);

  console.log(`\n=== ${games} games | p1 ${p1} / p2 ${p2} / draw ${draws} | ${(Date.now() - t0)}ms ===`);
  console.log('(win% = win rate of the player holding that tower; >55 strong, <45 weak)\n');
  console.log('tower        cost  games  win%   avg placed/game');
  console.log('------------------------------------------------');
  for (const r of rows) {
    const flag = r.avgPlaced < 0.4 ? '  ⚠ bot rarely uses' : '';
    console.log(
      `${r.label.padEnd(6, '　')} ${String(r.cost).padStart(5)} ${String(r.games).padStart(5)}  ` +
      `${r.winRate.toFixed(1).padStart(5)}  ${r.avgPlaced.toFixed(1).padStart(5)}${flag}`,
    );
  }
  console.log('');
}

main();
