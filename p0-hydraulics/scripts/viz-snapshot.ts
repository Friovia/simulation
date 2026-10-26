// 生成诊断可视化快照：全部数字来自真实求解器，绝不在视图层另写物理。
// 用法：node scripts/viz-snapshot.ts [case.json] [out.json]
//   缺省 case = test-case/rack-orv3.json（真实曲线工况）
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { P0Input } from "../src/types.ts";
import { solve, systemDpKPaAt, pumpDpKPaAt } from "../src/solve.ts";

const here = dirname(fileURLToPath(import.meta.url));
const casePath = process.argv[2] ?? join(here, "..", "test-case", "rack-orv3.json");
const base = JSON.parse(readFileSync(casePath, "utf8")) as P0Input;
const basePumpCurve = base.curves[base.case.pump.curveId];
if (basePumpCurve === undefined) throw new Error("viz: 缺泵曲线");
const qEnd = basePumpCurve.points.at(-1)?.[0] ?? 0; // 图表 x 域随泵曲线

const clogSteps = [0, 2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30];

function variant(shutdownNode7: boolean, clog: number): P0Input {
  const v = structuredClone(base);
  v.case.filterDpKPa = clog;
  if (shutdownNode7) for (const b of v.case.branches) if (b.id === "node-7") b.shutdown = true;
  return v;
}

function snap(input: P0Input) {
  const r = solve(input);
  const active = r.branches.filter((b) => !b.shutdown);
  return {
    qTotal: r.qTotalLpm,
    pumpDp: r.pumpDpKPa,
    head: r.pumpHeadM,
    residual: r.residual,
    converged: r.converged,
    q: r.branches.map((b) => b.qLpm),
    marginMin: Math.min(...active.map((b) => b.minMarginLpm ?? Infinity)),
  };
}

const qGrid = (n: number) => Array.from({ length: n }, (_, i) => (qEnd * i) / (n - 1));

const out = {
  clogSteps,
  branchIds: base.case.branches.map((b) => b.id),
  minLpm: base.case.branches[0]?.minLpm ?? null,
  curves: {
    pump: qGrid(41).map((q) => ({ q, dp: pumpDpKPaAt(base, q) })),
    sysBaseline: qGrid(21).map((q) => ({ q, dp: systemDpKPaAt(variant(false, 0), q) })).filter((p) => p.q > 5),
    sysOff: qGrid(21).map((q) => ({ q, dp: systemDpKPaAt(variant(true, 0), q) })).filter((p) => p.q > 5),
  },
  // 堵塞漂移对系统曲线是严格加性的（模型定义），视图层只做 +clog 平移；工作点全部真解
  scenarios: {
    baseline: clogSteps.map((c) => snap(variant(false, c))),
    off: clogSteps.map((c) => snap(variant(true, c))),
  },
};

writeFileSync(process.argv[3] ?? join(here, "viz-snapshot.json"), JSON.stringify(out));
console.log(`snapshot: ${out.scenarios.baseline.length + out.scenarios.off.length} solves @ ${casePath}`);
