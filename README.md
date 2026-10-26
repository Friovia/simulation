# ORv3 Liquid-Cooling Rack Simulation Kernel

[English](README.md) · [繁體中文](README.zh-Hant.md)

A physics simulation kernel for 20–50 kW ORv3-style direct liquid-cooled racks:
**four pure-function solver packages + a source-attributed component curve library
+ a golden-vector verification loop**. Pure TypeScript, zero runtime dependencies
in the solvers — every solver is `input JSON → output JSON`.

## Simulation boundary

The kernel simulates **flow and temperature up to the rack inlet (the UQD
coupling plane)**. Everything behind the UQD (in-server piping, cold-plate
microchannels, die-level thermal behavior) is the server vendor's domain of
guarantee; room-level airflow and CFD are likewise out of scope. Resolution is
aligned to the promise surface: coarser than physical reality is unusable —
finer than the promise surface is waste.

## The four packages

| Package | Physics | Version | Golden vectors | Coverage |
|---|---|---|---|---|
| `p0-hydraulics` | 1D liquid cooling hydraulic network | 0.2.0 | 20 | CDU pump → manifold → UQD → cold-plate branch flow distribution, pump operating point (Illinois Newton intersection), PG25 property temperature corrections (μ/ρ/c_p/Pr), Haaland/Churchill/Swamee-Jain friction with laminar–transition–turbulent discrimination, single-branch shutoff redistribution, VFD affinity laws, ±10% sensitivity sweeps, calc-note generation |
| `p1-thermal-chain` | chip-to-room thermal resistance chain | 0.2.0 | 23 | TDP/thermal-envelope θ chains, cold-plate-to-coolant temperature rise, CDU heat exchanger ε-NTU, room heat extraction, dew-point margin (anti-condensation red line), ASHRAE W-class (W17–W45) benchmarking, P0→P1 joint assembler |
| `p2-transient` | transients and control | 0.3.0 | 8 | loop fluid + metal heat capacities, first-order step closed-form solutions (τ lower bound), pump coastdown closed-form |
| `p3-electrical` | 48 V electrical | 0.3.0 | 12 | busbar voltage drop / losses (IACS copper constants, sourced), ampacity with temperature derating, trip coordination (selectivity), short-circuit current source model |

**63 golden vectors** in total — `npm run vectors` regresses them all in one command.

Calculation-book deliverables: the `doc` command emits a calculation note in
both md + json form (see `p0-hydraulics/calc-note-demo/` and
`p1-thermal-chain/calc-note-chain/`).

## Quick start

```bash
# Node >= 22 (.ts sources execute directly via native type stripping)
npm install
npm run typecheck   # strict + noUncheckedIndexedAccess — 0 errors is the red line
npm run vectors     # full regression over all 63 golden vectors
```

CLI (identical shape per package; `--json` for structured output; exit codes
0 = pass / 1 = numerical failure / 2 = invalid input or data):

```bash
node p0-hydraulics/bin/p0.mjs solve   --in p0-hydraulics/test-case/rack-orv3.json --json
node p0-hydraulics/bin/p0.mjs sweep   --in <case.json>        # ±10% sensitivity matrix
node p0-hydraulics/bin/p0.mjs doc     --in <case.json>        # calculation note (md+json)
node p0-hydraulics/bin/p0.mjs vectors                          # golden-vector regression
node p0-hydraulics/bin/p0.mjs validate-data                    # curve-library intake validation

node p1-thermal-chain/bin/p1.mjs solve --in <case.json>
node p2-transient/bin/p2.mjs solve    --in <case.json>
node p3-electrical/bin/p3.mjs solve   --in <case.json>
```

## Verification methodology

Credibility in a numerical library comes from the verification loop, not from
claims:

1. **Golden vectors**: hand-derived closed-form solutions → JSON test vectors
   (parallel symmetry, single-loop pressure drop, pump operating-point
   intersection, domain boundaries, invalid-input rejection paths). Full run on
   every solver change.
2. **Blind-calculation vectors**: expected values are produced by independent
   derivation — without reading the solver code, computed from first
   principles, then compared against solver output (independence = a cheap
   second implementation; prevents "grading your own homework").
3. **Built-in assertions**: mass/energy conservation residual caps, NaN guards,
   interpolation monotonicity checks; when residuals exceed limits the solver
   refuses to produce numbers (`converged=false`, output marked untrusted).
4. **Adversarial review**: every solver release goes through an independent
   review pass against a professionalism checklist (convergence, conservation,
   units, edge cases) — findings must all be fixed before release. Records in
   `docs/review-*.md` (historical archive, contains the review context of the
   time).

## Component curve library (`data/component-curves/`)

Git-versioned JSON (jsonc) with three iron rules for intake (details in
[schema.md](data/component-curves/schema.md)):

- **No source, no entry**: every curve carries `source.url` and the retrieval
  date;
- **Never invent data**: with only a single anchor point, interpolate by
  same-class shape and declare it in `uncertainty` (±15% magnitude); where no
  data exists at all, record a `redlight` placeholder (`curve: null`) — any
  result it participates in must be labeled "unverified";
- **Measured data never enters this library**: only public sources
  (datasheets / literature / OCP specs) are accepted; measured or commissioning
  telemetry does not belong in a public library.

Coolant basis is registered explicitly (a classic trap: vendor curves are
calibrated on pure water at 20 °C while the loop actually runs PG25 — a
separate entry with property corrections is required). Units are SI throughout
(L/min, kPa, °C, W); conversion happens exactly once at the IO boundary.

## Design principles

- **Pure-function core**: solvers are zero-dependency, no I/O, no state —
  `solve(input) → output`. Copyable into any host (browser / Worker / server);
  the section below lists the independently copyable files per package.
- **CLI-first**: solve, sweep, validate, report — every operation has a CLI
  with `--json` output and semantic exit codes, for automation and agent
  consumption.
- **Data and code versioned together**: the curve library is git JSON —
  diffable, reviewable, pinnable per release; outputs carry
  `{solverVersion, dataVersion}` for reproducibility.
- **Strict TypeScript**: `strict + noUncheckedIndexedAccess` with zero errors
  is the red line; non-null assertions `!` are eliminated.

### Copyable pure-function files (vendoring)

| Package | Files |
|---|---|
| p0-hydraulics | `src/{types,units,interp,props,friction,solve}.ts` |
| p1-thermal-chain | `src/{types,standards,dew,hx,thermal,solve}.ts` |

These files have no `node:` imports and zero dependencies; `cli.ts` / `doc.ts` /
`sweep.ts` / `vectors.ts` / `validate-data.ts` are package tooling that depends
on Node.

## License

[Apache-2.0](LICENSE).

Engineering disclaimer: this kernel is for engineering reference and concept
derivation. Most vendor curves are single-anchor + shape interpolation
(uncertainty per entry's `uncertainty` field); before using outputs in a real
project you must verify independently and check the data source tier.
