// 节点/机柜能量平衡：ΔT = Q / (ρ(T̄)·q·c_p(T̄))，T̄ = T_in + ΔT/2。
// ρ/c_p 随温度弱变化（PG25 每 10 K 约 −0.3%/+0.5%）→ 定点迭代，3~5 次收敛到 1e-12。
// 纯函数；物性表与 P0 单一来源（props.ts，pg25-dow-lc25-v1）。
// 近似口径（review-p1 n11）：机柜 ΔT 用聚合口径（总流量 + 机柜平均温度物性），支路各自用
// 支路平均物性；异构支路下两者与能量加权混合的偏差实测 ~2 mK 量级，可忽略。

import { pg25Props, pg25CpJkgK } from "../../p0-hydraulics/src/props.ts";
import { lpmToM3s } from "../../p0-hydraulics/src/units.ts";

export interface BalanceResult {
  dTK: number;
  tMeanC: number;
  iter: number;
  step: number; // 末次定点步差（相对量，审计面：guarantee-interface §6.1 P1 等价判据）
}

// qLpm ≤ 0 且 qW > 0：过热无解（调用方报不可信）；qW = 0：ΔT=0 平凡解。
export function balanceDTK(tInC: number, qLpm: number, qW: number): BalanceResult | null {
  if (qLpm <= 0) return qW === 0 ? { dTK: 0, tMeanC: tInC, iter: 0, step: 0 } : null;
  const qM3s = lpmToM3s(qLpm);
  const capAt = (tC: number): number => pg25Props(tC).rho * qM3s * pg25CpJkgK(tC); // W/K
  let dT = qW / capAt(tInC);
  for (let i = 1; i <= 100; i++) {
    const tMean = tInC + 0.5 * dT;
    const dNext = qW / capAt(tMean);
    const step = Math.abs(dNext - dT) / Math.max(1, dT);
    if (step <= 1e-12) {
      return { dTK: dNext, tMeanC: tInC + 0.5 * dNext, iter: i, step };
    }
    dT = dNext;
  }
  return null; // 100 次未收敛（物性表异常时才会发生）
}
