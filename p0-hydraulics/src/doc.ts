// 计算书生成器（模板：docs/calc-note-template.md）。
// `p0 doc`：solve + sweep + 故障场景 全量求解，产出 calc-note.md（人读）
// 与 calc-note.json（机器读、可 diff）。计算书也是数据，不是散文。

import { createHash } from "node:crypto";
import type { P0Input, P0Output } from "./types.ts";
import { solve, SOLVER_VERSION } from "./solve.ts";
import { sweep } from "./sweep.ts";
import { PROP_SET_VERSION } from "./props.ts";

export interface DocBundle {
  md: string;
  json: Record<string, unknown>;
  converged: boolean;
  inputInvalid: string[];
}

const n = (v: number | null | undefined, d = 1): string =>
  v == null || !Number.isFinite(v) ? "—" : v.toFixed(d);

interface OffRow { id: string; qTotalLpm: number | null; minMarginLpm: number | null; converged: boolean }

function shutdownScenarios(input: P0Input): OffRow[] {
  return input.case.branches.map((b) => {
    const v = structuredClone(input);
    const tb = v.case.branches.find((x) => x.id === b.id);
    if (tb) tb.shutdown = true;
    const o = solve(v);
    const act = o.branches.filter((x) => !x.shutdown);
    const mm = act.length ? Math.min(...act.map((x) => x.minMarginLpm ?? Infinity)) : null;
    return { id: b.id, qTotalLpm: o.qTotalLpm, minMarginLpm: mm != null && Number.isFinite(mm) ? mm : null, converged: o.converged };
  });
}

// 堵塞漂移扫描 → 最低 min 裕度归零点（维护周期建议的输入）
function clogZeroCrossing(input: P0Input): { grid: { f: number; margin: number }[]; zeroAt: number | null } {
  const grid = [0, 5, 10, 15, 20, 25, 30].map((f) => {
    const v = structuredClone(input);
    v.case.filterDpKPa = f;
    const o = solve(v);
    const act = o.branches.filter((x) => !x.shutdown);
    return { f, margin: act.length ? Math.min(...act.map((x) => x.minMarginLpm ?? Infinity)) : NaN };
  });
  let zeroAt: number | null = null;
  for (let i = 1; i < grid.length; i++) {
    const g1 = grid[i];
    const g0 = grid[i - 1];
    if (g1 === undefined || g0 === undefined || g1.margin === undefined || g0.margin === undefined) continue;
    if (g1.margin < 0 && g0.margin >= 0) {
      const { f: f0, margin: m0 } = g0;
      const { f: f1, margin: m1 } = g1;
      zeroAt = f0 + ((0 - m0) * (f1 - f0)) / (m1 - m0);
      break;
    }
  }
  return { grid, zeroAt };
}

function dataRegistry(input: P0Input): { rows: { id: string; basis: string; url: string; uncertainty: string }[]; missing: string[] } {
  const rows: { id: string; basis: string; url: string; uncertainty: string }[] = [];
  const missing: string[] = [];
  const pumpId = input.case.pump.curveId;
  const ids = [pumpId, ...new Set(input.case.branches.flatMap((b) => b.curveIds))];
  for (const id of ids) {
    const cv = input.curves[id];
    if (!cv) continue;
    const p = cv.provenance;
    rows.push({ id, basis: cv.basis ?? "未登记", url: p?.url ?? "—", uncertainty: p?.uncertainty ?? "未登记" });
    if (!p?.url) missing.push(id);
  }
  return { rows, missing };
}

export function generateDoc(inputRaw: string, input: P0Input, command: string): DocBundle {
  const out: P0Output = solve(input);
  const rows = sweep(input);
  const offs = shutdownScenarios(input);
  const clog = clogZeroCrossing(input);
  const reg = dataRegistry(input);
  const inputsHash = "sha256:" + createHash("sha256").update(inputRaw).digest("hex").slice(0, 16);
  const generatedAt = new Date().toISOString();
  const meta = (input.meta ?? {}) as Record<string, string>;

  const verdict = out.inputInvalid.length
    ? "输入无效（未生成有效计算）"
    : out.converged
      ? "**允许出数**（残差达标、无钳位、全曲线域内）"
      : "**未验证——禁止进 proposal**（契约 §6 未满足）";

  const md = `# 计算书（P0 水力） — v${SOLVER_VERSION}

> 生成命令：\`${command}\`；生成时间：${generatedAt}
> 状态：${verdict}

## A. 项目与工况登记

| 字段 | 内容 |
|---|---|
| 客户 / RFQ | ${meta["客户 / RFQ"] ?? "待登记"} |
| 机柜配置 | ${meta["机柜配置"] ?? "待登记"} |
| 房间条件 | ${meta["房间条件"] ?? "待登记（温度/RH/海拔 → P1 露点裕度接管）"} |
| 负载 | ${meta["负载"] ?? "待登记"} |
| 工质 | PG25（物性集 ${PROP_SET_VERSION}） |

## B. 版本与可复现性

\`\`\`json
{ "inputsHash": "${inputsHash}", "solverVersion": "${SOLVER_VERSION}",
  "dataVersion": ${JSON.stringify(input.dataVersion ?? null)}, "propSetVersion": "${PROP_SET_VERSION}",
  "generatedAt": "${generatedAt}", "command": "${command}" }
\`\`\`

半年后客户质询，凭此块 + git tag 一字不差重算。

## C. 输入数据登记表（逐项来源与不确定度）

| 引用 id | 工质基准 | 来源 | 不确定度 |
|---|---|---|---|
${reg.rows.map((r) => `| \`${r.id}\` | ${r.basis} | ${r.url === "—" ? "—" : r.url} | ${r.uncertainty} |`).join("\n")}
${reg.missing.length ? `\n⚠ **数据来源未登记**：${reg.missing.join(", ")}——按政策补登记后方可进 proposal。\n` : ""}
## D. 模型与假设登记表

1. 拓扑：CDU 泵 → 供回干管（单程 ×2）→ N 并联支路（曲线串联 + 可选管路摩擦）；
2. 物性：PG25 按供回均值温度查 LC 25 表（密度/黏度随温度修正）；
3. 摩擦：层流 64/Re → 过渡带 2300–4000 线性内插 → Haaland（f 全域连续）；
4. 泵：额定曲线查表 + 变频相似定律（如适用）；
5. 忽略项：重力位差、热泄漏、瞬态（P2 接管）。

## E. 结果（承诺参数，对齐 guarantee-interface §2）

- 总流量 **${n(out.qTotalLpm)} L/min**，泵压升 **${n(out.pumpDpKPa)} kPa**（扬程 ${n(out.pumpHeadM, 2)} m，${out.pumpHz != null ? `运行 ${n(out.pumpHz, 0)} Hz` : "频率未登记"}）
- 残差 ${out.residual == null ? "—" : out.residual.toExponential(2)}，${out.converged ? "收敛" : "**未收敛**"}
${out.warnings.length ? `- ⚠ 警告：${out.warnings.join("；")}\n` : ""}
| 支路 | 流量 (L/min) | 占比 | 耦合面 ΔP (kPa) | min 裕度 (L/min) |
|---|---|---|---|---|
${out.branches.map((b) => `| ${b.id} | ${b.shutdown ? "— 关断 —" : n(b.qLpm)} | ${b.shutdown ? "—" : n(b.sharePct) + "%"} | ${n(b.dpKPa)} | ${b.minMarginLpm == null ? "—" : (b.minMarginLpm >= 0 ? "+" : "") + n(b.minMarginLpm)} |`).join("\n")}

## F. 敏感性分析（±10% 关键输入扰动）

| 扰动 | Q_total (L/min) | 泵压升 (kPa) | min 裕度 (L/min) | 收敛 |
|---|---|---|---|---|
${rows.map((r) => `| ${r.perturbation} | ${n(r.qTotalLpm)} | ${n(r.pumpDpKPa)} | ${r.minMarginLpm == null ? "—" : (r.minMarginLpm >= 0 ? "+" : "") + n(r.minMarginLpm)} | ${r.converged ? "✓" : "✗"} |`).join("\n")}

## G. 故障与退化场景

**单支路关断再分配**（其余支路 min 裕度）：

| 关断支路 | Q_total (L/min) | 剩余最低 min 裕度 (L/min) |
|---|---|---|
${offs.map((r) => `| ${r.id} | ${n(r.qTotalLpm)} | ${r.minMarginLpm == null ? "—" : (r.minMarginLpm >= 0 ? "+" : "") + n(r.minMarginLpm)} |`).join("\n")}

**堵塞漂移扫描**（各支路 +ΔP 0→30 kPa）：${clog.zeroAt != null ? `最低裕度在 **${n(clog.zeroAt)} kPa** 处归零——滤网维护周期建议以此为界。` : "扫描至 30 kPa 最低裕度未归零。"}

部分负载场景：P1 热链接管后补充。

## H. 安全系数与不承诺事项（guarantee-interface §4）

不承诺：die→冷板热行为（服务器厂商域）；服务器内部管路压降；房间级气流与热回流（P4 外购）；任何无源（redlight）数据参与的计算结果。

## I. 复核与签发

| 环节 | 执行者 | 状态 |
|---|---|---|
| 生成 | ${command} | ✓ ${generatedAt} |
| 内部复核 | 敌意评审报告 docs/review-p0-v2.0.md（放行） | ✓ |
| 外部复核 | 注册工程师（PE/特许）签字栏 | 灯塔项目起 |
`;

  const json = {
    schema: "calc-note/v0.1",
    status: out.inputInvalid.length ? "input-invalid" : out.converged ? "ok" : "unverified",
    b: { inputsHash, solverVersion: SOLVER_VERSION, dataVersion: input.dataVersion ?? null, propSetVersion: PROP_SET_VERSION, generatedAt, command },
    c: reg.rows,
    e: { qTotalLpm: out.qTotalLpm, pumpDpKPa: out.pumpDpKPa, pumpHeadM: out.pumpHeadM, pumpHz: out.pumpHz, residual: out.residual, converged: out.converged, warnings: out.warnings, branches: out.branches },
    f: rows,
    g: { shutdown: offs, clogGrid: clog.grid, clogZeroAtKPa: clog.zeroAt },
  };

  return { md, json, converged: out.converged, inputInvalid: out.inputInvalid };
}
