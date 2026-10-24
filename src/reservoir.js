// Petroleum engineering core — pure functions, oilfield units, no DOM.
// Every formula here is covered by tests/reservoir.test.mjs and documented in
// docs/PETROLEUM_MODEL.md.

export const PSI_PER_FT_PER_PPG = 0.052; // hydrostatic constant

/** Volumetric original oil in place, STB. A [acres], h [ft], phi, Sw [fraction], Bo [rb/STB] */
export function ooip({ area, thickness, porosity, sw, bo }) {
  return (7758 * area * thickness * porosity * (1 - sw)) / bo;
}

/** Steady-state-ish radial inflow (pseudo-steady state, Darcy), STB/d. */
export function darcyRadialRate({ k, h, pr, pwf, mu, bo, re, rw, skin }) {
  const denom = mu * bo * (Math.log(re / rw) - 0.75 + skin);
  if (denom <= 0) throw new RangeError('Inflow denominator must be positive (check skin vs. ln(re/rw)).');
  return Math.max(0, (0.00708 * k * h * (pr - pwf)) / denom);
}

/** Productivity index J = q / (Pr - Pwf), STB/d/psi */
export function productivityIndex(params) {
  return darcyRadialRate({ ...params, pwf: params.pr - 1 });
}

/** Arps decline rate at time t [days]. Di is nominal decline per day. */
export function arpsRate(qi, di, b, t) {
  if (b === 0) return qi * Math.exp(-di * t);
  if (b === 1) return qi / (1 + di * t);
  return qi / Math.pow(1 + b * di * t, 1 / b);
}

/** Arps cumulative production Np at time t [days], STB. */
export function arpsCumulative(qi, di, b, t) {
  const q = arpsRate(qi, di, b, t);
  if (b === 0) return (qi - q) / di;
  if (b === 1) return (qi / di) * Math.log(1 + di * t);
  return (Math.pow(qi, b) / ((1 - b) * di)) * (Math.pow(qi, 1 - b) - Math.pow(q, 1 - b));
}

/** Hydrostatic pressure, psi. mudWeight [ppg], tvd [ft] */
export function hydrostatic(mudWeight, tvd) {
  return PSI_PER_FT_PER_PPG * mudWeight * tvd;
}

/** Gradient (psi/ft) to equivalent mud weight (ppg) */
export function gradientToPpg(gradient) {
  return gradient / PSI_PER_FT_PER_PPG;
}

/** IWCF kill mud weight: KMW = OMW + SIDPP / (0.052 * TVD), ppg */
export function killMudWeight(omw, sidpp, tvd) {
  return omw + sidpp / (PSI_PER_FT_PER_PPG * tvd);
}

/** Net present value of evenly spaced cash flows. rate is per period; cf[0] is t=0. */
export function npv(rate, cashflows) {
  return cashflows.reduce((acc, cf, t) => acc + cf / Math.pow(1 + rate, t), 0);
}

/** Convert an effective annual rate to an effective daily rate. */
export function dailyRate(annual) {
  return Math.pow(1 + annual, 1 / 365) - 1;
}

/** Stratigraphic column used by the drilling phase. Depths in ft TVD. */
export const FORMATIONS = [
  { name: 'Recent Alluvium & Clay', top: 0, base: 2500, poreGrad: 0.465, fracGrad: 0.7, hardness: 1.0, color: 0x8a7a5c },
  { name: 'Miocene Sand–Shale', top: 2500, base: 5000, poreGrad: 0.465, fracGrad: 0.75, hardness: 1.4, color: 0x6f6a58 },
  { name: 'Overpressured Shale', top: 5000, base: 6800, poreGrad: 0.6, fracGrad: 0.82, hardness: 1.8, color: 0x4b4f55 },
  { name: 'Cap Rock (Limestone)', top: 6800, base: 7200, poreGrad: 0.52, fracGrad: 0.85, hardness: 2.2, color: 0x9a9384 },
  { name: 'Reservoir Sandstone', top: 7200, base: 8000, poreGrad: 0.52, fracGrad: 0.8, hardness: 1.3, color: 0xc29a4a },
];

export const TARGET_DEPTH = 8000;
export const RESERVOIR_TOP = 7200;

export function formationAt(depth) {
  return FORMATIONS.find((f) => depth >= f.top && depth < f.base) ?? FORMATIONS[FORMATIONS.length - 1];
}

/** Rate of penetration, ft/hr. Softer rock + better bit = faster. */
export function rateOfPenetration(depth, bitMultiplier, mudWeight) {
  const f = formationAt(depth);
  const base = 95 / f.hardness;
  // Overbalance "chip hold-down": heavier mud than needed slows drilling a bit.
  const overbalancePpg = Math.max(0, mudWeight - gradientToPpg(f.poreGrad));
  const chipHoldDown = 1 / (1 + 0.08 * overbalancePpg);
  return base * bitMultiplier * chipHoldDown;
}

/**
 * Well-control check at a given depth & mud weight.
 * Returns { status: 'ok' | 'kick' | 'losses', underbalancePsi, overbalancePsi, window:[minPpg,maxPpg] }
 */
export function wellControlCheck(depth, mudWeight) {
  const f = formationAt(depth);
  const pp = f.poreGrad * depth;
  const fp = f.fracGrad * depth;
  const hp = hydrostatic(mudWeight, depth);
  const window = [gradientToPpg(f.poreGrad), gradientToPpg(f.fracGrad)];
  if (hp < pp) return { status: 'kick', underbalancePsi: pp - hp, overbalancePsi: 0, window };
  if (hp > fp) return { status: 'losses', underbalancePsi: 0, overbalancePsi: hp - fp, window };
  return { status: 'ok', underbalancePsi: 0, overbalancePsi: hp - pp, window };
}

/** Randomised but physically sensible reservoir for a new field. */
export function generateReservoir(rng) {
  return {
    area: Math.round(rng.range(160, 640)), // acres
    thickness: Math.round(rng.range(30, 100)), // ft net pay
    porosity: +rng.range(0.14, 0.28).toFixed(3),
    sw: +rng.range(0.18, 0.38).toFixed(3),
    bo: +rng.range(1.15, 1.45).toFixed(3),
    k: Math.round(rng.range(10, 150)), // md
    mu: +rng.range(0.8, 3.5).toFixed(2), // cp
    pr: Math.round(0.52 * 7600 + rng.range(-150, 250)), // psia, slightly overpressured
    re: 1490, // ft (~160 acre drainage)
    rw: 0.354, // ft (8.5" hole)
    baseRecovery: +rng.range(0.12, 0.22).toFixed(3),
    b: +rng.range(0.3, 0.9).toFixed(2),
    di: +(rng.range(0.25, 0.6) / 365).toFixed(5), // nominal per day
  };
}

/** Initial rate & EUR for a completed well. */
export function wellForecast(res, { skin, recoveryBonus, pwf }) {
  const qi = darcyRadialRate({ k: res.k, h: res.thickness, pr: res.pr, pwf, mu: res.mu, bo: res.bo, re: res.re, rw: res.rw, skin });
  const n = ooip(res);
  const rf = Math.min(0.6, res.baseRecovery + recoveryBonus);
  return { qi, ooip: n, recoveryFactor: rf, eur: n * rf };
}
