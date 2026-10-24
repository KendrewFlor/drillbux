# The petroleum engineering model

Every number in Drillbux comes from a standard oilfield-units equation. All of them live in [`src/reservoir.js`](../src/reservoir.js) as pure functions and are checked against hand calculations in [`tests/reservoir.test.mjs`](../tests/reservoir.test.mjs).

## 1. Drilling

### Stratigraphic column

| Formation              | Depth (ft)  | Pore gradient (psi/ft) | Fracture gradient (psi/ft) | Relative hardness |
|------------------------|-------------|------------------------|----------------------------|-------------------|
| Recent alluvium & clay | 0–2,500     | 0.465                  | 0.70                       | 1.0               |
| Miocene sand–shale     | 2,500–5,000 | 0.465                  | 0.75                       | 1.4               |
| Overpressured shale    | 5,000–6,800 | 0.60                   | 0.82                       | 1.8               |
| Cap rock (limestone)   | 6,800–7,200 | 0.52                   | 0.85                       | 2.2               |
| Reservoir sandstone    | 7,200–8,000 | 0.52                   | 0.80                       | 1.3               |

### Hydrostatic pressure

$$P_h = 0.052 \times MW \times TVD$$

with $P_h$ in psi, mud weight $MW$ in ppg, and true vertical depth $TVD$ in ft. The console shows the safe mud-weight window for the current formation:

$$MW_{min} = \frac{G_{pore}}{0.052} \qquad MW_{max} = \frac{G_{frac}}{0.052}$$

- Below the window: a **kick** (formation fluid enters the well).
- Above the window: **lost circulation** (the mud fractures the formation).

### Kill mud weight (IWCF)

When the well kicks it is shut in and the shut-in drill pipe pressure equals the underbalance. The game then calculates:

$$KMW = OMW + \frac{SIDPP}{0.052 \times TVD}$$

rounded up to the next 0.1 ppg. Spudding at 9.0 ppg and drilling into the overpressured shale at 5,000 ft guarantees a kick, so every player meets this equation.

### Rate of penetration

$$ROP = \frac{95}{H} \times M_{bit} \times \frac{1}{1 + 0.08\,\Delta MW_{ob}}$$

where $H$ is formation hardness, $M_{bit}$ is the equipped bit's multiplier, and $\Delta MW_{ob}$ is the overbalance in ppg. The last term models chip hold-down: heavier mud than you need slows drilling. This is a simplified game model, not a Bourgoyne–Young fit.

## 2. Reservoir

### Volumetric OOIP

$$N = \frac{7758 \, A \, h \, \phi \, (1 - S_w)}{B_o}$$

$N$ in STB, $A$ in acres, $h$ in ft, $\phi$ and $S_w$ as fractions, $B_o$ in rb/STB. Each field draws its properties from a seeded random generator within realistic ranges.

### Inflow: pseudo-steady-state radial Darcy flow

$$q_o = \frac{0.00708 \, k \, h \, (\bar{P}_r - P_{wf})}{\mu_o \, B_o \left[\ln\left(\frac{r_e}{r_w}\right) - 0.75 + s\right]}$$

$k$ in md, $\mu_o$ in cp, pressures in psia, $r_e$ = 1,490 ft (≈160-acre drainage), $r_w$ = 0.354 ft (8½-in hole). Skin $s$ starts at +2 for drilling damage; completion items lower it (acid wash −1, frac stage −3, multi-stage −4.5). A workover re-scales the rate by the ratio of the old and new denominators.

### Decline: Arps

$$q(t) = \frac{q_i}{(1 + b\,D_i\,t)^{1/b}}$$

with the exponential ($b = 0$) and harmonic ($b = 1$) limits handled exactly. Cumulative production is integrated step by step and capped at

$$EUR = N \times RF, \qquad RF = \min(0.6,\; RF_{base} + \Delta RF_{EOR})$$

EOR items add recovery-factor points: gas lift +2 (and lowers $P_{wf}$ by 200 psi), waterflood +10, polymer flood +14, CO₂ miscible +20.

## 3. Economics

- Oil price follows geometric Brownian motion: drift 2%/yr, volatility 35%/yr, clamped to $25–$180/bbl.
- Net revenue per barrel: $P_{oil}(1 - 0.125) - \$14$ (12.5% royalty, $14/bbl lifting cost), minus $45,000/day fixed opex.
- Rig day rate while drilling is $180,000/day; completion $4.0M; rig move $2.5M; kill operation $1.2M; losses $400k.
- **Project NPV** discounts every cash flow, including crates bought with field budget, at 10% per year, converted to an effective daily rate:

$$i_d = (1 + 0.10)^{1/365} - 1, \qquad NPV = \sum_t \frac{CF_t}{(1 + i_d)^t}$$

- The economic limit is the rate at which daily net revenue no longer covers fixed opex. The well is shut in after 180 days once it falls below that rate.

## 4. The crate maths

[`src/economy.js`](../src/economy.js) publishes the odds and computes, exactly, what a crate costs you:

- Base legendary odds 0.8%. Soft pity from pull 74 adds 6 percentage points per pull; hard pity at 90.
- Expected pulls to a legendary:

$$E[n] = \sum_{n=1}^{90} n \, p_n \prod_{k<n}(1 - p_k) \approx 58.1$$

  A 400,000-pull Monte Carlo test checks this to within 2%.
- Bundle sizes (450 / 1,000 / 2,100 / 5,500 Drillbux) never divide evenly into 300-Drillbux crates. `cheapestPurchase()` finds the cheapest bundle combination and reports the stranded leftover.
