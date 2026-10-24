import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, tickDrilling, resolveKick, acknowledgeLosses, completeWell, tickProduction, nextField,
  buyBundle, openCrate, equip, validateSave, serialize, START_BUDGET,
} from '../src/game.js';
import { createRng } from '../src/rng.js';

function drillToTD(g) {
  g.drilling = true;
  for (let i = 0; i < 20_000 && g.phase === 'drilling'; i++) {
    tickDrilling(g, 2);
    if (g.event?.type === 'kick') { resolveKick(g); g.drilling = true; }
    if (g.event?.type === 'losses') { acknowledgeLosses(g); g.drilling = true; }
  }
}

test('a full field lifecycle reaches TD, produces, and depletes', () => {
  const g = newGame('lifecycle');
  drillToTD(g);
  assert.equal(g.phase, 'completion');
  assert.ok(g.kicks >= 1, 'drilling into the overpressured shale at 9.0 ppg must take a kick');
  completeWell(g);
  assert.equal(g.phase, 'production');
  const rng = createRng('prices');
  for (let i = 0; i < 10_000 && g.phase === 'production'; i++) tickProduction(g, 15, rng);
  assert.equal(g.phase, 'depleted');
  assert.ok(g.well.np > 0 && g.well.np <= g.well.eur + 1);
  assert.ok(Number.isFinite(g.project.npv));
  nextField(g);
  assert.equal(g.fieldNo, 2);
  assert.equal(g.phase, 'drilling');
});

test('kick response uses IWCF kill mud weight and ends the event', () => {
  const g = newGame('kick');
  g.depth = 4990;
  g.drilling = true;
  while (!g.event) tickDrilling(g, 0.25);
  assert.equal(g.event.type, 'kick');
  const { kmw, omw, sidpp, depth } = g.event;
  assert.ok(kmw >= omw + sidpp / (0.052 * depth) - 1e-9);
  resolveKick(g);
  assert.equal(g.event, null);
  assert.equal(g.mudWeight, kmw);
});

test('crates: buying, opening, duplicates → scrap, equipping', () => {
  const g = newGame('crates');
  buyBundle(g, 'b4');
  assert.equal(g.realSpent, 49.99);
  let opened = 0;
  while (openCrate(g, 'dbx')) opened++;
  assert.equal(opened, Math.floor(5500 / 300));
  assert.equal(g.dbx, 5500 - opened * 300);
  const owned = Object.keys(g.inventory);
  assert.ok(owned.length > 0);
  assert.ok(equip(g, owned[0]));
  assert.ok(!equip(g, 'not-a-real-item'));
});

test('budget-funded crates are discounted into project NPV', () => {
  const g = newGame('grind');
  openCrate(g, 'budget');
  assert.equal(g.budget, START_BUDGET - 400_000);
  assert.ok(g.project.npv < 0);
});

test('save round-trip preserves progress but re-derives the reservoir', () => {
  const g = newGame('save');
  buyBundle(g, 'b2');
  openCrate(g, 'dbx');
  const restored = validateSave(serialize(g));
  assert.ok(restored);
  assert.equal(restored.dbx, g.dbx);
  assert.equal(restored.cratesOpened, 1);
  assert.deepEqual(restored.reservoir, g.reservoir);
});

test('tampered or malicious saves are rejected or sanitised', () => {
  const g = newGame('evil');
  const base = JSON.parse(serialize(g));
  assert.equal(validateSave('not json'), null);
  assert.equal(validateSave({ ...base, dbx: Number.MAX_VALUE }), null);
  assert.equal(validateSave({ ...base, pity: 500 }), null);
  assert.equal(validateSave({ ...base, seed: '<img src=x onerror=alert(1)>' }), null);
  assert.equal(validateSave({ ...base, mode: 'admin' }), null);
  const polluted = JSON.parse(JSON.stringify(base).replace('"inventory":{}', '"inventory":{"__proto__":{"isAdmin":true},"pdc":3,"fake":9}'));
  const r = validateSave(polluted);
  assert.ok(r);
  assert.deepEqual(Object.keys(r.inventory), ['pdc']);
  assert.equal(({}).isAdmin, undefined);
  // Equipping something you don't own is dropped
  const r2 = validateSave({ ...base, equipped: { bit: 'diamond-turbo' } });
  assert.equal(r2.equipped.bit, null);
});
