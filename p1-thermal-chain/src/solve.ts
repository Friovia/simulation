// P1 求解内核。纯函数：solve(input) → output，无状态、无 IO、无日志。
// 收敛语义（对齐 P0 §6）：converged = 数值有限 + 定点收敛（maxFixedPointStep ≤ 1e-8）
// + 无数据域越界（信任红旗：物性表域/LC25 许用与沸点/hx 流量带宽/θ 数据域/热力学可行性）。
// 合规发现（露点裕度/W 级/T_case 裕度为负）是合法输出——warning + guarantees fail，
// 不改 converged（方案不合格与算错数是两回事：数字可信，结论照报）。
// 评审记录：docs/review-p1-v0.1.md findings 已修复（2026-10-19）：
//   M1 物性域/许用/沸点越界翻 untrusted；m2 ua 零流量对称处理；m5 审计字段；
//   m4 capturePct；n8 A-E 域告警；n9 hotSpot.qW≤qW 校验；n12 given W 级口径提示。
// 登记假设（guarantee-interface §3 假设登记表）：hx 斜率流量带宽 ±10% 告警 / ±25% 不可信。

import { PROPS_DOMAIN_C, PROP_SET_VERSION, PG25_ALLOWABLE_C, PG25_BOILING_C } from "../../p0-hydraulics/src/props.ts";
import { WCLASS_MAX_SUPPLY_C, ASHRAE_MIN_SUPPLY_C, type WClass } from "./standards.ts";
import { dewPointC, dewPointCrossDiffK, AE_DOMAIN_C } from "./dew.ts";
import { balanceDTK } from "./thermal.ts";
import { hxSlope, hxUa, hxOutFromSlope, hxOutFromUa } from "./hx.ts";
import type { P1Input, P1Output, NodeOut, HxOut } from "./types.ts";

export const SOLVER_VERSION = "0.2.0";

// 斜率流量带宽（登记假设，guarantee-interface §3：S(流量) 无公开数据）
const FLOWBAND_WARN_PCT = 10;
const FLOWBAND_UNTRUSTED_PCT = 25;
const FIXED_POINT_LIMIT = 1e-8; // §6.1 P1 等价判据（停机准则 1e-12，此为验收上限）

export function validateInput(input: P1Input): string[] {
  const errs: string[] = [];
  if (!input || typeof input !== "object") return ["input 不是对象"];
  if (input.schema !== "p1/v0.1") errs.push(`input.schema 不支持：${String(input.schema)}`);
  const c = input.case;
  if (!c || typeof c !== "object") return [...errs, "缺 case"];
  if (c.fluid !== "pg25") errs.push(`case.fluid 仅支持 pg25（got ${String(c.fluid)}）`);
  if (!Array.isArray(c.loads) || c.loads.length === 0) return [...errs, "loads 必须为非空数组"];
  if (!Array.isArray(c.flows) || c.flows.length === 0) return [...errs, "flows 必须为非空数组"];

  const flowIds = new Set<string>();
  for (const f of c.flows) {
    if (!f || typeof f !== "object" || !f.id) { errs.push("flows 项缺 id"); continue; }
    if (flowIds.has(f.id)) errs.push(`flows id 重复：${f.id}`);
    flowIds.add(f.id);
    if (typeof f.qLpm !== "number" || !(f.qLpm >= 0)) errs.push(`flows ${f.id} qLpm 必须为非负数值`);
  }

  const ss = c.supplySource;
  if (!ss || typeof ss !== "object") {
    errs.push("缺 supplySource");
  } else if (ss.mode === "given") {
    if (typeof ss.tSupplyC !== "number" || !Number.isFinite(ss.tSupplyC)) errs.push("supplySource.tSupplyC 必须为有限数值");
  } else if (ss.mode === "hx") {
    const h = ss.hx;
    const fw = ss.fws;
    if (!h || typeof h !== "object") {
      errs.push("缺 supplySource.hx");
    } else if (h.mode === "slope") {
      if (!(h.ratedTcsLpm > 0)) errs.push("hx.ratedTcsLpm 必须 > 0");
      const cv = input.curves?.[h.curveId];
      if (!cv) {
        errs.push(`缺 hx 曲线：${String(h.curveId)}`);
      } else if (cv.x !== "°C" || cv.y !== "kW") {
        errs.push(`hx 曲线 ${h.curveId} 单位必须为 °C→kW（got ${String(cv.x)}→${String(cv.y)}）`);
      } else {
        const pts = cv.points;
        const first = pts[0];
        const lastPt = pts[pts.length - 1];
        if (!Array.isArray(pts) || pts.length < 3) errs.push(`hx 曲线 ${h.curveId} 点数 < 3`);
        else if (first === undefined || first[0] !== 0) errs.push(`hx 曲线 ${h.curveId} 必须过原点（首点 x=0）`);
        else if (lastPt === undefined) errs.push(`hx 曲线 ${h.curveId} 末点缺失`);
        else {
          let mono = true;
          for (let i = 1; i < pts.length; i++) {
            const pi = pts[i];
            const pp = pts[i - 1];
            if (pi === undefined || pp === undefined || pi[0] <= pp[0]) mono = false;
          }
          if (!mono) errs.push(`hx 曲线 ${h.curveId} x 非严格单调升`);
          else {
            const slope = lastPt[1] / lastPt[0];
            if (!(slope > 0)) errs.push(`hx 曲线 ${h.curveId} 斜率非正`);
            else {
              let lin = true;
              for (const [x, y] of pts) {
                if (Math.abs(y - slope * x) > 1e-6 * Math.max(1, Math.abs(y), Math.abs(slope * x))) { lin = false; break; }
              }
              if (!lin) errs.push(`hx 曲线 ${h.curveId} 非过原点直线（Q∝ATD 模型前提）`);
            }
          }
        }
      }
    } else if (h.mode === "ua") {
      if (!(h.uaWK > 0)) errs.push("hx.uaWK 必须 > 0");
      if (h.arrangement !== "counterflow") errs.push(`hx.arrangement 仅支持 counterflow（got ${String(h.arrangement)}）`);
    } else {
      errs.push(`hx.mode 非法：${String((h as { mode?: unknown }).mode)}`);
    }
    if (!fw || typeof fw !== "object") {
      errs.push("缺 supplySource.fws");
    } else {
      if (typeof fw.supplyC !== "number" || !Number.isFinite(fw.supplyC)) errs.push("fws.supplyC 必须为有限数值");
      if (!(fw.flowLpm > 0)) errs.push("fws.flowLpm 必须 > 0");
      if (!(fw.cpJkgK > 0)) errs.push("fws.cpJkgK 必须 > 0");
      if (!(fw.rhoKgM3 > 0)) errs.push("fws.rhoKgM3 必须 > 0");
      if (typeof fw.note !== "string" || !fw.note.trim()) errs.push("fws.note 必填（物性来源登记，无源不入库政策）"); // n13
    }
  } else {
    errs.push(`supplySource.mode 非法：${String((ss as { mode?: unknown }).mode)}`);
  }

  const loadIds = new Set<string>();
  for (const l of c.loads) {
    if (!l || typeof l !== "object" || !l.id) { errs.push("loads 项缺 id"); continue; }
    if (loadIds.has(l.id)) errs.push(`loads id 重复：${l.id}`);
    loadIds.add(l.id);
    if (typeof l.qW !== "number" || !(l.qW >= 0)) errs.push(`load ${l.id} qW 必须为非负数值`);
    if (l.capturePct != null && !(l.capturePct > 0 && l.capturePct <= 100)) errs.push(`load ${l.id} capturePct 必须 ∈ (0,100]`);
    if (!flowIds.has(l.id)) errs.push(`load ${l.id} 在 flows 中无对应流量`);
    const hs = l.hotSpot;
    if (hs != null) {
      if (typeof hs.qW !== "number" || !(hs.qW >= 0)) errs.push(`hotSpot ${l.id} qW 必须为非负数值`);
      if (!(hs.thetaKPerW > 0)) errs.push(`hotSpot ${l.id} thetaKPerW 必须 > 0`);
      if (typeof hs.qW === "number" && typeof l.qW === "number" && hs.qW > l.qW) errs.push(`hotSpot ${l.id} qW ${hs.qW} > 节点负荷 ${l.qW}（单 die 热点不超过节点总负荷，n9）`);
      if (hs.thetaRef != null && hs.thetaRef !== "inlet" && hs.thetaRef !== "mean") errs.push(`hotSpot ${l.id} thetaRef 非法：${String(hs.thetaRef)}`);
      if (hs.tCaseMaxC != null && !Number.isFinite(hs.tCaseMaxC)) errs.push(`hotSpot ${l.id} tCaseMaxC 必须为有限数值`);
      if (hs.thetaFlowLpmRange != null) {
        const [a, b] = hs.thetaFlowLpmRange;
        if (!(a > 0) || !(b > a)) errs.push(`hotSpot ${l.id} thetaFlowLpmRange 必须 [a,b] 且 0<a<b`);
      }
      if (hs.thetaFlowSplitN != null && !(hs.thetaFlowSplitN >= 1)) errs.push(`hotSpot ${l.id} thetaFlowSplitN 必须 ≥ 1`);
    }
  }

  const r = c.room;
  if (r != null) {
    if (typeof r.tAirC !== "number" || !Number.isFinite(r.tAirC)) errs.push("room.tAirC 必须为有限数值");
    if (typeof r.rhPct !== "number" || !(r.rhPct > 0 && r.rhPct <= 100)) errs.push("room.rhPct 必须 ∈ (0,100]");
    if (typeof r.minDewMarginK !== "number" || !(r.minDewMarginK >= 0)) errs.push("room.minDewMarginK 必须为非负数值");
  }
  if (c.wClass != null && !(c.wClass in WCLASS_MAX_SUPPLY_C)) errs.push(`wClass 非法：${String(c.wClass)}`);
  return errs;
}

function versions(input: P1Input): P1Output["versions"] {
  return { solver: SOLVER_VERSION, props: PROP_SET_VERSION, input: input?.schema ?? "?", dataVersion: input?.dataVersion ?? null };
}

export function solve(input: P1Input): P1Output {
  const invalid = validateInput(input);
  const warnings = new Set<string>(invalid);
  const fail = (): P1Output => ({
    schema: "p1-out/v0.1",
    converged: false,
    warnings: [...warnings],
    inputInvalid: invalid,
    qTotalW: NaN, qTotalFluidW: NaN, tSupplyC: NaN, tReturnC: NaN, dtRackK: NaN,
    hx: null, nodes: [],
    dewPointC: null, dewMarginK: null, dewMarginMinK: null, dewPass: null,
    wClassMaxSupplyC: null, wClassCheckC: null, wClassPass: null,
    maxFixedPointStep: null,
    versions: versions(input),
  });
  if (invalid.length) return fail();

  const c = input.case;
  const flowMap = new Map(c.flows.map((f) => [f.id, f.qLpm] as const));
  const qTotalW = c.loads.reduce((s, l) => s + l.qW, 0);
  const qTotalFluidW = c.loads.reduce((s, l) => s + l.qW * (l.capturePct ?? 100) / 100, 0);
  const qTotLpm = c.flows.reduce((s, f) => s + f.qLpm, 0);
  const steps: number[] = []; // 定点末步差（审计面，m5/m6）

  // m2：零流量带载过热无解——ua/slope 对称前置拦截（不再进入换热器求值）
  const zeroFlowLoaded = qTotLpm <= 0 && qTotalFluidW > 0;

  let untrusted = false;
  let tSupplyC: number;
  let hxOut: HxOut | null = null;
  let tReturnFromHx: number | null = null; // ua 模式：T_r 由 ε-NTU 闭式给出
  let slopeParts: ReturnType<typeof hxSlope> | null = null;

  if (zeroFlowLoaded) {
    warnings.add(`机柜总流量 ${qTotLpm.toFixed(2)} L/min 带载 ${(qTotalFluidW / 1000).toFixed(1)} kW：零流量带载过热无解（温度不出数）`);
    untrusted = true;
    tSupplyC = NaN;
  } else if (c.supplySource.mode === "hx") {
    const { hx, fws } = c.supplySource;
    if (fws.supplyC < 0 || fws.supplyC > 60) {
      warnings.add(`FWS 供水 ${fws.supplyC}°C 超出常规设施水温范围 0–60°C（一次侧为设施域，请复核输入）`); // n9
    }
    if (hx.mode === "slope") {
      const hxCurve = input.curves?.[hx.curveId];
      if (hxCurve === undefined) throw new Error(`内部错误：hx 曲线 ${hx.curveId} 未通过 validateInput`);
      slopeParts = hxSlope(hxCurve, hx.ratedTcsLpm, qTotLpm, qTotalFluidW, fws);
      tSupplyC = slopeParts.tSupplyC;
      if (qTotalFluidW > 0) { // 零负荷时 S 不参与物理，不做带宽判定（m2 平凡解）
        if (slopeParts.ratedFlowDevPct >= FLOWBAND_UNTRUSTED_PCT) {
          untrusted = true;
          warnings.add(`TCS 实际流量 ${qTotLpm.toFixed(1)} L/min 偏离 hx 曲线额定流量域 ${hx.ratedTcsLpm} L/min 达 ${slopeParts.ratedFlowDevPct.toFixed(1)}%（斜率仅额定流量有据，超 ±25% 登记带宽：输出不可信）`);
        } else if (slopeParts.ratedFlowDevPct >= FLOWBAND_WARN_PCT) {
          warnings.add(`TCS 实际流量 ${qTotLpm.toFixed(1)} L/min 偏离 hx 曲线额定流量域 ${hx.ratedTcsLpm} L/min 达 ${slopeParts.ratedFlowDevPct.toFixed(1)}%（斜率仅额定流量有据，登记带宽 ±10% 起告警）`);
        }
      }
    } else {
      const u = hxUa(hx.uaWK, qTotLpm, qTotalFluidW, fws);
      if (!u) {
        warnings.add("hx ua 模式定点未收敛（物性表异常）");
        return fail();
      }
      steps.push(u.step);
      tSupplyC = u.tSupplyC;
      tReturnFromHx = u.tHotInC;
      hxOut = hxOutFromUa(qTotalFluidW, u, hx.uaWK);
    }
  } else {
    tSupplyC = c.supplySource.tSupplyC;
  }

  // 机柜能量平衡（ua 模式 T_r 已由 ε-NTU 给出，ΔT 构造性一致）
  let dtRackK: number;
  let tReturnC: number;
  let rackMeanC = NaN;
  if (zeroFlowLoaded) {
    dtRackK = NaN;
    tReturnC = NaN;
  } else if (tReturnFromHx != null) {
    tReturnC = tReturnFromHx;
    dtRackK = tReturnC - tSupplyC;
    rackMeanC = 0.5 * (tSupplyC + tReturnC);
  } else {
    const rack = balanceDTK(tSupplyC, qTotLpm, qTotalFluidW);
    if (!rack) {
      warnings.add("机柜能量平衡定点未收敛（物性表异常）");
      return fail();
    }
    steps.push(rack.step);
    dtRackK = rack.dTK;
    tReturnC = tSupplyC + dtRackK;
    rackMeanC = rack.tMeanC;
  }
  if (slopeParts) hxOut = hxOutFromSlope(qTotalFluidW, tReturnC, slopeParts);

  // 热力学可行性：FWS 回水不得高于 TCS 回液（slope 斜率是经验式，需显式检查；ua 模式构造性成立）
  if (hxOut && Number.isFinite(hxOut.tHotInC) && hxOut.tColdOutC > hxOut.tHotInC + 1e-9) {
    untrusted = true;
    warnings.add(`FWS 回水 ${hxOut.tColdOutC.toFixed(1)}°C ≥ TCS 回液 ${hxOut.tHotInC.toFixed(1)}°C（热力学不可行：一次侧容量不足或斜率在域外失效）`);
  }

  // 节点热链
  const nodes: NodeOut[] = [];
  const propsChecked: number[] = [tSupplyC, rackMeanC];
  const tcsTemps: number[] = [tSupplyC, tReturnC];
  for (const l of c.loads) {
    const q = flowMap.get(l.id);
    if (q === undefined) throw new Error(`内部错误：load ${l.id} 无对应流量（validateInput 不变式）`);
    const qFluidW = l.qW * (l.capturePct ?? 100) / 100;
    const base = { id: l.id, qLpm: q, qW: l.qW, qFluidW, tInC: tSupplyC };
    if (q <= 0 && qFluidW > 0) {
      warnings.add(`支路 ${l.id} 零流量但带 ${qFluidW} W 液体负荷：过热无解（tOut/T_case 不出数）`);
      untrusted = true;
      nodes.push({ ...base, tOutC: null, dTK: null, tCaseRefC: null, tCaseC: null, tCaseMarginC: null });
      continue;
    }
    const b = balanceDTK(tSupplyC, q, qFluidW);
    if (!b) {
      warnings.add(`支路 ${l.id} 能量平衡定点未收敛`);
      untrusted = true;
      nodes.push({ ...base, tOutC: null, dTK: null, tCaseRefC: null, tCaseC: null, tCaseMarginC: null });
      continue;
    }
    steps.push(b.step);
    propsChecked.push(b.tMeanC);
    const tOutC = tSupplyC + b.dTK;
    tcsTemps.push(tOutC);
    const hs = l.hotSpot;
    if (!hs) {
      nodes.push({ ...base, tOutC, dTK: b.dTK, tCaseRefC: null, tCaseC: null, tCaseMarginC: null });
      continue;
    }
    const refC = hs.thetaRef === "mean" ? b.tMeanC : tSupplyC;
    const tCaseC = refC + hs.thetaKPerW * hs.qW;
    if (hs.thetaFlowLpmRange) {
      const per = q / (hs.thetaFlowSplitN ?? 1);
      const [lo, hi] = hs.thetaFlowLpmRange;
      if (per < lo - 1e-9 || per > hi + 1e-9) {
        untrusted = true;
        warnings.add(`支路 ${l.id} 每路流量 ${per.toFixed(2)} L/min 超出 θ 数据域 [${lo}, ${hi}]（冷板 θ 仅在该域有据：输出不可信）`);
      }
    }
    if (hs.tCaseMaxC != null && tCaseC > hs.tCaseMaxC) {
      warnings.add(`热点 ${l.id} T_case ${tCaseC.toFixed(1)}°C 超厂商上限 ${hs.tCaseMaxC}°C（降额或提流量）`);
    }
    nodes.push({
      ...base,
      tOutC,
      dTK: b.dTK,
      tCaseRefC: refC,
      tCaseC,
      tCaseMarginC: hs.tCaseMaxC != null ? hs.tCaseMaxC - tCaseC : null,
    });
  }

  // M1：物性表域越界 = 数据域红旗（untrusted，不再是仅告警）；聚合报告全部命中点
  const over = propsChecked.filter((t) => Number.isFinite(t) && (t < PROPS_DOMAIN_C[0] || t > PROPS_DOMAIN_C[1]));
  if (over.length) {
    untrusted = true;
    warnings.add(`物性评估温度超 Dow LC 25 表域 0–60°C（${over.length} 处，极端 ${Math.min(...over).toFixed(1)}/${Math.max(...over).toFixed(1)}°C——端点钳位，域外无据：输出不可信）`);
  }
  // M1：LC25 产品许用与常压沸点守卫（memo §1.1）
  const tcsMax = Math.max(...tcsTemps.filter(Number.isFinite), -Infinity);
  if (Number.isFinite(tcsMax)) {
    if (tcsMax > PG25_BOILING_C) {
      untrusted = true;
      warnings.add(`TCS 温度 ${tcsMax.toFixed(1)}°C 超 PG25 常压沸点 ${PG25_BOILING_C}°C（memo §1.1）——物理荒谬，请检查输入`);
    } else if (tcsMax > PG25_ALLOWABLE_C[1]) {
      untrusted = true;
      warnings.add(`TCS 温度 ${tcsMax.toFixed(1)}°C 超 LC 25 产品许用上限 ${PG25_ALLOWABLE_C[1]}°C（memo §1.1，许用 −10…90°C：输出不可信）`);
    }
  }

  // 露点红线（承诺面=UQD 耦合面的 TCS 供液；FWS 侧防凝露属设施域，仅提示）
  let dewPoint: number | null = null;
  let dewMarginK: number | null = null;
  let dewMarginMinK: number | null = null;
  let dewPass: boolean | null = null;
  if (c.room) {
    if (c.room.tAirC < AE_DOMAIN_C[0] || c.room.tAirC > AE_DOMAIN_C[1]) {
      warnings.add(`房间温度 ${c.room.tAirC}°C 超出 A-E 露点式拟合域 −40…+50°C（memo G8，结果无据）`); // n8
    }
    const dp = dewPointC(c.room.tAirC, c.room.rhPct);
    const cross = dewPointCrossDiffK(c.room.tAirC, c.room.rhPct);
    if (cross > 0.15) warnings.add(`露点系数交叉核差 ${cross.toFixed(3)} K > 0.15 K（实现异常）`);
    dewPoint = dp;
    dewMarginK = tSupplyC - dp;
    dewMarginMinK = c.room.minDewMarginK;
    dewPass = dewMarginK >= dewMarginMinK;
    if (!dewPass) {
      warnings.add(`供液 ${tSupplyC.toFixed(2)}°C − 房间露点 ${dp.toFixed(2)}°C = ${dewMarginK.toFixed(2)} K < 红线 ${dewMarginMinK} K（冷凝风险，热带安全红线：禁止出承诺）`);
    }
    if (c.supplySource.mode === "hx" && c.supplySource.fws.supplyC < dp) {
      warnings.add(`FWS 供水 ${c.supplySource.fws.supplyC}°C 低于房间露点 ${dp.toFixed(2)}°C（一次侧管路防凝露属设施域，请确认保温/封闭）`);
    }
  } else {
    warnings.add("房间条件未登记：露点红线未评估（计算书 A 节要求登记温度/RH）");
  }

  // ASHRAE W 级：hx→查 FWS 供水（等级语义=设施供水）；given→查 TCS 供水（无设施信息，从严）
  let wClassMaxSupplyC: number | null = null;
  let wClassCheckC: number | null = null;
  let wClassPass: boolean | null = null;
  if (c.wClass) {
    const max = WCLASS_MAX_SUPPLY_C[c.wClass as WClass];
    const check = c.supplySource.mode === "hx" ? c.supplySource.fws.supplyC : tSupplyC;
    if (c.supplySource.mode !== "hx") {
      warnings.add(`given 模式无设施信息：W 级按 TCS 供液 ${tSupplyC.toFixed(1)}°C 检查（从严——设施供水 ≤ TCS 供液）`); // n12
    }
    wClassMaxSupplyC = max;
    wClassCheckC = check;
    wClassPass = check <= max && check >= ASHRAE_MIN_SUPPLY_C;
    if (check > max) warnings.add(`供水温度 ${check.toFixed(1)}°C 超出 ${c.wClass} 上限 ${max}°C（ASHRAE W 级）`);
    if (check < ASHRAE_MIN_SUPPLY_C) warnings.add(`供水温度 ${check}°C 低于 ASHRAE 全级下限 ${ASHRAE_MIN_SUPPLY_C}°C（官方表脚注 a）`);
  }

  const finite =
    Number.isFinite(qTotalW) && Number.isFinite(qTotalFluidW) && Number.isFinite(tSupplyC) && Number.isFinite(dtRackK) && Number.isFinite(tReturnC)
    && nodes.every((n) => (n.tOutC == null || Number.isFinite(n.tOutC)) && (n.tCaseC == null || Number.isFinite(n.tCaseC)));
  if (!finite) warnings.add("输出含非有限值（NaN 守卫触发）");

  const maxFixedPointStep = steps.length ? Math.max(...steps) : null;
  if (maxFixedPointStep != null && maxFixedPointStep > FIXED_POINT_LIMIT) {
    untrusted = true;
    warnings.add(`定点末步差 ${maxFixedPointStep.toExponential(2)} > ${FIXED_POINT_LIMIT}（§6.1 P1 等价判据不满足）`);
  }

  return {
    schema: "p1-out/v0.1",
    converged: finite && !untrusted,
    warnings: [...warnings],
    inputInvalid: [],
    qTotalW,
    qTotalFluidW,
    tSupplyC,
    tReturnC,
    dtRackK,
    hx: hxOut,
    nodes,
    dewPointC: dewPoint,
    dewMarginK,
    dewMarginMinK,
    dewPass,
    wClassMaxSupplyC,
    wClassCheckC,
    wClassPass,
    maxFixedPointStep,
    versions: versions(input),
  };
}
