// 敏感性扫描（契约 §6.4：每个承诺参数附 ±10% 关键输入扰动的响应）。
// 纯函数：sweep(input) → 行数组；计算书 F 节"敏感性分析表"的数据来源。
// 扰动维度：泵曲线 y ±10%、支路阻力（支路引用曲线联动）±10%、干管 K ±10%、工质温度 ±5°C。

import type { P0Input } from "./types.ts";
import { solve } from "./solve.ts";

export interface SweepRow {
  perturbation: string;
  qTotalLpm: number;
  pumpDpKPa: number;
  minMarginLpm: number | null;
  converged: boolean;
}

function row(label: string, inp: P0Input): SweepRow {
  const out = solve(inp);
  const active = out.branches.filter((b) => !b.shutdown);
  const mm = active.length ? active.reduce((m, b) => Math.min(m, b.minMarginLpm ?? Infinity), Infinity) : null;
  return {
    perturbation: label,
    qTotalLpm: out.qTotalLpm ?? NaN,
    pumpDpKPa: out.pumpDpKPa ?? NaN,
    minMarginLpm: mm != null && Number.isFinite(mm) ? mm : null,
    converged: out.converged,
  };
}

export function sweep(input: P0Input): SweepRow[] {
  const rows: SweepRow[] = [row("baseline", input)];
  const pumpId = input.case.pump.curveId;
  const branchCurveIds = [...new Set(input.case.branches.flatMap((b) => b.curveIds))];
  for (const d of [-0.1, 0.1]) {
    const sign = d > 0 ? "+" : "−";
    let v = structuredClone(input);
    const pc = v.curves[pumpId];
    if (pc === undefined) throw new Error(`sweep: 缺泵曲线 ${pumpId}（内部不变式）`);
    pc.points = pc.points.map(([x, y]) => [x, y * (1 + d)] as [number, number]);
    rows.push(row(`泵曲线 ${sign}10%`, v));

    v = structuredClone(input);
    for (const id of branchCurveIds) {
      const bc = v.curves[id];
      if (bc === undefined) throw new Error(`sweep: 缺支路曲线 ${id}（内部不变式）`);
      bc.points = bc.points.map(([x, y]) => [x, y * (1 + d)] as [number, number]);
    }
    rows.push(row(`支路阻力 ${sign}10%`, v));

    if (input.case.supplyPipe) {
      v = structuredClone(input);
      const sp = v.case.supplyPipe;
      if (sp) sp.k *= 1 + d;
      rows.push(row(`干管 K ${sign}10%`, v));
    }

    v = structuredClone(input);
    v.case.tSupplyC += d * 50;
    v.case.tReturnC += d * 50;
    rows.push(row(`工质温度 ${sign}5°C`, v));
  }
  return rows;
}
