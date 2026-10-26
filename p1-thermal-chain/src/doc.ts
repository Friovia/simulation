// P1 计算书生成器（模板对齐 docs/calc-note-template.md 与 P0 doc.ts 的 A-I 结构）。
// `p1 doc`：solve + sweep + 红线判定全量求解，产出 calc-note-thermal.md（人读）
// 与 calc-note-thermal.json（机器读、可 diff）。计算书也是数据，不是散文。

import { createHash } from "node:crypto";
import type { P1Input, P1Output } from "./types.ts";
import { solve, SOLVER_VERSION } from "./solve.ts";
import { sweep } from "./sweep.ts";
import { PROP_SET_VERSION } from "../../p0-hydraulics/src/props.ts";

export interface DocBundle {
  md: string;
  json: Record<string, unknown>;
  converged: boolean;
  inputInvalid: string[];
}

const n = (v: number | null | undefined, d = 2): string =>
  v == null || !Number.isFinite(v) ? "—" : v.toFixed(d);

export function generateDoc(inputRaw: string, input: P1Input, command: string): DocBundle {
  const out: P1Output = solve(input);
  const rows = sweep(input);
  const inputsHash = "sha256:" + createHash("sha256").update(inputRaw).digest("hex").slice(0, 16);
  const generatedAt = new Date().toISOString();
  const meta = (input.meta ?? {}) as Record<string, string>;
  const c = input.case;

  // 数据溯源：hx 曲线（slope 模式）+ θ 假设登记（hotSpot.note）
  const dataRows: { id: string; kind: string; basis: string; url: string; uncertainty: string }[] = [];
  if (c.supplySource.mode === "hx" && c.supplySource.hx.mode === "slope") {
    const cv = input.curves?.[c.supplySource.hx.curveId];
    const p = cv?.provenance;
    dataRows.push({
      id: c.supplySource.hx.curveId,
      kind: "hx 曲线（Q-ATD 斜率）",
      basis: `${cv?.basis ?? "未登记"}；flowBasis：${cv?.flowBasis ?? "未登记"}（转写额定 ${c.supplySource.hx.ratedTcsLpm} L/min）`,
      url: p?.url ?? "—",
      uncertainty: p?.uncertainty ?? "未登记",
    });
  }
  if (c.supplySource.mode === "hx" && c.supplySource.hx.mode === "ua") {
    dataRows.push({ id: "hx-ua", kind: "UA（W/K）", basis: `逆流 ε-NTU，UA=${c.supplySource.hx.uaWK}`, url: c.supplySource.hx.source ?? "—", uncertainty: "UA 须来自选型软件/commissioning（红灯数据禁止）" });
    dataRows.push({ id: "fws", kind: "一次侧物性", basis: `${n(c.supplySource.fws.supplyC)}°C / ${n(c.supplySource.fws.flowLpm, 1)} L/min`, url: c.supplySource.fws.note, uncertainty: "输入侧登记责任（无源不入库）" });
  }
  for (const l of c.loads) {
    if (!l.hotSpot) continue;
    dataRows.push({
      id: `${l.id}.hotSpot`,
      kind: "冷板 θ",
      basis: `θ=${l.hotSpot.thetaKPerW} K/W（${l.hotSpot.thetaRef ?? "inlet"} 参考）@ Q_hot=${l.hotSpot.qW} W${l.hotSpot.thetaFlowLpmRange ? `，流量域 [${l.hotSpot.thetaFlowLpmRange[0]}, ${l.hotSpot.thetaFlowLpmRange[1]}] L/min${l.hotSpot.thetaFlowSplitN != null ? `（每路 = 支路/${l.hotSpot.thetaFlowSplitN}）` : ""}` : ""}`,
      url: l.hotSpot.note ?? "—",
      uncertainty: l.hotSpot.tCaseMaxC != null ? `T_case 上限 ${l.hotSpot.tCaseMaxC}°C（占位/登记值）` : "未登记上限",
    });
  }

  const verdict = out.inputInvalid.length
    ? "输入无效（未生成有效计算）"
    : out.converged
      ? "**允许出数**（定点达标、无域红旗）"
      : "**未验证——禁止进 proposal**（契约 §6 未满足）";

  const guaranteeRows = [
    ["供液温度（UQD 承诺面）", `${n(out.tSupplyC)} °C`, "hx 模式=换热能力反推 / given=设定值"],
    ["回液温度 / 温升", `${n(out.tReturnC)} °C / ${n(out.dtRackK)} K`, "聚合能量平衡"],
    [out.dewPass == null ? "露点红线（未评估）" : out.dewPass ? "露点红线" : "露点红线 **不通过**", out.dewMarginK == null ? "—" : `${n(out.dewMarginK)} K ≥ ${out.dewMarginMinK} K ${out.dewPass ? "✓" : "✗"}`, out.dewPointC != null ? `露点 ${n(out.dewPointC)}°C（A-E 1996）` : "房间条件未登记"],
    [out.wClassPass == null ? "ASHRAE W 级（未评估）" : out.wClassPass ? `ASHRAE ${c.wClass}` : `ASHRAE ${c.wClass} **不通过**`, out.wClassCheckC == null ? "—" : `${n(out.wClassCheckC, 1)} °C ∈ [2, ${out.wClassMaxSupplyC}] ${out.wClassPass ? "✓" : "✗"}`, c.supplySource.mode === "hx" ? "查 FWS 供水（等级本义）" : "查 TCS 供水（given 从严）"],
  ];

  const md = `# 计算书（P1 热阻链） — v${SOLVER_VERSION}

> 生成命令：\`${command}\`；生成时间：${generatedAt}
> 状态：${verdict}

## A. 项目与工况登记

| 字段 | 内容 |
|---|---|
| 客户 / RFQ | ${meta["客户 / RFQ"] ?? "待登记"} |
| 机柜配置 | ${meta["机柜配置"] ?? "待登记"} |
| 房间条件 | ${c.room ? `${c.room.tAirC}°C / ${c.room.rhPct}%RH（露点红线裕量 ≥ ${c.room.minDewMarginK} K）` : "未登记（露点红线未评估）"} |
| 负载 | ${meta["负载"] ?? "待登记"}（Σ ${n(out.qTotalW / 1000, 1)} kW，液体侧 ${n(out.qTotalFluidW / 1000, 1)} kW${out.qTotalW !== out.qTotalFluidW ? "，capture" : ""}） |
| 工质 | 二次侧 PG25（物性集 ${PROP_SET_VERSION}）；一次侧 ${c.supplySource.mode === "hx" ? "输入登记" : "不涉及"} |

## B. 版本与可复现性

\`\`\`json
{ "inputsHash": "${inputsHash}", "solverVersion": "${SOLVER_VERSION}",
  "dataVersion": ${JSON.stringify(input.dataVersion ?? null)}, "propSetVersion": "${PROP_SET_VERSION}",
  "generatedAt": "${generatedAt}", "command": "${command}" }
\`\`\`

## C. 输入数据登记表（逐项来源与不确定度）

| 引用 id | 类别 | 基准/条件 | 来源 | 不确定度 |
|---|---|---|---|---|
${dataRows.map((r) => `| \`${r.id}\` | ${r.kind} | ${r.basis} | ${r.url} | ${r.uncertainty} |`).join("\n")}

## D. 模型与假设登记表

1. 热链：芯片稳态负荷 → capturePct（默认 100，保守）→ 冷板 θ（T_case = T_ref + θ·Q_hot）→ 支路能量平衡（物性按支路平均液温定点）→ 机柜聚合平衡 → CDU 换热器；
2. 换热器：slope=厂商 Q/ATD 斜率闭式（额定流量域 ±10% 告警/±25% 不可信，契约 §3.2 A1）或 ua=UA+逆流 ε-NTU；
3. 露点：Alduchov–Eskridge 1996（Sonntag 交叉断言 <0.15 K）；W 级：hx 查 FWS/given 从严查 TCS，全级下限 2°C；
4. 域守卫：物性表域 0–60°C、LC25 许用 −10…90°C、沸点 101.4°C，越界=不可信；
5. 忽略项：瞬态与控制（P2）、室内排热（P4/缺口 §3.3）、FWS 侧防凝露（设施域）。

## E. 结果（承诺参数，对齐 guarantee-interface §3）

${guaranteeRows.map((r) => `- **${r[0]}**：${r[1]}（${r[2]}）`).join("\n")}
- 定点末步差 ${out.maxFixedPointStep == null ? "—" : out.maxFixedPointStep.toExponential(2)}（判据 ≤1e-8），${out.converged ? "收敛" : "**未收敛/不可信**"}
${out.hx ? `- 换热器：Q=${n(out.hx.qKw, 1)} kW${out.hx.mode === "slope" ? `，S=${n((out.hx.slopeWKPerK ?? 0) / 1000)} kW/K，ATD=${n(out.hx.atdK)} K，额定流量偏离 ${n(out.hx.ratedFlowDevPct, 1)}%` : `，UA=${out.hx.uaWK} W/K，ε=${n(out.hx.eps, 4)}，NTU=${n(out.hx.ntu, 3)}，C_min=${n(out.hx.cMinWKPerK, 1)} W/K`}，FWS 回水 ${n(out.hx.tColdOutC)}°C` : ""}
${out.warnings.length ? `- ⚠ 警告：${out.warnings.join("；")}\n` : ""}
| 节点 | 流量 (L/min) | 负荷 (kW) | 出液 (°C) | ΔT (K) | T_case (°C) | 裕度 (K) |
|---|---|---|---|---|---|---|
${out.nodes.map((v) => `| ${v.id} | ${n(v.qLpm, 1)} | ${n(v.qW / 1000, 1)} | ${v.tOutC == null ? "— 过热无解 —" : n(v.tOutC)} | ${v.dTK == null ? "—" : n(v.dTK)} | ${v.tCaseC == null ? "—" : n(v.tCaseC, 1)} | ${v.tCaseMarginC == null ? "—" : (v.tCaseMarginC >= 0 ? "+" : "") + n(v.tCaseMarginC, 1)} |`).join("\n")}

## F. 敏感性分析（±10% 关键输入扰动；FWS 温度 ±2K）

| 扰动 | 供液 (°C) | 回液 (°C) | ΔT (K) | min T_case 裕度 (K) | 露点裕度 (K) | 收敛 |
|---|---|---|---|---|---|---|
${rows.map((r) => `| ${r.perturbation} | ${n(r.tSupplyC)} | ${n(r.tReturnC)} | ${n(r.dtRackK)} | ${r.minTCaseMarginC == null ? "—" : (r.minTCaseMarginC >= 0 ? "+" : "") + n(r.minTCaseMarginC, 1)} | ${r.dewMarginK == null ? "—" : n(r.dewMarginK)} | ${r.converged ? "✓" : "✗"} |`).join("\n")}

## G. 故障与退化场景

热链侧退化=部分负载/支路关断后流量再分配（流量由 P0 重解后经 --from-p0 注入）；本表为当前 flows 快照的响应。部分负载敏感性见 F 节（热负荷 ±10%）。

## H. 安全系数与不承诺事项（guarantee-interface §4）

不承诺：die→冷板热行为（服务器厂商域）；T_fluid_max/最小流量（冷板库 redlight，§3.3）；室内排热（P4 外购/缺口）；capturePct 实测标定（现仅 OCP 70–75% 文献口径）；任何无源（redlight）数据参与的计算结果。

## I. 复核与签发

| 环节 | 执行者 | 状态 |
|---|---|---|
| 生成 | ${command} | ✓ ${generatedAt} |
| 内部复核 | 敌意评审报告 docs/review-p1-v0.1.md（放行，findings 已修） | ✓ |
| 外部复核 | 注册工程师（PE/特许）签字栏 | 灯塔项目起 |
`;

  const json = {
    schema: "calc-note-thermal/v0.1",
    status: out.inputInvalid.length ? "input-invalid" : out.converged ? "ok" : "unverified",
    b: { inputsHash, solverVersion: SOLVER_VERSION, dataVersion: input.dataVersion ?? null, propSetVersion: PROP_SET_VERSION, generatedAt, command },
    c: dataRows,
    e: {
      qTotalW: out.qTotalW, qTotalFluidW: out.qTotalFluidW, tSupplyC: out.tSupplyC, tReturnC: out.tReturnC, dtRackK: out.dtRackK,
      hx: out.hx, nodes: out.nodes,
      dewPointC: out.dewPointC, dewMarginK: out.dewMarginK, dewPass: out.dewPass,
      wClassCheckC: out.wClassCheckC, wClassPass: out.wClassPass,
      maxFixedPointStep: out.maxFixedPointStep, converged: out.converged, warnings: out.warnings,
    },
    f: rows,
  };

  return { md, json, converged: out.converged, inputInvalid: out.inputInvalid };
}
