import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ooip, darcyRadialRate, arpsRate, arpsCumulative, hydrostatic, killMudWeight,
  npv, dailyRate, wellControlCheck, formationAt, rateOfPenetration, generateReservoir, wellForecast,
} from '../src/reservoir.js';
import { createRng } from '../src/rng.js';

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

test('volumetric OOIP matches hand calculation', () => {
  // 7758 * 100 * 50 * 0.2 * (1 - 0.25) / 1.2 = 4,848,750 STB
  close(ooip({ area: 100, thickness: 50, porosity: 0.2, sw: 0.25, bo: 1.2 }), 4_848_750);
});

test('Darcy radial inflow matches hand calculation and responds to skin', () => {
  const p = { k: 50, h: 40, pr: 3000, pwf: 1500, mu: 1.5, bo: 1.2, re: 1490, rw: 0.354, skin: 0 };
  const expected = (0.00708 * 50 * 40 * 1500) / (1.5 * 1.2 * (Math.log(1490 / 0.354) - 0.75));
  close(darcyRadialRate(p), expected);
  assert.ok(darcyRadialRate({ ...p, skin: -3 }) > darcyRadialRate(p), 'stimulation must increase rate');
  assert.ok(darcyRadialRate({ ...p, skin: 5 }) < darcyRadialRate(p), 'damage must decrease rate');
  assert.equal(darcyRadialRate({ ...p, pwf: 3500 }), 0, 'no negative production');
});

test('Arps decline: exponential, harmonic, hyperbolic', () => {
  close(arpsRate(1000, 0.001, 0, 365), 1000 * Math.exp(-0.365));
  close(arpsRate(1000, 0.001, 1, 365), 1000 / 1.365);
  close(arpsRate(1000, 0.001, 0.5, 365), 1000 / Math.pow(1 + 0.5 * 0.365, 2));
});

test('Arps cumulative equals numerical integral of rate', () => {
  for (const b of [0, 0.5, 1]) {
    const qi = 1200, di = 0.002, T = 1000, steps = 100_000;
    let sum = 0;
    for (let i = 0; i < steps; i++) sum += arpsRate(qi, di, b, (i + 0.5) * (T / steps)) * (T / steps);
    close(arpsCumulative(qi, di, b, T), sum, 1e-6);
  }
});

test('hydrostatic pressure and IWCF kill mud weight', () => {
  close(hydrostatic(10, 10_000), 5_200);
  // OMW 10 ppg, SIDPP 520 psi, TVD 10,000 ft → +1.0 ppg
  close(killMudWeight(10, 520, 10_000), 11);
});

test('well-control check: kick, ok, losses', () => {
  const d = 6000; // overpressured shale: pore 0.60 psi/ft (11.54 ppg), frac 0.82 (15.77 ppg)
  assert.equal(formationAt(d).name, 'Overpressured Shale');
  assert.equal(wellControlCheck(d, 9.0).status, 'kick');
  assert.equal(wellControlCheck(d, 12.5).status, 'ok');
  assert.equal(wellControlCheck(d, 16.5).status, 'losses');
});

test('ROP increases with better bit and decreases with overbalance', () => {
  assert.ok(rateOfPenetration(3000, 2, 9) > rateOfPenetration(3000, 1, 9));
  assert.ok(rateOfPenetration(3000, 1, 9) > rateOfPenetration(3000, 1, 14));
});

test('NPV and daily rate conversion', () => {
  close(npv(0.1, [-100, 110]), 0);
  close(Math.pow(1 + dailyRate(0.1), 365), 1.1);
});

test('generated reservoirs are physically sensible and forecastable', () => {
  const rng = createRng('test-field');
  for (let i = 0; i < 200; i++) {
    const r = generateReservoir(rng);
    assert.ok(r.porosity > 0 && r.porosity < 0.35);
    assert.ok(r.sw > 0 && r.sw < 1);
    const f = wellForecast(r, { skin: 0, recoveryBonus: 0, pwf: 1200 });
    assert.ok(f.qi > 20 && f.qi < 40_000, `qi out of range: ${f.qi}`);
    assert.ok(f.eur > 0 && f.eur < f.ooip);
  }
});
