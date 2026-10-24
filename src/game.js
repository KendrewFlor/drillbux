// Game state + simulation tick. No DOM — runs (and is tested) under Node.
import {
  generateReservoir, wellForecast, rateOfPenetration, wellControlCheck, killMudWeight,
  arpsRate, dailyRate, formationAt, TARGET_DEPTH,
} from './reservoir.js';
import { createRng } from './rng.js';
import { ITEMS, itemById, rollCrate, CRATE_COST_DBX, CRATE_COST_PETRODOLLARS, SCRAP_VALUE, BUNDLES } from './economy.js';

export const RIG_DAY_RATE = 180_000; // $/day while drilling
export const START_BUDGET = 60_000_000;
export const DISCOUNT_RATE = 0.1; // effective annual, for NPV
export const ROYALTY = 0.125;
export const OPEX_PER_BBL = 14;
export const FIXED_OPEX_PER_DAY = 45_000;
export const BASE_PWF = 1200; // psia
export const DRILLING_DAMAGE_SKIN = 2;
export const KILL_COST = 1_200_000;
export const LOSSES_COST = 400_000;
export const WORKOVER_COST = 3_500_000;
export const SCRAP_PER_CRATE = 120;

export function newGame(seed) {
  const g = {
    v: 1,
    seed,
    fieldNo: 1,
    mode: 'aaa',
    budget: START_BUDGET,
    dbx: 0,
    scrap: 0,
    realSpent: 0,
    cratesOpened: 0,
    legendaries: 0,
    pity: 0,
    rollCount: 0,
    inventory: {},
    equipped: { bit: null, completion: null, eor: null, cosmetic: null },
    timerResets: 0,
    project: { days: 0, npv: 0, cash: 0 },
  };
  startField(g);
  return g;
}

export function fieldRng(g) {
  return createRng(`${g.seed}:field:${g.fieldNo}`);
}

export function crateRng(g) {
  // Re-derived from seed + roll counter so the save file can't be edited into a better roll stream.
  return createRng(`${g.seed}:crate:${g.rollCount}`);
}

export function startField(g) {
  g.reservoir = generateReservoir(fieldRng(g));
  g.phase = 'drilling';
  g.depth = 0;
  g.mudWeight = 9.0;
  g.drilling = false;
  g.event = null;
  g.kicks = 0;
  g.well = null;
  g.oilPrice = g.oilPrice ?? 78;
  g.fieldStartDays = g.project.days;
  g.fieldCash = 0;
}

export function effect(g, slot, key, fallback) {
  const id = g.equipped[slot];
  const item = id ? itemById(id) : null;
  return item?.effect?.[key] ?? fallback;
}

function spend(g, dollars, days) {
  const i = dailyRate(DISCOUNT_RATE);
  g.budget -= dollars;
  g.fieldCash -= dollars;
  g.project.cash -= dollars;
  g.project.npv -= dollars / Math.pow(1 + i, g.project.days);
  g.project.days += days;
}

/** Advance drilling by `hours` of rig time. */
export function tickDrilling(g, hours) {
  if (g.phase !== 'drilling' || !g.drilling || g.event) return;
  const bit = effect(g, 'bit', 'rop', 1);
  let remaining = hours;
  while (remaining > 0 && !g.event) {
    const step = Math.min(remaining, 0.25);
    const rop = rateOfPenetration(g.depth, bit, g.mudWeight);
    const next = Math.min(TARGET_DEPTH, g.depth + rop * step);
    spend(g, (RIG_DAY_RATE * step) / 24, step / 24);
    g.depth = next;
    remaining -= step;
    const wc = wellControlCheck(g.depth, g.mudWeight);
    if (wc.status === 'kick') {
      const sidpp = Math.ceil(wc.underbalancePsi);
      const kmw = Math.ceil(killMudWeight(g.mudWeight, sidpp, g.depth) * 10) / 10;
      g.event = { type: 'kick', depth: Math.round(g.depth), sidpp, omw: g.mudWeight, kmw, formation: formationAt(g.depth).name };
      g.drilling = false;
      g.kicks++;
    } else if (wc.status === 'losses') {
      g.event = { type: 'losses', depth: Math.round(g.depth), mw: g.mudWeight, maxPpg: +wc.window[1].toFixed(2), formation: formationAt(g.depth).name };
      g.drilling = false;
      spend(g, LOSSES_COST, 0.5);
    }
    if (g.depth >= TARGET_DEPTH) {
      g.drilling = false;
      g.phase = 'completion';
      break;
    }
  }
}

export function resolveKick(g) {
  if (g.event?.type !== 'kick') return;
  g.mudWeight = g.event.kmw;
  spend(g, KILL_COST, 1.5);
  g.event = null;
}

export function acknowledgeLosses(g) {
  if (g.event?.type !== 'losses') return;
  g.mudWeight = Math.max(8.6, Math.floor((g.event.maxPpg - 0.4) * 10) / 10);
  g.event = null;
}

export function completeWell(g) {
  if (g.phase !== 'completion') return;
  const skin = DRILLING_DAMAGE_SKIN + effect(g, 'completion', 'skin', 0);
  const pwf = BASE_PWF - effect(g, 'eor', 'pwfDrop', 0);
  const f = wellForecast(g.reservoir, { skin, recoveryBonus: effect(g, 'eor', 'recovery', 0), pwf });
  g.well = { ...f, skin, pwf, t: 0, np: 0, mult: 1, rate: f.qi };
  spend(g, 4_000_000, 10); // completion cost & time
  g.phase = 'production';
}

export function currentEur(g) {
  if (!g.well) return 0;
  const rf = Math.min(0.6, g.reservoir.baseRecovery + effect(g, 'eor', 'recovery', 0));
  return g.well.ooip * rf;
}

/** Workover: re-apply the currently equipped completion item to a producing well. */
export function workover(g) {
  if (g.phase !== 'production') return false;
  const newSkin = DRILLING_DAMAGE_SKIN + effect(g, 'completion', 'skin', 0);
  if (newSkin >= g.well.skin) return false;
  const r = g.reservoir;
  const lnTerm = Math.log(r.re / r.rw) - 0.75;
  g.well.mult *= (lnTerm + g.well.skin) / (lnTerm + newSkin);
  g.well.skin = newSkin;
  spend(g, WORKOVER_COST, 7);
  return true;
}

/** Advance production by `days`. */
export function tickProduction(g, days, rng) {
  if (g.phase !== 'production') return;
  const i = dailyRate(DISCOUNT_RATE);
  const w = g.well;
  const r = g.reservoir;
  const eur = currentEur(g);
  // Geometric Brownian motion for oil price
  const dt = days / 365;
  g.oilPrice = Math.min(180, Math.max(25, g.oilPrice * Math.exp((0.02 - 0.5 * 0.35 ** 2) * dt + 0.35 * Math.sqrt(dt) * rng.normal())));
  const q = arpsRate(w.qi, r.di, r.b, w.t + days / 2) * w.mult;
  const produced = Math.min(Math.max(0, eur - w.np), q * days);
  w.np += produced;
  w.t += days;
  w.rate = produced / days;
  const netPerBbl = g.oilPrice * (1 - ROYALTY) - OPEX_PER_BBL;
  const cash = produced * netPerBbl - FIXED_OPEX_PER_DAY * days;
  g.budget += cash;
  g.fieldCash += cash;
  g.project.cash += cash;
  g.project.npv += cash / Math.pow(1 + i, g.project.days + days / 2);
  g.project.days += days;
  const economicLimit = FIXED_OPEX_PER_DAY / Math.max(1, netPerBbl);
  if (w.np >= eur - 1 || (w.rate < economicLimit && w.t > 180)) g.phase = 'depleted';
}

export function nextField(g) {
  if (g.phase !== 'depleted') return;
  g.fieldNo++;
  spend(g, 2_500_000, 14); // rig move
  startField(g);
}

// ---------------- Monetization ----------------

export function buyBundle(g, bundleId) {
  const b = BUNDLES.find((x) => x.id === bundleId);
  if (!b) return null;
  g.dbx += b.dbx;
  g.realSpent = +(g.realSpent + b.price).toFixed(2);
  return b;
}

export function canOpen(g, currency) {
  if (currency === 'dbx') return g.dbx >= CRATE_COST_DBX;
  if (currency === 'budget') return g.budget >= CRATE_COST_PETRODOLLARS;
  if (currency === 'scrap') return g.scrap >= SCRAP_PER_CRATE;
  return false;
}

export function openCrate(g, currency) {
  if (!canOpen(g, currency)) return null;
  if (currency === 'dbx') g.dbx -= CRATE_COST_DBX;
  if (currency === 'budget') spend(g, CRATE_COST_PETRODOLLARS, 0);
  if (currency === 'scrap') g.scrap -= SCRAP_PER_CRATE;
  const res = rollCrate(crateRng(g), g.pity);
  g.rollCount++;
  g.pity = res.pity;
  g.cratesOpened++;
  if (res.rarity === 'legendary') g.legendaries++;
  const dup = (g.inventory[res.item.id] ?? 0) > 0;
  g.inventory[res.item.id] = (g.inventory[res.item.id] ?? 0) + 1;
  if (dup) g.scrap += SCRAP_VALUE[res.rarity];
  return { ...res, duplicate: dup };
}

export function equip(g, itemId) {
  const item = itemById(itemId);
  if (!item || !g.inventory[itemId]) return false;
  g.equipped[item.slot] = g.equipped[item.slot] === itemId ? null : itemId;
  return true;
}

// ---------------- Save validation ----------------
// localStorage is user-controlled input: never trust it. Anything malformed → fresh game.

const finite = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

export function validateSave(raw) {
  try {
    const s = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!s || s.v !== 1 || typeof s.seed !== 'string' || !/^[a-z0-9:-]{1,64}$/i.test(s.seed)) return null;
    const numericChecks = [
      [s.fieldNo, 1, 1e4], [s.budget, -1e12, 1e12], [s.dbx, 0, 1e9], [s.scrap, 0, 1e9], [s.realSpent, 0, 1e9],
      [s.cratesOpened, 0, 1e9], [s.legendaries, 0, 1e9], [s.pity, 0, 90], [s.rollCount, 0, 1e9], [s.depth, 0, 8000],
      [s.mudWeight, 8, 20], [s.oilPrice, 1, 1000], [s.timerResets, 0, 1e9],
    ];
    if (!numericChecks.every(([v, lo, hi]) => finite(v, lo, hi))) return null;
    if (!['aaa', 'regulator'].includes(s.mode)) return null;
    if (!['drilling', 'completion', 'production', 'depleted'].includes(s.phase)) return null;
    const ids = new Set(ITEMS.map((i) => i.id));
    const inventory = {};
    for (const [k, v] of Object.entries(s.inventory ?? {})) if (ids.has(k) && finite(v, 0, 1e6)) inventory[k] = Math.floor(v);
    const equipped = { bit: null, completion: null, eor: null, cosmetic: null };
    for (const slot of Object.keys(equipped)) {
      const id = s.equipped?.[slot];
      if (id && ids.has(id) && inventory[id] && itemById(id).slot === slot) equipped[slot] = id;
    }
    const g = newGame(s.seed);
    Object.assign(g, {
      fieldNo: s.fieldNo, mode: s.mode, budget: s.budget, dbx: s.dbx, scrap: s.scrap, realSpent: s.realSpent,
      cratesOpened: s.cratesOpened, legendaries: s.legendaries, pity: s.pity, rollCount: s.rollCount,
      inventory, equipped, timerResets: s.timerResets, oilPrice: s.oilPrice,
    });
    if (s.project && finite(s.project.days, 0, 1e7) && finite(s.project.npv, -1e13, 1e13) && finite(s.project.cash, -1e13, 1e13)) {
      g.project = { days: s.project.days, npv: s.project.npv, cash: s.project.cash };
    }
    // The reservoir is always re-derived from the seed, never read from storage.
    startField(g);
    if (s.phase === 'drilling' || s.phase === 'completion') {
      g.phase = s.phase;
      g.depth = s.depth;
      g.mudWeight = s.mudWeight;
    }
    // Producing/depleted wells restart at completion for simplicity (no state to tamper with).
    if (s.phase === 'production' || s.phase === 'depleted') { g.phase = 'completion'; g.depth = 8000; g.mudWeight = s.mudWeight; }
    return g;
  } catch {
    return null;
  }
}

export function serialize(g) {
  const { reservoir, well, event, drilling, ...rest } = g;
  return JSON.stringify(rest);
}
