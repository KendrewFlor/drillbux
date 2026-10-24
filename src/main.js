import { createScene } from './scene.js';
import { h, setText, fmt } from './dom.js';
import { createRng, freshSeed } from './rng.js';
import {
  RARITIES, ITEMS, BUNDLES, PITY, CRATE_COST_DBX, CRATE_COST_PETRODOLLARS, SCRAP_VALUE,
  itemById, legendaryChance, expectedPullsToLegendary, effectiveLegendaryRate, cheapestPurchase,
  bestDollarsPerCrate, expectedDollarsPerLegendary,
} from './economy.js';
import { formationAt, TARGET_DEPTH, RESERVOIR_TOP, gradientToPpg, ooip, hydrostatic } from './reservoir.js';
import {
  newGame, tickDrilling, resolveKick, acknowledgeLosses, completeWell, tickProduction, nextField, workover,
  buyBundle, openCrate, canOpen, equip, effect, currentEur, validateSave, serialize,
  SCRAP_PER_CRATE, WORKOVER_COST,
} from './game.js';

const SAVE_KEY = 'drillbux.save.v1';
const HOURS_PER_SECOND = 22; // rig time while drilling
const DAYS_PER_SECOND = 20; // production time
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Storage (user-controlled input → always validated) ----------
function loadGame() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (raw && raw.length < 100_000) {
      const g = validateSave(raw);
      if (g) return g;
    }
  } catch { /* storage blocked: fine, play without saving */ }
  return newGame(freshSeed());
}
function saveGame() {
  try { window.localStorage.setItem(SAVE_KEY, serialize(game)); } catch { /* ignore */ }
}

let game = loadGame();
let priceRng = createRng(`${game.seed}:price:${game.fieldNo}`);
const rarityColor = Object.fromEntries(RARITIES.map((r) => [r.id, r.color]));
const rarityLabel = Object.fromEntries(RARITIES.map((r) => [r.id, r.label]));

// ---------- Scene ----------
const canvas = document.getElementById('scene');
const scene = createScene(canvas, { reducedMotion });
let xray = false;

function applyCosmetics() {
  scene.setDerrickColor(effect(game, 'cosmetic', 'skin3d', null));
  scene.setFlareColor(effect(game, 'cosmetic', 'flare', null));
}
applyCosmetics();

// ---------- Layout roots ----------
const root = document.getElementById('app');
const refs = {};
let activeTab = 'console';
let offerSeconds = 299;
let crateBusy = false;

function chip(label, refKey, title) {
  return h('div', { class: 'chip', title }, h('span', { class: 'chip-label' }, label), h('span', { class: 'chip-value', ref: (el) => { refs[refKey] = el; } }));
}

function topbar() {
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' },
      h('span', { class: 'brand-mark', 'aria-hidden': 'true' }),
      h('span', { class: 'brand-word' }, 'Drillbux'),
      h('span', { class: 'brand-field', ref: (el) => { refs.field = el; } }),
    ),
    h('div', { class: 'chips' },
      chip('Field budget', 'budget', 'In-game dollars earned from oil sales'),
      chip('Drillbux', 'dbx', 'Premium currency (simulated — no real money is ever charged)'),
      chip('Scrap', 'scrap', 'From duplicate items'),
    ),
    h('div', { class: 'mode-switch', role: 'radiogroup', 'aria-label': 'Monetization mode' },
      ...[['aaa', 'AAA mode'], ['regulator', 'Regulator mode']].map(([id, label]) =>
        h('button', {
          type: 'button', role: 'radio', class: 'mode-btn', 'aria-checked': String(game.mode === id),
          on: { click: () => { game.mode = id; saveGame(); render(); } },
        }, label)),
    ),
  );
}

// ---------- Driller's console ----------
function consolePanel() {
  const g = game;
  const kids = [h('h2', { class: 'panel-title' }, phaseTitle(g.phase))];

  if (g.phase === 'drilling') {
    kids.push(
      gauge('Measured depth', 'depth', 'ft'),
      h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Depth to target', 'aria-valuemin': '0', 'aria-valuemax': String(TARGET_DEPTH), ref: (el) => { refs.depthBar = el; } },
        h('div', { class: 'progress-fill', ref: (el) => { refs.depthFill = el; } }),
        h('div', { class: 'progress-marker', css: { left: `${(RESERVOIR_TOP / TARGET_DEPTH) * 100}%` }, title: 'Top of reservoir' })),
      readout('Formation', 'formation'),
      readout('Rate of penetration', 'rop'),
      readout('Bit', 'bitName'),
      h('div', { class: 'mw' },
        h('label', { for: 'mw', class: 'mw-label' }, 'Mud weight ', h('strong', { ref: (el) => { refs.mwVal = el; } })),
        h('input', {
          id: 'mw', type: 'range', min: '8.6', max: '17', step: '0.1', value: String(g.mudWeight),
          on: { input: (e) => { game.mudWeight = +e.target.value; } }, ref: (el) => { refs.mwInput = el; },
        }),
        h('div', { class: 'window', 'aria-hidden': 'true' },
          h('div', { class: 'window-safe', ref: (el) => { refs.windowSafe = el; } }),
          h('div', { class: 'window-needle', ref: (el) => { refs.windowNeedle = el; } })),
        h('p', { class: 'hint', ref: (el) => { refs.windowText = el; } }),
      ),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn btn-primary', ref: (el) => { refs.drillBtn = el; }, on: { click: () => { game.drilling = !game.drilling; } } }),
        xrayButton(),
      ),
    );
  } else if (g.phase === 'completion') {
    const skin = 2 + effect(g, 'completion', 'skin', 0);
    const r = g.reservoir;
    kids.push(
      h('p', { class: 'lede' }, 'Target depth reached. Review the reservoir, equip a completion or EOR item from the store if you have one, then put the well on production.'),
      table([
        ['Area', `${r.area} acres`], ['Net pay', `${r.thickness} ft`], ['Porosity', fmt.pct(r.porosity)], ['Water saturation', fmt.pct(r.sw)],
        ['Bo', `${r.bo} rb/STB`], ['Permeability', `${r.k} md`], ['Oil viscosity', `${r.mu} cp`], ['Reservoir pressure', `${fmt.int(r.pr)} psia`],
        ['OOIP', fmt.bbl(ooip(r))], ['Expected skin', skin.toFixed(1)],
      ]),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn btn-primary', on: { click: () => { completeWell(game); saveGame(); render(); } } }, 'Complete well ($4.0M)'),
        xrayButton()),
    );
  } else {
    kids.push(
      gauge('Oil rate', 'rate', 'STB/d'),
      readout('Cumulative / EUR', 'np'),
      readout('Recovery factor', 'rf'),
      readout('Skin', 'skin'),
      readout('Oil price', 'price'),
      readout('Field cash flow', 'fieldCash'),
      h('div', { class: 'actions' },
        g.phase === 'production'
          ? h('button', { type: 'button', class: 'btn', title: 'Re-stimulate using your equipped completion item', on: { click: () => { if (!workover(game)) toast('Equip a better completion item first.'); else { toast('Workover done.'); saveGame(); } } } }, `Workover (${fmt.money(WORKOVER_COST)})`)
          : h('button', { type: 'button', class: 'btn btn-primary', on: { click: () => { nextField(game); priceRng = createRng(`${game.seed}:price:${game.fieldNo}`); saveGame(); render(); } } }, 'Move rig to next field'),
        xrayButton()),
    );
    if (g.phase === 'depleted') kids.splice(1, 0, h('p', { class: 'lede' }, 'This well has reached its economic limit.'));
  }
  return h('section', { class: 'panel console', id: 'panel-console', 'aria-label': "Driller's console" }, ...kids);
}

function phaseTitle(p) {
  return { drilling: 'Drilling', completion: 'Completion', production: 'Production', depleted: 'Depleted' }[p];
}
function gauge(label, key, unit) {
  return h('div', { class: 'gauge' }, h('span', { class: 'gauge-value', ref: (el) => { refs[key] = el; } }), h('span', { class: 'gauge-unit' }, unit), h('span', { class: 'gauge-label' }, label));
}
function readout(label, key) {
  return h('div', { class: 'readout' }, h('span', null, label), h('span', { class: 'num', ref: (el) => { refs[key] = el; } }));
}
function table(rows) {
  return h('table', { class: 'kv' }, h('tbody', null, rows.map(([k, v]) => h('tr', null, h('th', { scope: 'row' }, k), h('td', { class: 'num' }, v)))));
}
function xrayButton() {
  return h('button', {
    type: 'button', class: 'btn', 'aria-pressed': String(xray),
    on: { click: (e) => { xray = !xray; scene.setXray(xray); e.currentTarget.setAttribute('aria-pressed', String(xray)); } },
  }, 'Subsurface view');
}

// ---------- Store ----------
function storePanel() {
  const g = game;
  const aaa = g.mode === 'aaa';
  const kids = [];

  if (aaa) {
    kids.push(
      h('div', { class: 'offer' },
        h('span', { class: 'offer-badge' }, 'Limited offer'),
        h('h2', { class: 'offer-title' }, 'Legendary Rig Crate'),
        h('p', { class: 'offer-timer' }, 'Ends in ', h('strong', { ref: (el) => { refs.timer = el; } })),
      ),
    );
  } else {
    kids.push(h('h2', { class: 'panel-title' }, 'Rig crate'));
  }

  kids.push(h('div', { class: 'crate-actions' },
    h('button', { type: 'button', class: 'btn btn-crate', ref: (el) => { refs.openDbx = el; }, on: { click: () => tryOpen('dbx') } },
      aaa ? `Open now · ${CRATE_COST_DBX}` : `Open for ${CRATE_COST_DBX} Drillbux (≈ ${fmt.usd(bestDollarsPerCrate())})`),
    h('button', { type: 'button', class: 'btn', ref: (el) => { refs.openBudget = el; }, on: { click: () => tryOpen('budget') } },
      `Open for ${fmt.money(CRATE_COST_PETRODOLLARS)} field budget`),
    h('button', { type: 'button', class: 'btn', ref: (el) => { refs.openScrap = el; }, on: { click: () => tryOpen('scrap') } },
      `Open for ${SCRAP_PER_CRATE} scrap`),
    h('button', { type: 'button', class: aaa ? 'btn btn-shop' : 'btn', on: { click: openShop } }, aaa ? 'Get more Drillbux!' : 'Buy Drillbux (simulated)'),
  ));

  if (aaa) {
    kids.push(h('button', { type: 'button', class: 'linklike', on: { click: () => showTruth() } }, 'Odds and info'));
  } else {
    kids.push(truthBlock());
  }

  kids.push(h('h3', { class: 'sub' }, 'Equipment'), inventoryList());
  return h('section', { class: 'panel store', id: 'panel-store', 'aria-label': 'Crate store' }, ...kids);
}

function inventoryList() {
  const owned = ITEMS.filter((i) => game.inventory[i.id]);
  if (!owned.length) return h('p', { class: 'hint' }, 'No equipment yet. Each crate holds a drill bit, completion, EOR method or cosmetic.');
  const slotName = { bit: 'Bit', completion: 'Completion', eor: 'EOR', cosmetic: 'Cosmetic' };
  return h('ul', { class: 'inv' }, owned.map((i) => {
    const on = game.equipped[i.slot] === i.id;
    return h('li', { class: 'inv-item', css: { '--rar': rarityColor[i.rarity] } },
      h('div', { class: 'inv-main' },
        h('span', { class: 'inv-name' }, i.name, game.inventory[i.id] > 1 ? ` ×${game.inventory[i.id]}` : ''),
        h('span', { class: 'inv-meta' }, `${rarityLabel[i.rarity]} ${slotName[i.slot].toLowerCase()} — ${effectText(i)}`)),
      h('button', {
        type: 'button', class: 'btn btn-small', 'aria-pressed': String(on),
        on: { click: () => { equip(game, i.id); applyCosmetics(); saveGame(); render(); } },
      }, on ? 'Equipped' : 'Equip'));
  }));
}

function effectText(i) {
  const e = i.effect;
  if (e.rop) return `ROP ×${e.rop}`;
  if (e.skin) return `skin ${e.skin}`;
  if (e.recovery) return `RF +${Math.round(e.recovery * 100)} pts${e.pwfDrop ? `, Pwf −${e.pwfDrop} psi` : ''}`;
  return 'no gameplay effect';
}

function truthBlock() {
  const g = game;
  const exp = expectedPullsToLegendary();
  return h('div', { class: 'truth' },
    h('table', { class: 'odds' },
      h('caption', null, 'Published odds per crate'),
      h('tbody', null, RARITIES.map((r) => h('tr', null, h('th', { scope: 'row', css: { color: r.color } }, r.label), h('td', { class: 'num' }, fmt.pct(r.odds, 1)))))),
    table([
      ['Pity counter', `${g.pity} / ${PITY.hard}`],
      ['Next legendary chance', fmt.pct(legendaryChance(g.pity + 1), 1)],
      ['Expected crates per legendary', exp.toFixed(1)],
      ['Effective legendary rate', fmt.pct(effectiveLegendaryRate(), 2)],
      ['Expected cost per legendary', fmt.usd(expectedDollarsPerLegendary())],
      ['Crates opened', fmt.int(g.cratesOpened)],
      ['Legendaries pulled', fmt.int(g.legendaries)],
      ['Simulated money spent', fmt.usd(g.realSpent)],
      ['Offer timer resets so far', fmt.int(g.timerResets)],
    ]),
    h('p', { class: 'hint' }, 'All purchases are simulated. This project contains no payment code and cannot charge anyone.'),
  );
}

// ---------- Modal dialog ----------
const dialog = h('dialog', { class: 'modal', 'aria-labelledby': 'modal-title' });
document.body.append(dialog);
function showModal(title, body, actions) {
  dialog.replaceChildren(
    h('h2', { id: 'modal-title' }, title),
    h('div', { class: 'modal-body' }, body),
    h('div', { class: 'modal-actions' }, actions),
  );
  if (!dialog.open) dialog.showModal();
}
function closeModal() { if (dialog.open) dialog.close(); }
dialog.addEventListener('cancel', (e) => { if (game.event) e.preventDefault(); });

function showTruth() {
  showModal('Odds and info', truthBlock(), [h('button', { type: 'button', class: 'btn btn-primary', on: { click: closeModal } }, 'Close')]);
}

function openShop(needed = 0) {
  const aaa = game.mode === 'aaa';
  const bestId = BUNDLES[BUNDLES.length - 1].id;
  const cards = BUNDLES.map((b) => {
    const crates = Math.floor((game.dbx + b.dbx) / CRATE_COST_DBX);
    const leftover = (game.dbx + b.dbx) % CRATE_COST_DBX;
    return h('div', { class: 'bundle' },
      aaa && b.id === bestId ? h('span', { class: 'bundle-tag' }, 'Best value') : null,
      aaa && b.id === 'b2' ? h('span', { class: 'bundle-tag' }, 'Most popular') : null,
      h('span', { class: 'bundle-dbx' }, `${fmt.int(b.dbx)} Drillbux`),
      aaa ? null : h('span', { class: 'bundle-meta' }, `${fmt.usd((b.price / b.dbx) * CRATE_COST_DBX)} per crate · ${crates} crates · ${leftover} left over`),
      h('button', { type: 'button', class: aaa ? 'btn btn-shop' : 'btn', on: { click: () => (aaa ? purchase(b) : confirmPurchase(b)) } }, `${fmt.usd(b.price)}`),
    );
  });
  const body = [h('div', { class: 'bundles' }, cards)];
  if (!aaa && needed > 0) {
    const c = cheapestPurchase(needed);
    body.unshift(h('p', null, `You need ${needed} more Drillbux. The cheapest way costs ${fmt.usd(c.price)} and leaves ${c.leftover} Drillbux stranded — bundle sizes are chosen so they never divide evenly into crates.`));
  }
  body.push(h('p', { class: 'hint' }, 'Simulated store. No payment details are collected and no money changes hands.'));
  showModal(aaa ? 'Power up your rig!' : 'Buy Drillbux (simulated)', body, [h('button', { type: 'button', class: 'btn', on: { click: closeModal } }, 'Close')]);
}

function confirmPurchase(b) {
  showModal('Confirm simulated purchase', [
    h('p', null, `In a real game this would charge ${fmt.usd(b.price)}. Your simulated total would become ${fmt.usd(game.realSpent + b.price)}.`),
    h('p', null, `At the field's current oil price that is the net revenue from about ${fmt.int(b.price / Math.max(1, game.oilPrice * 0.875 - 14))} barrels.`),
  ], [
    h('button', { type: 'button', class: 'btn', on: { click: () => openShop() } }, 'Back'),
    h('button', { type: 'button', class: 'btn btn-primary', on: { click: () => purchase(b) } }, `Buy for ${fmt.usd(b.price)} (simulated)`),
  ]);
}

function purchase(b) {
  buyBundle(game, b.id);
  saveGame();
  closeModal();
  toast(`+${fmt.int(b.dbx)} Drillbux`);
  update();
}

async function tryOpen(currency) {
  if (crateBusy) return;
  if (!canOpen(game, currency)) {
    if (currency === 'dbx') openShop(CRATE_COST_DBX - game.dbx);
    else toast(currency === 'budget' ? 'Not enough field budget.' : 'Not enough scrap.');
    return;
  }
  crateBusy = true;
  const res = openCrate(game, currency);
  saveGame();
  update();
  const fast = game.mode === 'regulator';
  await scene.playCrate(parseInt(rarityColor[res.rarity].slice(1), 16), { fast });
  if (game.mode === 'aaa' && res.rarity !== 'legendary' && !reducedMotion) {
    // The "near miss": flash a legendary before revealing the real result.
    showModal('…', h('p', { class: 'reveal reveal-tease', css: { '--rar': rarityColor.legendary } }, res.teaser.name), []);
    await new Promise((r) => setTimeout(r, 700));
  }
  showModal(rarityLabel[res.rarity], [
    h('p', { class: 'reveal', css: { '--rar': rarityColor[res.rarity] } }, res.item.name),
    h('p', null, res.item.blurb),
    h('p', { class: 'hint' }, effectText(res.item) + (res.duplicate ? ` — duplicate, converted to ${SCRAP_VALUE[res.rarity]} scrap` : '')),
    game.mode === 'aaa' && res.rarity !== 'legendary' ? h('p', { class: 'hint' }, 'So close! The next one could be legendary.') : null,
    game.mode === 'regulator' && res.rarity !== 'legendary' ? h('p', { class: 'hint' }, 'The flash of a legendary item before this result (shown in AAA mode) is a "near miss" effect. It was never a possible outcome of this roll.') : null,
  ], [
    h('button', { type: 'button', class: 'btn', on: { click: () => { closeModal(); render(); } } }, 'Done'),
    h('button', { type: 'button', class: 'btn btn-primary', on: { click: () => { equip(game, res.item.id); applyCosmetics(); saveGame(); closeModal(); render(); } } }, 'Equip'),
  ]);
  crateBusy = false;
}

function eventDialog() {
  const e = game.event;
  if (!e || dialog.open) return;
  if (e.type === 'kick') {
    showModal('Kick — well shut in', [
      h('p', null, `Formation fluid entered the wellbore at ${fmt.int(e.depth)} ft in the ${e.formation}. Mud hydrostatic was below pore pressure.`),
      table([
        ['Original mud weight', `${e.omw.toFixed(1)} ppg`],
        ['Shut-in drill pipe pressure', `${fmt.int(e.sidpp)} psi`],
        ['Kill mud weight', `${e.omw.toFixed(1)} + ${e.sidpp} ÷ (0.052 × ${fmt.int(e.depth)}) = ${e.kmw.toFixed(1)} ppg`],
      ]),
      h('p', { class: 'hint' }, 'Circulating kill mud costs $1.2M and 1.5 rig days.'),
    ], [h('button', { type: 'button', class: 'btn btn-primary', on: { click: () => { resolveKick(game); closeModal(); saveGame(); render(); } } }, `Circulate ${e.kmw.toFixed(1)} ppg kill mud`)]);
  } else if (e.type === 'losses') {
    showModal('Lost circulation', [
      h('p', null, `At ${e.mw.toFixed(1)} ppg the mud column fractured the ${e.formation} at ${fmt.int(e.depth)} ft (fracture gradient ≈ ${e.maxPpg} ppg). Mud is flowing into the formation.`),
      h('p', { class: 'hint' }, 'Losses cost $400k and half a rig day. Mud weight will be cut back below the fracture gradient.'),
    ], [h('button', { type: 'button', class: 'btn btn-primary', on: { click: () => { acknowledgeLosses(game); closeModal(); saveGame(); render(); } } }, 'Cut mud weight')]);
  }
}

// ---------- Toast & ticker ----------
const toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
document.body.append(toastEl);
let toastTimer = 0;
function toast(msg) {
  setText(toastEl, msg);
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

function ticker() {
  return h('footer', { class: 'ticker' },
    readout('Brent (sim)', 'tkPrice'),
    readout('Project NPV @10%', 'tkNpv'),
    readout('Days on project', 'tkDays'),
    readout('Simulated money spent', 'tkSpent'),
  );
}

function tabs() {
  return h('nav', { class: 'tabs', 'aria-label': 'Panels' },
    ...[['console', 'Console'], ['store', 'Store']].map(([id, label]) =>
      h('button', { type: 'button', class: 'tab', 'aria-pressed': String(activeTab === id), on: { click: () => { activeTab = id; render(); } } }, label)));
}

// ---------- Render & update ----------
function render() {
  document.body.classList.toggle('mode-aaa', game.mode === 'aaa');
  document.body.classList.toggle('mode-regulator', game.mode === 'regulator');
  document.body.dataset.tab = activeTab;
  for (const k of Object.keys(refs)) delete refs[k];
  root.replaceChildren(topbar(), consolePanel(), storePanel(), tabs(), ticker());
  update();
}

function update() {
  const g = game;
  setText(refs.field, `Field ${g.fieldNo}`);
  setText(refs.budget, fmt.money(g.budget));
  setText(refs.dbx, fmt.int(g.dbx));
  setText(refs.scrap, fmt.int(g.scrap));
  setText(refs.tkPrice, `${fmt.usd(g.oilPrice)}/bbl`);
  setText(refs.tkNpv, fmt.money(g.project.npv));
  setText(refs.tkDays, fmt.int(g.project.days));
  setText(refs.tkSpent, fmt.usd(g.realSpent));
  if (refs.openDbx) refs.openDbx.classList.toggle('is-short', !canOpen(g, 'dbx'));
  if (refs.openBudget) refs.openBudget.disabled = !canOpen(g, 'budget');
  if (refs.openScrap) refs.openScrap.disabled = !canOpen(g, 'scrap');
  if (refs.timer) setText(refs.timer, `${String(Math.floor(offerSeconds / 60)).padStart(2, '0')}:${String(offerSeconds % 60).padStart(2, '0')}`);

  if (g.phase === 'drilling') {
    const f = formationAt(g.depth);
    const bitMult = effect(g, 'bit', 'rop', 1);
    setText(refs.depth, fmt.int(g.depth));
    if (refs.depthFill) refs.depthFill.style.width = `${(g.depth / TARGET_DEPTH) * 100}%`;
    refs.depthBar?.setAttribute('aria-valuenow', String(Math.round(g.depth)));
    setText(refs.formation, f.name);
    setText(refs.rop, g.drilling ? `${(95 / f.hardness * bitMult).toFixed(0)} ft/hr` : '—');
    setText(refs.bitName, g.equipped.bit ? itemById(g.equipped.bit).name : 'Rental mill-tooth bit');
    setText(refs.mwVal, `${g.mudWeight.toFixed(1)} ppg`);
    if (refs.mwInput && +refs.mwInput.value !== g.mudWeight) refs.mwInput.value = String(g.mudWeight);
    const lo = gradientToPpg(f.poreGrad), hi = gradientToPpg(f.fracGrad);
    const pos = (v) => `${((v - 8.6) / (17 - 8.6)) * 100}%`;
    if (refs.windowSafe) { refs.windowSafe.style.left = pos(lo); refs.windowSafe.style.width = `calc(${pos(hi)} - ${pos(lo)})`; }
    if (refs.windowNeedle) refs.windowNeedle.style.left = pos(g.mudWeight);
    const d = Math.max(1, g.depth);
    setText(refs.windowText, `Window here: ${lo.toFixed(1)}–${hi.toFixed(1)} ppg. Hydrostatic ${fmt.int(hydrostatic(g.mudWeight, d))} psi vs pore ${fmt.int(f.poreGrad * d)} psi.`);
    setText(refs.drillBtn, g.drilling ? 'Pause drilling' : g.depth > 0 ? 'Resume drilling' : 'Spud well');
  } else if (g.phase === 'production' || g.phase === 'depleted') {
    const w = g.well;
    if (w) {
      setText(refs.rate, fmt.int(g.phase === 'depleted' ? 0 : w.rate));
      setText(refs.np, `${fmt.bbl(w.np)} / ${fmt.bbl(currentEur(g))}`);
      setText(refs.rf, fmt.pct(w.np / w.ooip));
      setText(refs.skin, w.skin.toFixed(1));
      setText(refs.price, `${fmt.usd(g.oilPrice)}/bbl`);
      setText(refs.fieldCash, fmt.money(g.fieldCash));
    }
  }
}

// ---------- Main loop ----------
let last = performance.now();
let acc = 0, saveAcc = 0, secAcc = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const g = game;
  if (!dialog.open || !g.event) {
    if (g.phase === 'drilling') {
      const before = g.phase;
      tickDrilling(g, dt * HOURS_PER_SECOND);
      if (g.event) eventDialog();
      if (g.phase !== before) { saveGame(); render(); toast('Target depth reached'); }
    } else if (g.phase === 'production') {
      tickProduction(g, dt * DAYS_PER_SECOND, priceRng);
      if (g.phase === 'depleted') { saveGame(); render(); }
    }
  }
  scene.setDepth(g.depth);
  scene.setDrilling(g.phase === 'drilling' && g.drilling);
  scene.setProducing(g.phase === 'production' ? g.well.rate : 0);
  const fill = g.well ? 1 - g.well.np / g.well.ooip : 1;
  scene.setReservoirFill(g.phase === 'drilling' || g.phase === 'completion' ? 1 : fill * 1.4 - 0.4);

  secAcc += dt;
  if (secAcc >= 1) {
    secAcc -= 1;
    offerSeconds--;
    if (offerSeconds < 0) { offerSeconds = 299; g.timerResets++; }
  }
  acc += dt;
  if (acc > 0.1) { acc = 0; update(); }
  saveAcc += dt;
  if (saveAcc > 5) { saveAcc = 0; saveGame(); }
}

render();
eventDialog();
requestAnimationFrame(loop);
window.addEventListener('pagehide', saveGame);
