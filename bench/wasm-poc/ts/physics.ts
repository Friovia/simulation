// P0 液力 PoC 求解器 —— TypeScript 侧。
// 物性是占位线性拟合（非生产数据），算法结构与 rs/src/lib.rs 逐操作对齐：
// 改这里必须同步改 Rust 侧，两份实现是彼此的孪生对照。
//
// 模型：泵 H(Q)=h0-a·Q²  →  供回液管（串联 ×2）  →  N 条并联支路（冷板+QD+管路）。
// 解法：外层对支路压降 P 二分（60 次定长迭代），
//       内层每条支路对流量 q 二分（40 次定长迭代）——全部定长迭代，
//       保证两个实现的浮点执行序列完全同构。

export const INPUT_HDR = 10;

const PI = Math.PI;

function rhoT(t: number): number {
  return 1037.0 - 0.65 * (t - 25.0);
}
function muT(t: number): number {
  return (3.0 - 0.045 * (t - 25.0)) * 1e-3;
}

function branchDp(q: number, d: number, l: number, k: number, eps: number, rho: number, mu: number): number {
  const area = PI * d * d / 4.0;
  const v = q / area;
  const re = rho * v * d / mu;
  let f: number;
  if (re < 2300.0) {
    f = 64.0 / re;
  } else {
    const inv = -1.8 * Math.log10(Math.pow(eps / d / 3.7, 1.11) + 6.9 / re);
    f = 1.0 / (inv * inv);
  }
  return (k + f * l / d) * rho * v * v / 2.0;
}

function branchQp(p: number, d: number, l: number, k: number, eps: number, rho: number, mu: number): number {
  let lo = 0.0;
  let hi = 0.005;
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    if (branchDp(mid, d, l, k, eps, rho, mu) < p) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return 0.5 * (lo + hi);
}

// input 布局（f64 下标）:
//   [0]=n  [1]=tSupply  [2]=tReturn  [3]=h0  [4]=pumpA
//   [5]=sD [6]=sL(单向) [7]=sK(单向) [8]=epsS [9]=g
//   每支路 j（10+4j 起）: [D, L, K, eps]
// out 布局: [Q_total, P_branch_Pa, head_m, q_j×n, Re_j×n, residual]
export function solve(input: Float64Array, out: Float64Array): number {
  const n = input[0];
  const tMean = 0.5 * (input[1] + input[2]);
  const rho = rhoT(tMean);
  const mu = muT(tMean);
  const g = input[9];

  let lo = 0.0;
  let hi = 300000.0;
  for (let i = 0; i < 60; i++) {
    const p = 0.5 * (lo + hi);
    let qTot = 0.0;
    for (let j = 0; j < n; j++) {
      const b = INPUT_HDR + 4 * j;
      qTot += branchQp(p, input[b], input[b + 1], input[b + 2], input[b + 3], rho, mu);
    }
    const sr = branchDp(qTot, input[5], 2.0 * input[6], 2.0 * input[7], input[8], rho, mu);
    const headPa = rho * g * (input[3] - input[4] * qTot * qTot);
    if (headPa - (sr + p) > 0.0) {
      lo = p;
    } else {
      hi = p;
    }
  }
  const pStar = 0.5 * (lo + hi);

  let qTot = 0.0;
  for (let j = 0; j < n; j++) {
    const b = INPUT_HDR + 4 * j;
    const qj = branchQp(pStar, input[b], input[b + 1], input[b + 2], input[b + 3], rho, mu);
    out[3 + j] = qj;
    const v = qj / (PI * input[b] * input[b] / 4.0);
    out[3 + n + j] = rho * v * input[b] / mu;
    qTot += qj;
  }
  const sr = branchDp(qTot, input[5], 2.0 * input[6], 2.0 * input[7], input[8], rho, mu);
  const headPa = rho * g * (input[3] - input[4] * qTot * qTot);
  out[0] = qTot;
  out[1] = pStar;
  out[2] = headPa / (rho * g);
  out[3 + 2 * n] = (headPa - (sr + pStar)) / headPa;
  return qTot;
}

function lcg(x: number): number {
  return (Math.imul(x, 1664525) + 1013904223) >>> 0;
}

// 蒙特卡洛：每样本对 h0 扰动 ±5%，再依次对每支路 K 扰动 ±20%。
// LCG 与扰动顺序与 Rust 侧严格一致（h0 先、支路后），保证两实现采样同一个总体。
// solveFn 可注入（默认本文件实现）：hybrid 模式注入 wasm solve，扰动留在 TS、求解进 wasm。
export function mc(
  input: Float64Array,
  samples: number,
  seed: number,
  out: Float64Array,
  agg: Float64Array,
  solveFn: (i: Float64Array, o: Float64Array) => number = solve,
): number {
  const n = input[0];
  const pristine = Float64Array.from(input);
  const work = Float64Array.from(input);
  let x = seed >>> 0;
  let sum = 0.0;
  let mn = Infinity;
  let mx = -Infinity;
  for (let s = 0; s < samples; s++) {
    x = lcg(x);
    work[3] = pristine[3] * (0.95 + 0.1 * (x / 4294967296.0));
    for (let j = 0; j < n; j++) {
      x = lcg(x);
      const u = x / 4294967296.0;
      work[INPUT_HDR + 4 * j + 2] = pristine[INPUT_HDR + 4 * j + 2] * (0.8 + 0.4 * u);
    }
    const q = solve(work, out);
    sum += q;
    if (q < mn) mn = q;
    if (q > mx) mx = q;
  }
  agg[0] = sum / samples;
  agg[1] = mn;
  agg[2] = mx;
  return agg[0];
}
