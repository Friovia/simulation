// P1 敏感性扫描（契约 §6.4：每个承诺参数附 ±10% 关键输入扰动的响应）。
// 纯函数：sweep(input) → 行数组；计算书敏感性表与 p1 chain 的数据来源。
// 扰动维度（登记）：热负荷 qW ±10%、支路流量 ±10%、换热能力（斜率或 UA）±10%、
// FWS 供水温度 ±2 K（温度量纲不用乘性百分比，绝对步长为登记假设）。

import type { P1Input } from "./types.ts";
import { solve } from "./solve.ts";

export interface P1SweepRow {
  perturbation: string;
  tSupplyC: number;
  tReturnC: number;
  dtRackK: number;
  minTCaseMarginC: number | null; // 全节点最小 T_case 裕度（无 hotSpot 上限 → null）
  dewMarginK: number | null;
  converged: boolean;
}

function row(label: string, inp: P1Input): P1SweepRow {
  const out = solve(inp);
  const margins = out.nodes.map((n) => n.tCaseMarginC).filter((m): m is number => m != null);
  return {
    perturbation: label,
    tSupplyC: out.tSupplyC,
    tReturnC: out.tReturnC,
    dtRackK: out.dtRackK,
    minTCaseMarginC: margins.length ? Math.min(...margins) : null,
    dewMarginK: out.dewMarginK,
    converged: out.converged,
  };
}

export function sweep(input: P1Input): P1SweepRow[] {
  const rows: P1SweepRow[] = [row("baseline", input)];
  const ss = input.case.supplySource;
  for (const d of [-0.1, 0.1]) {
    const sign = d > 0 ? "+" : "−";

    let v = structuredClone(input);
    for (const l of v.case.loads) l.qW *= 1 + d;
    rows.push(row(`热负荷 ${sign}10%`, v));

    v = structuredClone(input);
    for (const f of v.case.flows) f.qLpm *= 1 + d;
    rows.push(row(`支路流量 ${sign}10%`, v));

    if (ss.mode === "hx") {
      v = structuredClone(input);
      const ssv = v.case.supplySource;
      if (ssv.mode === "hx") {
        const hx = ssv.hx;
        if (hx.mode === "slope") {
          const cv = v.curves?.[hx.curveId];
          if (cv === undefined) throw new Error(`sweep: 缺 hx 曲线 ${hx.curveId}（内部不变式）`);
          cv.points = cv.points.map(([x, y]) => [x, y * (1 + d)] as [number, number]);
          rows.push(row(`hx 斜率 ${sign}10%`, v));
        } else {
          hx.uaWK *= 1 + d;
          rows.push(row(`hx UA ${sign}10%`, v));
        }

        v = structuredClone(input);
        const ssv2 = v.case.supplySource;
        if (ssv2.mode === "hx") {
          ssv2.fws.supplyC += d > 0 ? 2 : -2;
          rows.push(row(`FWS 供水 ${sign}2K`, v));
        }
      }
    }
  }
  return rows;
}
