// 组装器（official-site 对接的计算内核形态，cabinet3d-interface 的上游）：
// P0 水力求解 → flows 注入 P1 → 热链求解 → 联合计算书（水力+热）同一目录交付。
// 这条链就是"客户拖完负载和房间条件 → 敢写进 proposal 的数字"的后端入口。

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { P0Input, P0Output } from "../../p0-hydraulics/src/types.ts";
import { solve as solveP0 } from "../../p0-hydraulics/src/solve.ts";
import { generateDoc as docP0 } from "../../p0-hydraulics/src/doc.ts";
import type { P1Input, P1Output } from "./types.ts";
import { solve as solveP1 } from "./solve.ts";
import { generateDoc as docP1 } from "./doc.ts";

export interface ChainResult {
  p0: P0Output;
  p1: P1Output;
  summary: {
    hydraulic: { qTotalLpm: number | null; converged: boolean };
    thermal: { tSupplyC: number; tReturnC: number; dewPass: boolean | null; wClassPass: boolean | null; converged: boolean };
    files: { hydraulicMd: string; hydraulicJson: string; thermalMd: string; thermalJson: string };
  };
}

export function runChain(hydraulicPath: string, thermalPath: string, outDir: string, command: string): ChainResult {
  const p0Input = JSON.parse(readFileSync(hydraulicPath, "utf8")) as P0Input;
  const p0 = solveP0(p0Input);
  if (p0.inputInvalid.length) throw new Error(`P0 输入无效：${p0.inputInvalid.join("; ")}`);

  // flows 注入（关断支路 q=0 → P1 侧如带载会如实翻不可信，物理自洽）
  const p1Input = JSON.parse(readFileSync(thermalPath, "utf8")) as P1Input;
  p1Input.case.flows = p0.branches.map((b) => ({ id: b.id, qLpm: b.qLpm }));
  const p1 = solveP1(p1Input);

  mkdirSync(outDir, { recursive: true });
  const b0 = docP0(readFileSync(hydraulicPath, "utf8"), p0Input, `${command}（P0 段）`);
  const b1 = docP1(JSON.stringify(p1Input), p1Input, `${command}（P1 段，flows 由 P0 注入）`);
  const [fHydMd, fHydJson, fThMd, fThJson] = [
    join(outDir, "calc-note-hydraulic.md"), join(outDir, "calc-note-hydraulic.json"),
    join(outDir, "calc-note-thermal.md"), join(outDir, "calc-note-thermal.json"),
  ] as const;
  writeFileSync(fHydMd, b0.md, "utf8");
  writeFileSync(fHydJson, JSON.stringify(b0.json, null, 2) + "\n", "utf8");
  writeFileSync(fThMd, b1.md, "utf8");
  writeFileSync(fThJson, JSON.stringify(b1.json, null, 2) + "\n", "utf8");

  return {
    p0,
    p1,
    summary: {
      hydraulic: { qTotalLpm: p0.qTotalLpm ?? null, converged: p0.converged },
      thermal: { tSupplyC: p1.tSupplyC, tReturnC: p1.tReturnC, dewPass: p1.dewPass, wClassPass: p1.wClassPass, converged: p1.converged },
      files: { hydraulicMd: fHydMd, hydraulicJson: fHydJson, thermalMd: fThMd, thermalJson: fThJson },
    },
  };
}
