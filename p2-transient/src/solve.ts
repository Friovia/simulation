// P2 瞬态骨架求解内核。纯函数；全闭式（几何容积 → PG25 热容 [+ 可选金属热容] → 一阶阶跃解析解）。
// v0.2（2026-10-20）：可选 metal 项（thermo.ts 材料库）——τ 口径 fluid+metal（basis 字段标注）；
// 未提供时 τ 仍为流体-only 下界。金属-流体同温集总假设：对冷板/湿壁合理，对空气侧钢架偏快（warning 注明）。
// 服务器热惯性仍红灯（非同温节点，模型外；文献锚点 11.1 kJ/K 见 thermo.ts 注释）。

import { pg25Props, pg25CpJkgK, PROP_SET_VERSION } from "../../p0-hydraulics/src/props.ts";
import { THERMO_MATERIALS, THERMO_VERSION, type ThermoMaterialId } from "./thermo.ts";
import { motorInertiaKgm2, PUMP_INERTIA_VERSION } from "./pump-inertia.ts";
import type { P2Input, P2Output, LoopSeg } from "./types.ts";

export const SOLVER_VERSION = "0.3.0";

export function validateInput(input: P2Input): string[] {
  const errs: string[] = [];
  if (!input || typeof input !== "object") return ["input 不是对象"];
  if (input.schema !== "p2/v0.1" && input.schema !== "p2/v0.2" && input.schema !== "p2/v0.3") errs.push(`input.schema 不支持：${String(input.schema)}`);
  const c = input.case;
  if (!c || typeof c !== "object") return [...errs, "缺 case"];
  if (c.fluid !== "pg25") errs.push(`case.fluid 仅支持 pg25（got ${String(c.fluid)}）`);
  if (!Array.isArray(c.pipes) || c.pipes.length === 0) errs.push("pipes 必须为非空数组");
  if (!(c.hxSlopeWKPerK > 0)) errs.push("hxSlopeWKPerK 必须 > 0");
  if (!(c.q0W >= 0) || !(c.q1W >= 0)) errs.push("q0W/q1W 必须为非负数值");
  if (typeof c.t0C !== "number" || !Number.isFinite(c.t0C)) errs.push("t0C 必须为有限数值");
  if (typeof c.fwsSupplyC !== "number" || !Number.isFinite(c.fwsSupplyC)) errs.push("fwsSupplyC 必须为有限数值");
  if (typeof c.tMeanC !== "number" || !Number.isFinite(c.tMeanC)) errs.push("tMeanC 必须为有限数值");
  if (!Array.isArray(c.timesS) || c.timesS.length === 0) errs.push("timesS 必须为非空数组");
  if (Array.isArray(c.timesS) && c.timesS.some((t) => !(t >= 0))) errs.push("timesS 各项必须 ≥ 0");
  if (c.extraVolumeL != null) {
    if (!(c.extraVolumeL >= 0)) errs.push("extraVolumeL 必须为非负数值");
    if (typeof c.extraVolumeNote !== "string" || !c.extraVolumeNote.trim()) errs.push("extraVolumeL 必须配 extraVolumeNote（器件内容积来源登记，无源不入库）");
  }
  if (c.metal != null && input.schema === "p2/v0.1") errs.push("metal 项需 schema p2/v0.2");
  const ids = new Set<string>();
  for (const p of Array.isArray(c.pipes) ? c.pipes : [] as LoopSeg[]) {
    if (!p || typeof p !== "object" || !p.id) { errs.push("pipes 项缺 id"); continue; }
    if (ids.has(p.id)) errs.push(`pipes id 重复：${p.id}`);
    ids.add(p.id);
    if (!(p.dMm > 0)) errs.push(`pipe ${p.id} dMm 必须 > 0`);
    if (!(p.lenM > 0)) errs.push(`pipe ${p.id} lenM 必须 > 0`);
    if (p.runs !== 1 && p.runs !== 2) errs.push(`pipe ${p.id} runs 必须为 1 或 2`);
  }
  if (c.pumpCoastdown != null && input.schema !== "p2/v0.3") errs.push("pumpCoastdown 项需 schema p2/v0.3");
  const pc = c.pumpCoastdown;
  if (pc) {
    if (!(pc.shaftKw > 0)) errs.push("pumpCoastdown.shaftKw 必须 > 0");
    if (!(pc.rpm > 0)) errs.push("pumpCoastdown.rpm 必须 > 0");
    if (pc.inertiaSource === "custom" && !((pc.customJKgm2 ?? 0) > 0)) errs.push("pumpCoastdown custom 惯量必须 > 0（无源勿填）");
    if (pc.inertiaSource === "grundfos-ms6000" && (pc.shaftKw < 5.5 || pc.shaftKw > 30)) errs.push("grundfos-ms6000 表域 5.5–30 kW（域外用 custom+带源 J）");
  }
  const mids = new Set<string>();
  for (const m of Array.isArray(c.metal) ? c.metal : []) {
    if (!m || typeof m !== "object" || !m.id) { errs.push("metal 项缺 id"); continue; }
    if (mids.has(m.id)) errs.push(`metal id 重复：${m.id}`);
    mids.add(m.id);
    if (!(String(m.material) in THERMO_MATERIALS)) errs.push(`metal ${m.id} material 非法：${String(m.material)}`);
    if (!(m.massKg > 0)) errs.push(`metal ${m.id} massKg 必须 > 0（质量取 thermo.ts 登记锚点，无源勿填）`);
  }
  return errs;
}

export function solve(input: P2Input): P2Output {
  const invalid = validateInput(input);
  const warnings = new Set<string>(invalid);
  const fail = (): P2Output => ({
    schema: "p2-out/v0.2",
    converged: false,
    warnings: [...warnings],
    inputInvalid: invalid,
    volumeM3: NaN, massKg: NaN, capWJK: NaN, metalCapWJK: NaN, capTotalWJK: NaN,
    basis: "fluid-only", tauS: NaN, tauFluidOnlyS: NaN, tInfC: NaN, samples: [], pumpCoastdownOut: undefined,
    versions: { solver: SOLVER_VERSION, props: PROP_SET_VERSION, input: input?.schema ?? "?" },
  });
  if (invalid.length) return fail();

  const c = input.case;
  const pc = c.pumpCoastdown;

  const props = pg25Props(c.tMeanC);
  const cp = pg25CpJkgK(c.tMeanC);
  let volumeM3 = 0;
  for (const p of c.pipes) {
    volumeM3 += (Math.PI * Math.pow(p.dMm / 1000, 2)) / 4 * p.lenM * p.runs;
  }
  if (c.extraVolumeL != null) volumeM3 += c.extraVolumeL / 1000;
  const massKg = volumeM3 * props.rho;
  const capWJK = massKg * cp;

  let metalCapWJK = 0;
  const metalArr = Array.isArray(c.metal) ? c.metal : [];
  const hasMetal = metalArr.length > 0;
  if (hasMetal) {
    for (const m of metalArr) {
      metalCapWJK += m.massKg * THERMO_MATERIALS[m.material as ThermoMaterialId].cpJkgK;
    }
    warnings.add("金属项为同温集总假设：冷板/湿壁合理；空气侧钢架（机柜框架）实际偏快（热阻隔离），τ 上偏乐观");
  } else {
    warnings.add("时间常数为下界（fluid-only，未提供 metal 项）：冷板/管壁/机柜金属热容未计入——实际响应显著慢于本模型");
  }
  warnings.add("服务器热惯性在模型外（非同温节点，红灯；文献实测典型 2U 服务器 11.1 kJ/K，见 thermo.ts 注释）");
  const capTotalWJK = capWJK + metalCapWJK;
  const basis = hasMetal ? "fluid+metal" : "fluid-only";

  const tauS = capTotalWJK / c.hxSlopeWKPerK;
  const tauFluidOnlyS = capWJK / c.hxSlopeWKPerK;
  const tInfC = c.fwsSupplyC + c.q1W / c.hxSlopeWKPerK;
  const ss0 = c.fwsSupplyC + c.q0W / c.hxSlopeWKPerK;
  if (Math.abs(c.t0C - ss0) > 0.05) {
    warnings.add(`初始温度 ${c.t0C}°C 与 q0=${c.q0W} W 稳态 ${ss0.toFixed(2)}°C 不符（按给定初温积分）`);
  }

  const samples = [...c.timesS].sort((a, b) => a - b).map((t) => ({
    tS: t,
    TC: tInfC + (c.t0C - tInfC) * Math.exp(-t / tauS),
  }));

  const finite = Number.isFinite(volumeM3) && Number.isFinite(capWJK) && Number.isFinite(tauS) && Number.isFinite(tInfC)
    && samples.every((s) => Number.isFinite(s.TC));
  if (!finite) warnings.add("输出含非有限值（NaN 守卫触发）");

  // ---- v0.3 泵掉电惰转（可选）：ω(t)=ω0/(1+t/τ)，τ=J·ω0/T0（T∝ω² 近似）----
  let pumpCoastdownOut: P2Output["pumpCoastdownOut"];
  if (pc) {
    const j = pc.inertiaSource === "custom"
      ? { jKgm2: pc.customJKgm2 ?? 0, clamped: false }
      : motorInertiaKgm2(pc.shaftKw);
    const w0 = (2 * Math.PI * pc.rpm) / 60;
    const t0 = (pc.shaftKw * 1000) / w0;
    const tauCoastS = (j.jKgm2 * w0) / t0;
    warnings.add(`泵惰转：τ_coast=${tauCoastS.toFixed(4)} s（转子半速时间； Grundfos 表 J 未含叶轮 ≈×1.10-1.15，实际略慢）——远快于环路热时间常数 ${tauS.toFixed(2)} s：断电后压头近乎立即消失，流量维持依赖 BBU 切换（ORv3 BBU 2ms 激活）而非转子惯性`);
    pumpCoastdownOut = {
      jKgm2: j.jKgm2, tauCoastS, inertiaClamped: j.clamped,
      note: `${pc.inertiaSource === "custom" ? "自定义 J（调用侧带源）" : "Grundfos MS6000 2 极电机转子表"}；T∝ω² 近似（WANDA §6.13 口径）`,
    };
  }

  const versions: P2Output["versions"] = { solver: SOLVER_VERSION, props: PROP_SET_VERSION, input: input.schema };
  if (hasMetal) versions.thermo = THERMO_VERSION;
  if (pc) versions.pumpInertia = PUMP_INERTIA_VERSION;

  return {
    schema: "p2-out/v0.2",
    converged: finite,
    warnings: [...warnings],
    inputInvalid: [],
    volumeM3,
    massKg,
    capWJK,
    metalCapWJK,
    capTotalWJK,
    basis,
    tauS,
    tauFluidOnlyS,
    tInfC,
    samples,
    pumpCoastdownOut,
    versions,
  };
}
