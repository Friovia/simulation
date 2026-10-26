// P3 48V busbar 求解内核。纯函数：solve(input) → output。
// 物理全闭式（欧姆定律）：R = ρ(T)·L/A，ρ(T)=ρ20·(1+α(T−20))；V=I·R；P=I²·R。
// lenM 为单程（供+回内部 ×2）。converged = 数值有限（无迭代）；
// 压降超红线是合规发现（pass=false），不改 converged。
// v0.2（2026-10-20）：可选 ampacity 载流量校核（AWM/CDA/ORV3 表）+ trip 脱扣校核（NSX/NM8N 器件库
// + 保守选择性判据）；两者均"合规发现"语义，不改 converged。短路电流仍红灯（Isc 由调用侧给定）。

import { MATERIALS, MATERIALS_VERSION, type ConductorMaterial } from "./materials.ts";
import { AMPACITY_TABLES, AMPACITY_CONNECTOR_RATINGS, AMPACITY_VERSION, matchRow, envDerateK } from "./ampacity.ts";
import { TRIP_DEVICES, TRIP_VERSION, resolveTrip, instantaneousVerdict, selectivityConservative } from "./trip.ts";
import { SOURCE_SPECS, SOURCE_VERSION, sourceShortCircuit, type SourceSpecId } from "./source.ts";
import type { P3Input, P3Output, SegOut, AmpacityOut, TripOut, SourceOut } from "./types.ts";

export const SOLVER_VERSION = "0.3.0";

export function validateInput(input: P3Input): string[] {
  const errs: string[] = [];
  if (!input || typeof input !== "object") return ["input 不是对象"];
  if (input.schema !== "p3/v0.1" && input.schema !== "p3/v0.2" && input.schema !== "p3/v0.3") errs.push(`input.schema 不支持：${String(input.schema)}`);
  const c = input.case;
  if (!c || typeof c !== "object") return [...errs, "缺 case"];
  if (!Array.isArray(c.segs) || c.segs.length === 0) return [...errs, "segs 必须为非空数组"];
  if (!(c.currentA > 0)) errs.push("currentA 必须 > 0");
  if (!(c.nominalV > 0)) errs.push("nominalV 必须 > 0");
  if (!(c.maxDropPct > 0)) errs.push("maxDropPct 必须 > 0");
  if (typeof c.tC !== "number" || !Number.isFinite(c.tC)) errs.push("tC 必须为有限数值");
  if (c.tC < 0 || c.tC > 100) errs.push("tC 超出 ρ(T) 线性近似域 0–100°C");
  const ids = new Set<string>();
  for (const s of c.segs) {
    if (!s || typeof s !== "object" || !s.id) { errs.push("segs 项缺 id"); continue; }
    if (ids.has(s.id)) errs.push(`segs id 重复：${s.id}`);
    ids.add(s.id);
    if (!(String(s.material) in MATERIALS)) errs.push(`seg ${s.id} material 非法：${String(s.material)}`);
    if (!(s.areaMm2 > 0)) errs.push(`seg ${s.id} areaMm2 必须 > 0`);
    if (!(s.lenM > 0)) errs.push(`seg ${s.id} lenM 必须 > 0`);
  }
  return errs;
}

export function solve(input: P3Input): P3Output {
  const invalid = validateInput(input);
  const warnings = new Set<string>(invalid);
  const fail = (): P3Output => ({
    schema: "p3-out/v0.3",
    converged: false,
    warnings: [...warnings],
    inputInvalid: invalid,
    currentA: NaN, totalDropV: NaN, dropPct: NaN, endVoltageV: NaN, totalLossW: NaN, pass: null,
    segments: [],
    versions: { solver: SOLVER_VERSION, materials: MATERIALS_VERSION, input: input?.schema ?? "?" },
  });
  if (invalid.length) return fail();

  const c = input.case;
  const segments: SegOut[] = [];
  let totalDropV = 0;
  let totalLossW = 0;
  for (const s of c.segs) {
    const m = MATERIALS[s.material as ConductorMaterial];
    const rho = m.rho20OhmM * (1 + m.alphaPerK * (c.tC - 20));
    const rOneWay = (rho * s.lenM) / (s.areaMm2 * 1e-6);
    const rTotal = 2 * rOneWay; // 供+回
    const dropV = c.currentA * rTotal;
    const lossW = c.currentA * c.currentA * rTotal;
    totalDropV += dropV;
    totalLossW += lossW;
    segments.push({ id: s.id, rOneWayOhm: rOneWay, rTotalOhm: rTotal, dropV, lossW });
  }
  const dropPct = (totalDropV / c.nominalV) * 100;
  const pass = dropPct <= c.maxDropPct;
  if (!pass) warnings.add(`母排总压降 ${totalDropV.toFixed(3)} V = ${dropPct.toFixed(2)}% > 红线 ${c.maxDropPct}%（末端电压 ${c.nominalV - totalDropV} V）`);
  const finite = Number.isFinite(totalDropV) && Number.isFinite(totalLossW) && segments.every((s) => Number.isFinite(s.dropV));
  if (!finite) warnings.add("输出含非有限值（NaN 守卫触发）");

  // ---- v0.2 载流量校核（可选）----
  let ampacityOut: AmpacityOut | undefined;
  if (c.ampacity) {
    const a = c.ampacity;
    const table = AMPACITY_TABLES[a.tableId];
    const notes: string[] = [];
    const condition = a.condition ?? table.defaultCondition;
    if (!table.conditions.includes(condition)) {
      warnings.add(`ampacity.condition「${condition}」不在表 ${a.tableId} 条件集 {${table.conditions.join("|")}}，校核跳过`);
    } else {
      let ratedA: number | null = null;
      if (a.tableId === "orv3-connector") {
        ratedA = AMPACITY_CONNECTOR_RATINGS[condition] ?? null; // condition 已过条件集校验；undefined=登记缺口
        notes.push("ORv3 连接器触点额定（节点取电级），非铜排本体载流量");
      } else {
        const row = matchRow(table, a.widthMm, a.thicknessMm);
        if (row) ratedA = row.byCondition[condition] ?? null;
        else notes.push(`规格 ${a.widthMm}×${a.thicknessMm} 与表内行面积偏差 >5%（规格匹配制，不插值）`);
      }
      if (ratedA == null) {
        ampacityOut = {
          tableId: a.tableId, condition, ratedA: NaN, kEnv: NaN, ratedDeratedA: NaN,
          bars: a.bars ?? 1, perBarA: c.currentA / (a.bars ?? 1), totalRatedA: NaN,
          pass: null, notes,
        };
        warnings.add("ampacity：无匹配规格/条件，载流量校核未完成（pass=null）");
      } else {
        const ambient = a.ambientC ?? table.basis.ambientC;
        if (ambient > table.basis.maxC - 5) notes.push(`环境 ${ambient}°C 距 Tmax ${table.basis.maxC}°C 裕度 <5K，修正公式外推不可信`);
        const kEnv = ambient === table.basis.ambientC ? 1 : envDerateK(table.basis.maxC, table.basis.ambientC, ambient);
        const derated = ratedA * kEnv;
        const bars = a.bars ?? 1;
        const perBarA = c.currentA / bars;
        const ok = perBarA <= derated;
        if (!ok) warnings.add(`载流量：单条均流 ${perBarA.toFixed(0)} A > 修正后额定 ${derated.toFixed(0)} A（${a.tableId}/${condition}，${ambient}°C）`);
        if (bars > 1) notes.push("并联为理想均流假设（上界）；工程上多根并联需降容（经验 2条×0.85/3条×0.73，无权威统一源未硬化入模型）");
        ampacityOut = {
          tableId: a.tableId, condition, ratedA, kEnv, ratedDeratedA: derated,
          bars, perBarA, totalRatedA: derated * bars, pass: ok, notes,
        };
      }
    }
  }

  // ---- v0.3 源侧短路模型（可选）：droop 阻抗 + OCP/峰值窗口（数据见 source.ts）----
  let sourceOut: SourceOut | undefined;
  let effectiveIscA: number | undefined;
  if (c.source) {
    const spec = SOURCE_SPECS[c.source.specId as SourceSpecId];
    if (!spec) {
      warnings.add(`source.specId 未知：${String(c.source.specId)}（可用：orv3-hpr-psu | orv3-bbu-3kw）`);
    } else if (!(c.source.units > 0)) {
      warnings.add("source.units 必须 > 0");
    } else {
      const sc = sourceShortCircuit(spec, c.source.units);
      effectiveIscA = sc.iLimitedA; // 瞬时脱扣校核用峰值窗口上界（不是理想短路）
      if (sc.protectionWillAct) {
        warnings.add(`源侧短路：理想短路 ${sc.iScIdealA.toFixed(0)} A > OCP ${sc.iOcpA.toFixed(0)} A——源保护必动作（${spec.scpBehavior}，${spec.ocpMs}ms 窗）；瞬时脱扣校核采用峰值窗口电流 ${sc.iLimitedA.toFixed(0)} A（${spec.peakPct}%×${spec.ocpMs < 100 ? "≤" : ""}${spec.ocpMs}ms 口径）`);
      }
      sourceOut = {
        spec: spec.id, vendor: spec.vendor, units: c.source.units,
        rEffOhm: sc.rEffOhm, iScIdealA: sc.iScIdealA, iLimitedA: sc.iLimitedA,
        iOcpA: sc.iOcpA, protectionWillAct: sc.protectionWillAct,
        note: `${spec.description}；金属性短路假设（母排阻抗忽略）；${spec.note ?? ""}`,
      };
    }
  }

  // ---- v0.2 脱扣校核（可选）----
  let tripOut: TripOut | undefined;
  if (c.trip) {
    const t = c.trip;
    const loadA = t.loadA ?? c.currentA;
    const iscForTrip = c.source ? effectiveIscA : t.prospectiveIscA;
    if (!t.device) {
      warnings.add("trip：未给 device（本级保护），脱扣校核跳过");
    } else {
      const local = resolveTrip(t.device.deviceId, t.device.inA, t.device.irXIn, t.device.iiA);
      let upstreamBand: [number, number] | null = null;
      let upstreamId = "";
      if (t.upstream) {
        const up = resolveTrip(t.upstream.deviceId, t.upstream.inA, t.upstream.irXIn, t.upstream.iiA);
        if (!up.ok) { warnings.add(`trip.upstream 配置非法：${up.errs.join("；")}`); }
        else {
          upstreamBand = up.iiBand;
          const upDev = TRIP_DEVICES[t.upstream.deviceId];
          upstreamId = `${upDev?.vendor ?? t.upstream.deviceId} ${up.dev.family} In=${t.upstream.inA}`;
        }
      }
      if (!local.ok) {
        warnings.add(`trip.device 配置非法：${local.errs.join("；")}`);
      } else {
        const overloadOk = loadA <= local.irA;
        if (!overloadOk) warnings.add(`过载：负载 ${loadA} A > Ir ${local.irA} A（${t.device.deviceId} In=${t.device.inA}）`);
        const inst = typeof iscForTrip === "number"
          ? instantaneousVerdict(iscForTrip, local.iiBand)
          : null;
        if (inst === "no-trip" && typeof iscForTrip === "number") warnings.add(`瞬时：Isc ${iscForTrip.toFixed(0)} A < 脱扣带下限 ${local.iiBand[0].toFixed(0)} A——该故障电流下磁脱扣不动作${c.source ? "（源保护先行：见 source 输出）" : ""}`);
        if (inst === "uncertain" && typeof iscForTrip === "number") warnings.add(`瞬时：Isc ${iscForTrip.toFixed(0)} A 落在 ±20% 容差带 [${local.iiBand[0].toFixed(0)}, ${local.iiBand[1].toFixed(0)}] A 内，动作与否不确定`);
        let selectivity: TripOut["selectivity"];
        if (upstreamBand) {
          const s = selectivityConservative(upstreamBand, local.iiBand);
          if (!s.fullSelectivity) warnings.add(`选择性：下级带上限 ${local.iiBand[1].toFixed(0)} A > 上级带下限 ${upstreamBand[0].toFixed(0)} A，非全选择性（保守极限 ${s.conservativeLimitA.toFixed(0)} A）`);
          selectivity = {
            upstreamDevice: upstreamId,
            downstreamDevice: `${local.dev.vendor} ${local.dev.family} In=${t.device.inA}`,
            conservativeLimitA: s.conservativeLimitA,
            fullSelectivity: s.fullSelectivity,
          };
        }
        tripOut = {
          device: local.dev.id, family: local.dev.family, inA: t.device.inA,
          irA: local.irA, iiA: local.iiA, iiBand: local.iiBand,
          overloadOk, instantaneous: inst, selectivity,
        };
      }
    }
  }

  const versions: P3Output["versions"] = { solver: SOLVER_VERSION, materials: MATERIALS_VERSION, input: input.schema };
  if (ampacityOut) versions.ampacity = AMPACITY_VERSION;
  if (tripOut) versions.trip = TRIP_VERSION;
  if (sourceOut) versions.source = SOURCE_VERSION;

  return {
    schema: "p3-out/v0.3",
    converged: finite,
    warnings: [...warnings],
    inputInvalid: [],
    currentA: c.currentA,
    totalDropV,
    dropPct,
    endVoltageV: c.nominalV - totalDropV,
    totalLossW,
    pass,
    ampacity: ampacityOut,
    trip: tripOut,
    source: sourceOut,
    segments,
    versions,
  };
}
