// P2 瞬态骨架 I/O 类型（v0.2 范围：环路流体热容 + 可选金属热容 + 一阶阶跃响应闭式）。
// 负契约（红灯结算至 2026-10-20）：
//   - 服务器热惯性：结构已核（Erden 2014 期刊版 τ=C/(ṁc·ln(1/(1−ε)))，ASME 付费墙仅摘要；
//     实测锚点 11.1 kJ/K 在 thermo.ts 注释）——液冷版紧凑模型全文待索取（RG 被拒），模型外保留；
//   - 泵启停/切换：惰转部分解除（v0.3 pumpCoastdown——Grundfos 转子惯量表+T∝ω² 闭式）；
//     四象限 Suter 曲线源已定位（Innovyze InfoWorks TS 内置 8 组：Wylie&Streeter 3+Thorley 5，
//     89 点/组，https://help2.innovyze.com/infoworkswspro/Content/HTML/WS/a_four_quadrant_pump_curves.htm），
//     数值未提取（软件内数据），反转/倒流工况红灯保留；
//   - 控制回路：文献锚点已登记（Shi 2026《Buildings》16(9):1752 GB200 实测 FOPDT 泵路径 τ=13.4s、
//     阀 2.0s、冷塔 76.9s；Heydari 2025 CDU 失效 12s 稳定（摘要级））——开环模型保留；
//   - DX 周期（制冷机组数据无源）。
// v0.2 解除（2026-10-20 数据批次）：冷板/管路/机柜金属热容——thermo.ts 材料库 +
// 质量锚点（Wakefield 1.5kg 铜板 / nVent RCM42001 集管 11.3kg / ORv3 裸柜 145-172kg）；
// 未提供 metal 项时 τ 仍为流体-only 下界（basis 字段显式标注）。
// 物理模型：全环路流体充分混合集总节点 C·dT/dt = Q(t) − S_eff·(T − T_fws)，
// S_eff = P1 换热器有效增益（slope 模式即斜率；ua 模式 S_eff=εC_min/(1−εC_min/C_t)）。
// 负荷阶跃 Q0→Q1 → T(t) = T_inf + (T0 − T_inf)·e^(−t/τ)，τ = (C_fluid + C_metal)/S_eff（闭式）。
// 金属项假设：金属与流体同温集总（湿壁快速平衡假设——对冷板/管壁合理，对机柜空气侧钢架偏快）。

import type { ThermoMaterialId } from "./thermo.ts";

export interface LoopSeg {
  id: string;
  dMm: number; // 内径
  lenM: number; // 单程长度
  runs: 1 | 2; // 2=供+回双程
}

export interface MetalMass {
  id: string;
  material: ThermoMaterialId; // 材料库见 thermo.ts（含质量锚点登记）
  massKg: number; // 质量：取实测/规格锚点（thermo.ts 头注），无源勿填
}

export interface PumpCoastdown {
  shaftKw: number; // 额定轴功率（kW）
  rpm: number; // 额定转速（2 极 ~3480）
  inertiaSource: "grundfos-ms6000" | "custom"; // 惯量表来源
  customJKgm2?: number; // custom 时的 J（kg·m²，须带源登记）
}

export interface P2Case {
  fluid: "pg25";
  tMeanC: number; // 物性评估温度（ρ/cp 查表）
  pipes: LoopSeg[];
  extraVolumeL?: number; // 器件内容积（CDU/冷板/软管）；无源勿填，须配 note
  extraVolumeNote?: string;
  metal?: MetalMass[]; // v0.2 可选：金属热容项（冷板/集管/机柜钢架等）
  pumpCoastdown?: PumpCoastdown; // v0.3 可选：泵掉电惰转（转子惯量法，数据见 pump-inertia.ts）
  hxSlopeWKPerK: number; // 有效增益 W/K（P1 输出口径）
  fwsSupplyC: number;
  q0W: number; // 阶跃前液体负荷（稳态）
  q1W: number; // 阶跃后液体负荷
  t0C: number; // 初始环路温度（应 = fws + q0/S，不符则告警并按给定值积分）
  timesS: number[]; // 采样时刻（秒，升序不必）
}

export interface P2Input {
  schema: "p2/v0.1" | "p2/v0.2" | "p2/v0.3";
  case: P2Case;
  meta?: Record<string, unknown>;
}

export interface P2Output {
  schema: "p2-out/v0.2";
  converged: boolean; // 数值有限 + 输入合法
  warnings: string[];
  inputInvalid: string[];
  volumeM3: number;
  massKg: number;
  capWJK: number; // 流体热容 C = Σm·cp
  metalCapWJK: number; // v0.2：金属热容 Σm·cp（未提供 metal 时 0）
  capTotalWJK: number; // C_fluid + C_metal
  basis: "fluid-only" | "fluid+metal"; // τ 的口径（下界 vs 含金属）
  tauS: number; // capTotalWJK/S_eff（fluid-only 时即下界）
  tauFluidOnlyS: number; // 流体-only τ（对照保留）
  tInfC: number; // 阶跃后终温 = fws + q1/S_eff
  samples: { tS: number; TC: number }[];
  pumpCoastdownOut?: {
    jKgm2: number;
    tauCoastS: number; // ω(t)=ω0/(1+t/τ)（水力转矩 ∝ω²）；t=τ 时半速
    inertiaClamped: boolean; // 轴功率超出表域（端点钳位）
    note: string;
  };
  versions: { solver: string; props: string; thermo?: string; pumpInertia?: string; input: string };
}
