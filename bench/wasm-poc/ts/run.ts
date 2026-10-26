// 基准 harness：TS vs Rust→WASM。
// 跑法：node ts/run.ts  与  bun ts/run.ts（跨引擎位级对比用）。
// 输出带 [engine] 前缀，两份输出直接 diff hash 行即得跨引擎结论。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { solve, mc, INPUT_HDR } from "./physics.ts";

const ENGINE = (globalThis as any).Bun ? "bun(JSC)" : "node(V8)";
const OUT = 2048;
const MC_AGG = 2032;
const N = 10;
const OUT_LEN = 4 + 2 * N;
const MC_SAMPLES = 10_000;
const MC_SEED = 12345;

const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, "..", "rs", "target", "wasm32-unknown-unknown", "release", "poc_solver.wasm");
const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), {});
const ex = instance.exports as any;
const ptr: number = ex.buf_ptr();
const view = new Float64Array((ex.memory as WebAssembly.Memory).buffer, ptr, 4096);

function makeInput(n: number): Float64Array {
  const a = new Float64Array(INPUT_HDR + 4 * n);
  a[0] = n;
  a[1] = 25.0; a[2] = 35.0;          // 供/回液温 → 牞性用均值
  a[3] = 14.0; a[4] = 1.0e6;         // 泵: h0=14 m, H=h0-a·Q²
  a[5] = 0.0508; a[6] = 3.0; a[7] = 3.0; a[8] = 4.5e-5; a[9] = 9.81;
  for (let j = 0; j < n; j++) {
    const b = INPUT_HDR + 4 * j;
    a[b] = 0.0191; a[b + 1] = 2.5; a[b + 2] = 18.0; a[b + 3] = 1.5e-5; // 支路: D/L/K/eps
  }
  return a;
}

function wasmSolve(inp: Float64Array, out: Float64Array): number {
  view.set(inp);
  ex.solve(inp[0]);
  for (let i = 0; i < OUT_LEN; i++) out[i] = view[OUT + i];
  return out[0];
}

function bench(label: string, fn: () => void, reps: number, rounds = 5): number {
  for (let i = 0; i < Math.min(300, reps); i++) fn();
  let best = Infinity;
  for (let r = 0; r < rounds; r++) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < reps; i++) fn();
    const dt = Number(process.hrtime.bigint() - t0) / reps;
    if (dt < best) best = dt;
  }
  console.log(`${label}: ${(best / 1000).toFixed(2)} µs/op`);
  return best;
}

function fnv32(a: Float64Array): string {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h = (h ^ bytes[i]) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

console.log(`[engine] ${ENGINE}`);
const input = makeInput(N);

// ---------- 正确性交叉验证 ----------
const out = new Float64Array(OUT_LEN);
solve(input, out);
const tsHash = fnv32(out);
wasmSolve(input, out);
const wasmOut = Float64Array.from(out); // 留副本
const wasmHash = fnv32(wasmOut);
const tsOut = new Float64Array(OUT_LEN);
solve(input, tsOut);
let maxDiff = 0;
for (let i = 0; i < OUT_LEN; i++) {
  const rel = Math.abs(tsOut[i] - wasmOut[i]) / Math.max(Math.abs(wasmOut[i]), 1e-9);
  if (rel > maxDiff) maxDiff = rel;
}
console.log(`[result] Q_total=${tsOut[0].toFixed(9)} m³/s (${(tsOut[0] * 60000).toFixed(1)} L/min), P_branch=${(tsOut[1] / 1000).toFixed(2)} kPa, head=${tsOut[2].toFixed(3)} m, |residual|=${Math.abs(tsOut[3 + 2 * N]).toExponential(2)}`);
console.log(`[xcheck] ts-vs-wasm max rel diff = ${maxDiff.toExponential(2)}`);
console.log(`[hash]   ts=${tsHash}  wasm=${wasmHash}  ${tsHash === wasmHash ? "IDENTICAL" : "differ(libm)"}`);

// ---------- A. 单次求解 ----------
let sink = 0;
const tsNs = bench("[solve]  ts       ", () => { sink += solve(input, out); }, 2000);
const waNs = bench("[solve]  wasm-call", () => { sink += wasmSolve(input, out); }, 2000);
console.log(`[solve]  wasm/ts = ${(tsNs / waNs).toFixed(1)}x`);

// ---------- B. 蒙特卡洛 10⁴ 采样 ----------
const agg = new Float64Array(3);
const t0 = process.hrtime.bigint();
mc(input, MC_SAMPLES, MC_SEED, out, agg);
const tsMcS = Number(process.hrtime.bigint() - t0) / 1e9;

const t1 = process.hrtime.bigint();
mc(input, MC_SAMPLES, MC_SEED, out, agg, wasmSolve);
const hyMcS = Number(process.hrtime.bigint() - t1) / 1e9;

view.set(input);
const t2 = process.hrtime.bigint();
ex.solve_mc(N, MC_SAMPLES, MC_SEED);
const waMcS = Number(process.hrtime.bigint() - t2) / 1e9;
const waAgg = [view[MC_AGG], view[MC_AGG + 1], view[MC_AGG + 2]];

console.log(`[mc]     ts-full-loop : ${tsMcS.toFixed(3)} s (${(tsMcS / MC_SAMPLES * 1e6).toFixed(1)} µs/样本)`);
console.log(`[mc]     ts驱动+wasm算: ${hyMcS.toFixed(3)} s (${(hyMcS / MC_SAMPLES * 1e6).toFixed(1)} µs/样本)`);
console.log(`[mc]     wasm全批内循环: ${waMcS.toFixed(3)} s (${(waMcS / MC_SAMPLES * 1e6).toFixed(1)} µs/样本)`);
console.log(`[mc]     mean Q: ts=${agg[0].toExponential(12)} wasm=${waAgg[0].toExponential(12)} (min/max 同位级=${agg[1] === waAgg[1] && agg[2] === waAgg[2] ? "yes" : "no"})`);
void sink;
