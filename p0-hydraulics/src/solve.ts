// P0 求解内核。纯函数：solve(input) → output，无状态、无 IO、无日志。
// 评审记录：docs/review-p0-v0.1.md 的 F1–F13 已于 v0.2 修复（2026-10-17）：
//   F1 变频泵域检查用查表自变量；F2/F17 dpKPa=耦合面压力 pStar（无 NaN）；
//   F3 inputInvalid 与数值失败分离（CLI 退 2）；F4 最终工作点钳位 → 不允许出数；
//   F5 入口曲线形态断言；F7 speedHz 边界；F9 警告文案；F10 支路 m 曲线拒绝；
//   F11 空曲线支路；F15 水基准告警；F16 数值范围；F18 标准重力。
// 收敛判据（契约 §6）：压力平衡残差 < 1e-8 且无 NaN 且工作点无曲线钳位。

import type { P0Input, P0Output, BranchOut, BranchSpec } from "./types.ts";
import { interpCurve, isStrictlyIncreasingX } from "./interp.ts";
import { pipeDpPa } from "./friction.ts";
import { pg25Props, PROP_SET_VERSION } from "./props.ts";
import { kpaToPa, paToKpa } from "./units.ts";

// 类型层收窄（noUncheckedIndexedAccess）：solve 只在 validateInput 通过后运行，
// 曲线/索引缺失属程序性错误而非工况输入——防御 throw，不参与输出语义。
function mustCurve(input: P0Input, id: string) {
  const cv = input.curves?.[id];
  if (cv === undefined) throw new Error(`内部错误：曲线 ${id} 未通过 validateInput`);
  return cv;
}
function mustPt(pts: readonly (readonly [number, number])[], i: number): readonly [number, number] {
  const p = pts[i];
  if (p === undefined) throw new Error(`内部错误：曲线点索引越界 ${i}/${pts.length}`);
  return p;
}
function mustLastPt(pts: readonly (readonly [number, number])[]): readonly [number, number] {
  const p = pts.at(-1);
  if (p === undefined) throw new Error("内部错误：曲线点为空");
  return p;
}

export const SOLVER_VERSION = "0.2.0";

const G = 9.80665;
const OUTER_ITERS = 80;
const INNER_ITERS = 60;
export const RESIDUAL_LIMIT = 1e-8;

// F3/F5/F7/F11/F16：入口校验——结构、曲线形态（二分法数学前提）、数值范围。
// 返回问题清单（空=合法）。CLI 以此区分 exit 2（输入无效）与 exit 1（数值失败）。
export function validateInput(input: P0Input): string[] {
  const errs: string[] = [];
  if (!input || typeof input !== "object") return ["input 不是对象"];
  if (input.schema !== "p0/v0.1") errs.push(`input.schema 不支持：${String(input.schema)}`);
  const c = input.case;
  if (!c || typeof c !== "object") return [...errs, "缺 case"];
  if (!Array.isArray(c.branches) || c.branches.length === 0) return [...errs, "branches 必须为非空数组"];
  if (typeof c.tSupplyC !== "number" || typeof c.tReturnC !== "number") errs.push("tSupplyC/tReturnC 必须为数值");
  if (typeof (c.filterDpKPa ?? 0) !== "number" || (c.filterDpKPa ?? 0) < 0) errs.push("filterDpKPa 必须为非负数值");

  const p = c.pump;
  if (!p || typeof p !== "object") {
    errs.push("缺 pump");
  } else {
    if (p.yIs !== "kPa" && p.yIs !== "m") errs.push(`pump.yIs 非法：${String(p.yIs)}`);
    if (p.ratedHz != null && !(p.ratedHz > 0)) errs.push("ratedHz 必须 > 0");
    if (p.speedHz != null && !(p.speedHz > 0)) errs.push("speedHz 必须 > 0"); // F7：0 Hz 静默按额定算
    if (p.speedHz != null && p.ratedHz == null) errs.push("给 speedHz 必须同时给 ratedHz"); // F7
    const pc = input.curves?.[p.curveId];
    if (!pc) errs.push(`缺泵曲线：${String(p.curveId)}`);
    else if (!Array.isArray(pc.points) || pc.points.length < 3) errs.push(`泵曲线 ${p.curveId} 点数 < 3`);
    else {
      if (!isStrictlyIncreasingX(pc.points)) errs.push(`泵曲线 ${p.curveId} x 非严格单调升`);
      let down = true;
      for (let i = 1; i < pc.points.length; i++) if (mustPt(pc.points, i)[1] >= mustPt(pc.points, i - 1)[1]) { down = false; break; }
      if (!down) errs.push(`泵曲线 ${p.curveId} y 非严格下降（二分括界前提）`);
    }
  }

  for (const b of c.branches) {
    if (!b || typeof b !== "object" || !b.id) { errs.push("支路缺 id"); continue; }
    if (!Array.isArray(b.curveIds)) errs.push(`支路 ${b.id}: curveIds 必须为数组`);
    else if (b.curveIds.length === 0 && !b.pipe) errs.push(`支路 ${b.id}: curveIds 为空且无 pipe`); // F11
    for (const id of b.curveIds ?? []) {
      const cv = input.curves?.[id];
      if (!cv) { errs.push(`支路 ${b.id} 缺曲线：${id}`); continue; }
      if (!Array.isArray(cv.points) || cv.points.length < 3) { errs.push(`曲线 ${id} 点数 < 3`); continue; }
      if (!isStrictlyIncreasingX(cv.points)) errs.push(`曲线 ${id} x 非严格单调升`);
      let up = true;
      for (let i = 1; i < cv.points.length; i++) if (mustPt(cv.points, i)[1] <= mustPt(cv.points, i - 1)[1]) { up = false; break; }
      if (!up) errs.push(`支路曲线 ${id} y 非严格单调升（二分法前提）`); // F5
      if (cv.y !== "kPa") errs.push(`支路曲线 ${id} y 必须为 kPa（got ${String(cv.y)}）`); // F10
    }
    if (b.pipe) {
      if (!(b.pipe.dMm > 0)) errs.push(`支路 ${b.id} pipe.dMm 必须 > 0`); // F16：dMm≤0 → 面积 0 → NaN
      if (!(b.pipe.lenM >= 0) || !(b.pipe.k >= 0)) errs.push(`支路 ${b.id} pipe.lenM/k 不能为负`);
    }
    if (b.minLpm != null && b.minLpm < 0) errs.push(`支路 ${b.id} minLpm 不能为负`);
  }
  if (c.branches.every((b) => b?.shutdown)) errs.push("全部支路关断，无解"); // 归入输入无效（V11）

  if (c.supplyPipe) {
    if (!(c.supplyPipe.dMm > 0)) errs.push("supplyPipe.dMm 必须 > 0");
    if (!(c.supplyPipe.lenM >= 0) || !(c.supplyPipe.k >= 0)) errs.push("supplyPipe.lenM/k 不能为负");
  }
  return errs;
}

function resolvePumpHz(input: P0Input): number | null {
  const p = input?.case?.pump;
  return p?.speedHz ?? p?.ratedHz ?? null; // F6：实际频率回显（含缺省解析）
}

interface Ctx {
  rho: number;
  rhoG: number;
  mu: number;
  pumpScale: number; // s/s_r；查表自变量 = q / pumpScale（F1 域检查用）
  pumpDpKPaAt(qLpm: number): number;
  branchDpPaAt(b: BranchSpec, qLpm: number): number;
}

function makeCtx(input: P0Input): Ctx {
  const c = input.case;
  const props = pg25Props(0.5 * (c.tSupplyC + c.tReturnC));
  const pumpCurve = mustCurve(input, c.pump.curveId);
  const rated = c.pump.ratedHz;
  const speed = c.pump.speedHz ?? rated;
  const pumpScale = speed && rated ? speed / rated : 1;

  const pumpDpKPaAt = (qLpm: number): number => {
    // 相似定律：H(q, s) = H_rated(q·s_r/s)·(s/s_r)²，查表自变量 = q/pumpScale
    let v = interpCurve(pumpCurve, qLpm / pumpScale).v;
    if (c.pump.yIs === "m") v = (v * props.rho * G) / 1000;
    return v * pumpScale * pumpScale;
  };

  const branchDpPaAt = (b: BranchSpec, qLpm: number): number => {
    let kpa = c.filterDpKPa ?? 0;
    for (const id of b.curveIds) kpa += interpCurve(mustCurve(input, id), qLpm).v;
    let pa = kpaToPa(kpa);
    if (b.pipe) pa += pipeDpPa(qLpm, b.pipe, props);
    return pa;
  };

  return { rho: props.rho, rhoG: props.rho * G, mu: props.mu, pumpScale, pumpDpKPaAt, branchDpPaAt };
}

function branchQLpm(ctx: Ctx, b: BranchSpec, dpPa: number, qMaxLpm: number): number {
  // Illinois（带权 false position）：保括界 + 超线性收敛，替代定长二分（评审后牛顿化，2026-10-17）
  let lo = 0;
  let hi = qMaxLpm;
  let flo = ctx.branchDpPaAt(b, lo) - dpPa;
  let fhi = ctx.branchDpPaAt(b, hi) - dpPa;
  if (flo >= 0) return 0; // 曲线起端压降已超过可用压差 → 零流量
  if (fhi <= 0) return hi; // 饱和（最终工作点越域由 domainWarnings 报告）
  let side = 0;
  for (let i = 0; i < 60; i++) {
    if (hi - lo <= 1e-13 * qMaxLpm) break;
    const m = (fhi * lo - flo * hi) / (fhi - flo);
    const x = Math.min(hi, Math.max(lo, m));
    const fx = ctx.branchDpPaAt(b, x) - dpPa;
    if (fx === 0) return x;
    if (fx > 0) {
      hi = x;
      fhi = fx;
      if (side === 1) flo *= 0.5; // 连续两次换 hi → lo 被保留两次 → 减半其留存值
      side = 1;
    } else {
      lo = x;
      flo = fx;
      if (side === -1) fhi *= 0.5;
      side = -1;
    }
  }
  // 二分兜底（评审 m1）：折点根等病态情形下 Illinois 仅线性收敛，用几何收敛保证精度
  let guard = 0;
  while (hi - lo > 1e-13 * qMaxLpm && guard++ < 200) {
    const mid = 0.5 * (lo + hi);
    if (ctx.branchDpPaAt(b, mid) < dpPa) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

function branchQMaxLpm(input: P0Input, b: BranchSpec): number {
  // 括界按支路各自算（blind-parallel-diff 的教训）；纯管路支路用泵域作数值上界（F11）
  let m = -Infinity;
  for (const id of b.curveIds) m = Math.max(m, mustLastPt(mustCurve(input, id).points)[0]);
  if (m === -Infinity) m = mustLastPt(mustCurve(input, input.case.pump.curveId).points)[0] * 1.2;
  return m * 1.5;
}

// 供诊断图/工作点分析：系统曲线 ΔP_sys(Q)（不含关断支路），kPa。
export function systemDpKPaAt(input: P0Input, qTotalLpm: number): number {
  const ctx = makeCtx(input);
  const active = input.case.branches.filter((b) => !b.shutdown);
  const qMaxOf = (b: BranchSpec) => branchQMaxLpm(input, b);
  let lo = 0;
  let hi = kpaToPa(ctx.pumpDpKPaAt(0)) * 1.2;
  for (let i = 0; i < OUTER_ITERS; i++) {
    const p = 0.5 * (lo + hi);
    let sum = 0;
    for (const b of active) sum += branchQLpm(ctx, b, p, qMaxOf(b));
    if (sum > qTotalLpm) lo = p;
    else hi = p;
  }
  let dpPa = 0.5 * (lo + hi);
  if (input.case.supplyPipe) dpPa += 2 * pipeDpPa(qTotalLpm, input.case.supplyPipe, { rho: ctx.rho, mu: ctx.mu });
  return paToKpa(dpPa);
}

export function pumpDpKPaAt(input: P0Input, qLpm: number): number {
  return makeCtx(input).pumpDpKPaAt(qLpm);
}

// F15：水基准曲线用于 PG25 工况 → 告警（政策 5 的精神：须修正后另立条目）
function basisWarnings(input: P0Input, warnings: Set<string>): void {
  for (const [id, cv] of Object.entries(input.curves)) {
    const basis = cv.basis ?? "";
    if (basis && /水|water/i.test(basis) && !/PG25|pg-?25/i.test(basis)) {
      warnings.add(`曲线 ${id} 为水基准（${basis}）用于 PG25 工况，未做黏度修正（政策 5）`);
    }
  }
}

export function solve(input: P0Input): P0Output {
  const invalid = validateInput(input);
  const warnings = new Set<string>(invalid);
  // N3（review-p0-v1.0-recheck）：fail 路径数值字段 null（非 NaN）——JSON 序列化诚实、
  // 类型 number|null 收窄，文本模式打印 "—" 而非 NaN。
  const fail = (): P0Output => ({
    schema: "p0-out/v0.1",
    converged: false,
    residual: null,
    qTotalLpm: null,
    pumpDpKPa: null,
    pumpHeadM: null,
    pumpHz: resolvePumpHz(input),
    branches: [],
    warnings: [...warnings],
    inputInvalid: invalid,
    versions: { solver: SOLVER_VERSION, props: PROP_SET_VERSION, input: input?.schema ?? "?", dataVersion: input?.dataVersion ?? null },
  });
  if (invalid.length) return fail();

  const c = input.case;
  const active = c.branches.filter((b) => !b.shutdown);
  if (active.length < c.branches.length) {
    warnings.add(`关断支路：${c.branches.filter((b) => b.shutdown).map((b) => b.id).join(", ")}（再分配情景）`);
  }
  basisWarnings(input, warnings);

  const ctx = makeCtx(input);
  const qMaxOf = (b: BranchSpec) => branchQMaxLpm(input, b);
  const pMaxPa = kpaToPa(ctx.pumpDpKPaAt(0)) * 1.2;

  // 外层对支路压降 P 解 g(P)=泵压升(Q(P))−(干管压降(Q)+P)=0，g 随 P 单调降 → Illinois
  const g = (p: number): number => {
    let qSum = 0;
    for (const b of active) qSum += branchQLpm(ctx, b, p, qMaxOf(b));
    let sysPa = p;
    if (c.supplyPipe) sysPa += 2 * pipeDpPa(qSum, c.supplyPipe, { rho: ctx.rho, mu: ctx.mu });
    return ctx.pumpDpKPaAt(qSum) * 1000 - sysPa;
  };
  let lo = 0;
  let hi = pMaxPa;
  let flo = g(lo);
  let fhi = g(hi);
  let pStar: number;
  if (flo <= 0) pStar = 0;
  else if (fhi >= 0) pStar = hi; // 括界上饱和（residual/域检查会暴露）
  else {
    let side = 0;
    for (let i = 0; i < OUTER_ITERS; i++) {
      if (hi - lo <= 1e-13 * pMaxPa) break;
      const m = (fhi * lo - flo * hi) / (fhi - flo);
      const x = Math.min(hi, Math.max(lo, m));
      const fx = g(x);
      if (fx === 0) { lo = x; hi = x; break; }
      if (fx > 0) {
        // g 随 P 单调【递减】：fx>0 → 根在 x 上方 → 收 lo（与内层递增函数相反！）
        lo = x;
        flo = fx;
        if (side === -1) fhi *= 0.5;
        side = -1;
      } else {
        hi = x;
        fhi = fx;
        if (side === 1) flo *= 0.5;
        side = 1;
      }
    }
    // 二分兜底（评审 m1）：g 含内层求解，折点根时同样需几何收敛保证
    let guard = 0;
    while (hi - lo > 1e-13 * pMaxPa && guard++ < 200) {
      const mid = 0.5 * (lo + hi);
      if (g(mid) > 0) lo = mid;
      else hi = mid;
    }
    pStar = 0.5 * (lo + hi);
  }

  let qTotal = 0;
  const branches: BranchOut[] = [];
  for (const b of c.branches) {
    if (b.shutdown) {
      branches.push({ id: b.id, qLpm: 0, dpKPa: paToKpa(pStar), sharePct: 0, minMarginLpm: b.minLpm != null ? -b.minLpm : null, shutdown: true });
      continue;
    }
    const qj = branchQLpm(ctx, b, pStar, qMaxOf(b));
    qTotal += qj;
    branches.push({
      id: b.id,
      qLpm: qj,
      dpKPa: paToKpa(pStar), // F2/F17：耦合面压力语义，域内解与支路压降构造性相等
      sharePct: NaN,
      minMarginLpm: b.minLpm != null ? qj - b.minLpm : null,
      shutdown: false,
    });
  }
  for (const bo of branches) if (!bo.shutdown) bo.sharePct = qTotal > 0 ? (bo.qLpm / qTotal) * 100 : 0; // F2：0/0 护栏

  const pumpDpKPa = ctx.pumpDpKPaAt(qTotal);
  let sysPa = pStar;
  if (c.supplyPipe) sysPa += 2 * pipeDpPa(qTotal, c.supplyPipe, { rho: ctx.rho, mu: ctx.mu });
  const residual = Math.abs(pumpDpKPa * 1000 - sysPa) / Math.max(pumpDpKPa * 1000, 1e-9);

  // F1/F4：域检查用查表自变量；最终工作点钳位 = 输出不可信 = 不允许出数。
  // 闭区间语义 + 收敛误差容差（评审 m1：x 域含端点，判越界前容让 1e-6·x_max，
  // 避免把恰好落在端点上的真根误判为越域）
  let clamped = 0;
  const pumpPts = mustCurve(input, c.pump.curveId).points;
  const pumpDomainMax = mustLastPt(pumpPts)[0];
  const pumpDomainMin = mustPt(pumpPts, 0)[0];
  const lookupQ = qTotal / ctx.pumpScale;
  if (lookupQ > pumpDomainMax + 1e-6 * Math.max(1, pumpDomainMax)) {
    clamped++;
    warnings.add(`泵曲线越界：查表流量 ${lookupQ.toFixed(1)} > 域 ${pumpDomainMax} L/min（变频 ${(ctx.pumpScale * 100).toFixed(0)}%，输出不可信）`);
  }
  if (lookupQ < pumpDomainMin - 1e-6 * Math.max(1, pumpDomainMin)) {
    warnings.add(`泵曲线下界越界：查表流量 ${lookupQ.toFixed(2)} < ${pumpDomainMin} L/min（已按起端值钳位，m3）`);
  }
  for (let i = 0; i < c.branches.length; i++) {
    const b = c.branches[i];
    const bo = branches[i];
    if (b === undefined || bo === undefined) continue; // 程序性防御：zip 不变式
    if (b.shutdown) continue;
    if (bo.qLpm < 1e-9) {
      warnings.add(`支路 ${b.id} 零流量（可用压差不足或低于曲线起端 ΔP，m3）`);
    }
    for (const id of b.curveIds) {
      const cv = mustCurve(input, id);
      const cMax = mustLastPt(cv.points)[0];
      if (bo.qLpm > cMax + 1e-6 * Math.max(1, cMax)) {
        clamped++;
        warnings.add(`支路 ${b.id} 曲线 ${id} 越界：${bo.qLpm.toFixed(1)} > ${cMax} L/min（输出不可信）`);
      }
      // N4（review-p0-v1.0-recheck）：下界平顶区诊断——工作点低于曲线起端 x 时钳位取起端值，
      // 失败可见但原因此前不可读；补 m3 同款下界告警（支路曲线 x 起端 >0 的退化配置）。
      const cMin = mustPt(cv.points, 0)[0];
      if (cMin > 0 && bo.qLpm > 1e-9 && bo.qLpm < cMin - 1e-6 * Math.max(1, cMin)) {
        warnings.add(`支路 ${b.id} 曲线 ${id} 下界平顶：q=${bo.qLpm.toFixed(2)} < 曲线起端 ${cMin} L/min（已按起端值钳位，m3）`);
      }
    }
  }

  const finite = Number.isFinite(qTotal) && Number.isFinite(pumpDpKPa) && Number.isFinite(pStar) && Number.isFinite(residual)
    && branches.every((bo) => Number.isFinite(bo.qLpm) && Number.isFinite(bo.dpKPa) && Number.isFinite(bo.sharePct));
  if (!finite) warnings.add("输出含非有限值（NaN 守卫触发）");
  for (const b of c.branches) { // F9：文案用保证值本身；关断支路跳过
    if (b.shutdown || b.minLpm == null) continue;
    const bo = branches.find((x) => x.id === b.id);
    if (bo !== undefined && bo.qLpm < b.minLpm) warnings.add(`支路 ${b.id} 流量 ${bo.qLpm.toFixed(1)} 低于 min 保证 ${b.minLpm} L/min`);
  }
  // 摩擦式评审（2026-10-20，docs/review-friction-sg.md）：支路 Re 落 2300–4000 过渡带时告警——
  // 该区两关联式差 20–25% 且实验散布同量级，压降不确定度 ±25% 级（如 19.1mm 支路 PG25 约 5 LPM 即落带）。
  for (const b of c.branches) {
    if (b.shutdown || !b.pipe) continue;
    const bo = branches.find((x) => x.id === b.id);
    if (bo === undefined || bo.qLpm <= 0) continue;
    const d = b.pipe.dMm / 1000;
    const v = bo.qLpm / 60000 / ((Math.PI / 4) * d * d);
    const re = (v * d * ctx.rho) / ctx.mu;
    if (re >= 2300 && re <= 4000) {
      warnings.add(`支路 ${b.id} Re=${re.toFixed(0)} 落过渡带 2300–4000（q=${bo.qLpm.toFixed(1)} L/min，d=${b.pipe.dMm}mm）：摩擦关联式不确定度 ±25% 级（Churchill 对拍见 docs/friction-churchill-compare.md），压降按保守区间解读`);
    }
  }
  if ((c.filterDpKPa ?? 0) > 0) warnings.add(`过滤器堵塞情景：+${c.filterDpKPa} kPa/支路`);

  return {
    schema: "p0-out/v0.1",
    converged: finite && residual < RESIDUAL_LIMIT && clamped === 0,
    residual,
    qTotalLpm: qTotal,
    pumpDpKPa,
    pumpHeadM: (pumpDpKPa * 1000) / ctx.rhoG,
    pumpHz: resolvePumpHz(input),
    branches,
    warnings: [...warnings],
    inputInvalid: [],
    versions: { solver: SOLVER_VERSION, props: PROP_SET_VERSION, input: input.schema, dataVersion: input.dataVersion ?? null },
  };
}
