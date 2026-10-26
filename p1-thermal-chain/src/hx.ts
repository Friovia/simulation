// CDU 液-液换热器热模型。
// 物理前提：芯片稳态负荷 Q 全部进入二次侧液体（能量守恒），温度场由换热能力闭式反推：
//   slope 模式（厂商单点锚点）：Q = S·ATD，ATD = TCS 供水 − FWS 供水（OCP 口径）
//     → T_s = T_f + Q/S（闭式）；S 仅在 flowBasis 额定流量附近有据，域外降信（登记带宽）。
//   ua 模式（显式 UA + 逆流 ε-NTU，Incropera 逆流效能关系）：
//     T_hot_in = T_f + Q/(ε·C_min)；T_s = T_hot_in − Q/C_tcs
//     ε = (1−e^(−NTU(1−C_r))) / (1−C_r·e^(−NTU(1−C_r)))，C_r=1 时 ε = NTU/(1+NTU)
// 唯一定点：C_tcs = ρ(T̄)·q·c_p(T̄) 随热侧平均液温 T̄ = (T_hot_in+T_s)/2 弱变化。
// 斜率语义提醒（hx.jsonc 头注）：S 是「含 ε 折减的有效增益 kW/K」，不是 UA。

import { pg25Props, pg25CpJkgK } from "../../p0-hydraulics/src/props.ts";
import { lpmToM3s } from "../../p0-hydraulics/src/units.ts";
import type { FwsSpec, HxCurve, HxOut } from "./types.ts";

export function counterflowEps(ntu: number, cRatio: number): number {
  if (Math.abs(1 - cRatio) < 1e-12) return ntu / (1 + ntu);
  const e = Math.exp(-ntu * (1 - cRatio));
  return (1 - e) / (1 - cRatio * e);
}

function fwsCapacityWPerK(fws: FwsSpec): number {
  return fws.rhoKgM3 * lpmToM3s(fws.flowLpm) * fws.cpJkgK;
}

// slope 模式：闭式。T_r（热侧入口）由调用方经机柜能量平衡补齐。
export function hxSlope(curve: HxCurve, ratedTcsLpm: number, qTcsLpm: number, qW: number, fws: FwsSpec): {
  slopeWKPerK: number;
  tSupplyC: number;
  atdK: number;
  tColdOutC: number;
  ratedFlowDevPct: number;
} {
  const last = curve.points[curve.points.length - 1];
  if (last === undefined) throw new Error("hx: 曲线点为空（内部不变式）");
  const slopeWKPerK = (last[1] * 1000) / last[0]; // kW/K → W/K（线性已入口校验）
  const atdK = qW / slopeWKPerK;
  const tColdOutC = fws.supplyC + qW / fwsCapacityWPerK(fws);
  return {
    slopeWKPerK,
    tSupplyC: fws.supplyC + atdK,
    atdK,
    tColdOutC,
    ratedFlowDevPct: Math.abs(qTcsLpm / ratedTcsLpm - 1) * 100,
  };
}

export interface UaResult {
  tHotInC: number;
  tSupplyC: number;
  eps: number | null;
  ntu: number | null;
  cMinWKPerK: number | null;
  cRatio: number | null;
  tColdOutC: number;
  tMeanC: number; // 热侧平均液温（供物性域检查）
  step: number; // 末次定点步差（相对量，审计面）
}

// ua 模式：热侧平均液温定点（≤100 次，1e-12 相对收敛；null=未收敛）。
// 零流量零负荷 → 平凡解（T 处处 = FWS 供水，ε/NTU 无定义置 null）；
// 零流量带负荷由调用方前置拦截（过热无解），不进入本函数。
export function hxUa(uaWK: number, qTcsLpm: number, qW: number, fws: FwsSpec): UaResult | null {
  if (qTcsLpm <= 0 && qW === 0) {
    return { tHotInC: fws.supplyC, tSupplyC: fws.supplyC, eps: null, ntu: null, cMinWKPerK: null, cRatio: null, tColdOutC: fws.supplyC, tMeanC: fws.supplyC, step: 0 };
  }
  const cFws = fwsCapacityWPerK(fws);
  let tMean = fws.supplyC;
  for (let i = 0; i < 100; i++) {
    const props = pg25Props(tMean);
    const cTcs = props.rho * lpmToM3s(qTcsLpm) * pg25CpJkgK(tMean);
    const cMin = Math.min(cTcs, cFws);
    const cRatio = cMin / Math.max(cTcs, cFws);
    const ntu = uaWK / cMin;
    const eps = counterflowEps(ntu, cRatio);
    const tHotIn = fws.supplyC + qW / (eps * cMin);
    const tSup = tHotIn - qW / cTcs;
    const tMeanNext = 0.5 * (tHotIn + tSup);
    const step = Math.abs(tMeanNext - tMean) / Math.max(1, Math.abs(tMeanNext));
    if (step <= 1e-12) {
      return { tHotInC: tHotIn, tSupplyC: tSup, eps, ntu, cMinWKPerK: cMin, cRatio, tColdOutC: fws.supplyC + qW / cFws, tMeanC: tMeanNext, step };
    }
    tMean = tMeanNext;
  }
  return null;
}

export function hxOutFromSlope(qW: number, tReturnC: number, s: ReturnType<typeof hxSlope>): HxOut {
  return {
    mode: "slope", qKw: qW / 1000, tHotInC: tReturnC, tHotOutC: s.tSupplyC, tColdOutC: s.tColdOutC,
    slopeWKPerK: s.slopeWKPerK, atdK: s.atdK, ratedFlowDevPct: s.ratedFlowDevPct,
    uaWK: null, eps: null, ntu: null, cMinWKPerK: null, cRatio: null,
  };
}

export function hxOutFromUa(qW: number, u: UaResult, uaWK: number): HxOut {
  return {
    mode: "ua", qKw: qW / 1000, tHotInC: u.tHotInC, tHotOutC: u.tSupplyC, tColdOutC: u.tColdOutC,
    slopeWKPerK: null, atdK: null, ratedFlowDevPct: null,
    uaWK, eps: u.eps, ntu: u.ntu, cMinWKPerK: u.cMinWKPerK, cRatio: u.cRatio,
  };
}
