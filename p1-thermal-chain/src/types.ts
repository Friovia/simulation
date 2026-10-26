// P1 热阻链求解器 I/O 类型 —— 与 docs/guarantee-interface.md §3 的承诺参数表对齐。
// 约束：erasable syntax only（Node 原生 strip-types 直跑，无构建步骤）。
//
// 物理口径（负契约沿 P0：die→冷板是服务器厂商域）：
//   - 承诺面仍是 UQD 耦合面：并联支路入口液温 = 机柜供液温度 T_s。
//   - 热链从「冷板 θ + 热点功率」开始：T_case = T_ref + θ·Q_hot，
//     T_ref = 支路入口液温（thetaRef=inlet，厂商默认口径）或支路平均液温（mean）。
//   - 换热器两种模式：slope=厂商单点锚点斜率（Q=S·ATD，仅 flowBasis 额定流量附近有据，
//     域外按登记带宽降信）；ua=显式 UA + 逆流 ε-NTU 闭式（选型软件/commissioning 数据）。
//   - 芯片稳态负荷进入液体的比例由 capturePct 参数化（默认 100=全进液体，保守侧），
//     温度场由换热能力闭式反推，无需求解器迭代平衡（唯一定点：ρ(T̄)·c_p(T̄) 弱非线性）。
// v0.1 范围缺口（README/guarantee-interface §3 登记，正式报价前逐项补）：
//   T_fluid_max/最小流量保证字段（冷板 redlight 数据缺）、室内排热模型（room 仅露点）、
//   capturePct 实测标定（现仅 OCP 70–75% 口径参考值）。

import type { CurveProvenance } from "../../p0-hydraulics/src/types.ts";
import type { WClass } from "./standards.ts";

// 热域曲线（schema.md 单位文法：hx 族 x=°C(ATD, OCP 口径=TCS供水−FWS供水), y=kW）
export interface HxCurve {
  x: "°C";
  y: "kW";
  points: [number, number][]; // 过原点直线（Q∝ATD 模型前提，入口校验），x 严格单调升，≥3 点
  flowBasis?: string; // 该斜率的流量条件（哪侧、多大流量）
  basis?: string;
  provenance?: CurveProvenance;
}

export interface HotSpot {
  qW: number; // 热点功率（最热 die/冷板路径），W
  thetaKPerW: number; // 冷板热阻（case-to-liquid），K/W
  thetaRef?: "inlet" | "mean"; // θ 参考液温：支路入口（默认）| 支路平均
  tCaseMaxC?: number; // 厂商 T_case 上限；缺省不评估裕度
  thetaFlowLpmRange?: [number, number]; // θ 数据有效流量域（库条目 notes 转写），越域=输出不可信
  thetaFlowSplitN?: number; // θ 按每板给时：支路流量/N = 每板流量（与域比对），默认 1
  note?: string; // 假设登记（θ 来源/口径，计算书 A 节）
}

export interface NodeLoad {
  id: string; // 必须能在 flows 中找到对应流量
  qW: number; // 节点总热负荷（芯片 TDP 合计），W
  capturePct?: number; // 液体捕获比 %：进入冷却液的比例（默认 100=全进液体，偏保守；
  // OCP ACS 口径冷板典型带走 70–75%，见 cold-plate.jsonc notes。热链用 qW×capturePct）
  hotSpot?: HotSpot;
}

export interface FlowEntry {
  id: string;
  qLpm: number; // P0 输出或 commissioning 遥测
}

export interface FwsSpec {
  supplyC: number; // 一次侧（设施水）供水温度（冰点/许用由甲方工质定，本侧不设硬域）
  flowLpm: number;
  cpJkgK: number; // 一次侧工质物性由甲方设施定（如水 4180）
  rhoKgM3: number;
  note: string; // 物性来源登记（必填：无源不入库政策同样适用于输入侧）
}

export type HxSpec =
  | {
      mode: "slope";
      curveId: string; // → curves 中 HxCurve；斜率 S = 末点 kW/K
      ratedTcsLpm: number; // flowBasis 的 TCS 侧额定流量（人工转写，转写责任在输入作者）
      note?: string;
    }
  | {
      mode: "ua";
      uaWK: number; // K·A（W/K），来源：选型软件/commissioning（红灯数据不得使用）
      arrangement: "counterflow"; // v0.1 仅逆流
      source?: string;
    };

export type SupplySource =
  | { mode: "given"; tSupplyC: number } // CDU 控制设定值（最常见设计口径）
  | { mode: "hx"; hx: HxSpec; fws: FwsSpec }; // 由一次侧条件 + 换热能力反推 TCS 供水

export interface RoomSpec {
  tAirC: number; // 房间空气温度 °C
  rhPct: number; // (0,100]
  minDewMarginK: number; // 露点红线最小裕度（热带场景建议 ≥1.5–2 K，memo §3.4）
  note?: string;
}

export interface P1Case {
  fluid: "pg25"; // 二次侧工质（物性表 pg25-dow-lc25-v1，P0 props.ts 单一来源）
  supplySource: SupplySource;
  flows: FlowEntry[];
  loads: NodeLoad[];
  room?: RoomSpec; // 缺省=露点红线未评估（告警）
  wClass?: WClass; // ASHRAE W 级对标（hx→查 FWS 供水；given→查 TCS 供水，从严）
}

export interface P1Input {
  schema: "p1/v0.1";
  case: P1Case;
  curves?: Record<string, HxCurve>; // slope 模式必填，随 input 归档可重放
  dataVersion?: string;
  meta?: Record<string, unknown>;
}

export interface NodeOut {
  id: string;
  qLpm: number;
  qW: number; // 节点总热负荷（输入原值）
  qFluidW: number; // 进入液体的有效负荷 = qW × capturePct/100
  tInC: number; // = T_s（UQD 耦合面，并联等温）
  tOutC: number | null; // 零流量带载 → null（过热无解）
  dTK: number | null;
  tCaseRefC: number | null; // θ 参考液温（inlet→tInC，mean→(tIn+tOut)/2）
  tCaseC: number | null; // 无 hotSpot → null
  tCaseMarginC: number | null; // tCaseMaxC − T_case；无上限 → null
}

export interface HxOut {
  mode: "slope" | "ua";
  qKw: number;
  tHotInC: number; // TCS 回液 = HX 热侧入口 = 机柜回液
  tHotOutC: number; // TCS 供液 = T_s
  tColdOutC: number; // FWS 回水
  slopeWKPerK: number | null; // slope 模式
  atdK: number | null; // slope 模式：T_s − FWS 供水（OCP 口径）
  ratedFlowDevPct: number | null; // slope 模式：|实际/额定−1|×100
  uaWK: number | null; // ua 模式
  eps: number | null;
  ntu: number | null;
  cMinWKPerK: number | null;
  cRatio: number | null;
}

export interface P1Output {
  schema: "p1-out/v0.1";
  converged: boolean; // 数值有限 + 定点收敛 + 无数据域越界（信任红旗）；合规发现不影响此位
  warnings: string[];
  inputInvalid: string[]; // 非空 = 输入无效（CLI 退 2）
  qTotalW: number; // Σ 芯片负荷（输入原值）
  qTotalFluidW: number; // Σ 进入液体的有效负荷（HX 热侧换热量）
  tSupplyC: number; // 机柜入口（UQD 耦合面）供液温度
  tReturnC: number;
  dtRackK: number;
  hx: HxOut | null;
  nodes: NodeOut[];
  dewPointC: number | null;
  dewMarginK: number | null; // T_s − 露点
  dewMarginMinK: number | null;
  dewPass: boolean | null;
  wClassMaxSupplyC: number | null;
  wClassCheckC: number | null; // 被检温度（hx→FWS 供水；given→TCS 供水）
  wClassPass: boolean | null;
  maxFixedPointStep: number | null; // 定点末步差最大值（审计面，§6.1 P1 等价判据 ≤1e-8；null=无定点）
  versions: { solver: string; props: string; input: string; dataVersion: string | null };
}
