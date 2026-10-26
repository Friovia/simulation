// P3 48V 电气求解器 I/O 类型（v0.2 范围：busbar 直流压降/损耗 + 载流量校核 + 脱扣校核）。
// 约束：erasable syntax only（Node 原生 strip-types 直跑）。
// 负契约（红灯结算至 2026-10-20）：
//   - 短路电流：解除（v0.3 source 模块——ORv3 HPR PSU/BBU droop 阻抗+OCP/峰值限流窗口，
//     AE 手册+OCP 规格全文带源；口径澄清：25kA 是 AC 侧上游故障水平，DC 侧按限流模型）；
//   - <100ms I²t 能量选择性：仍红灯（厂商穿透 I²t 曲线无公开数据；BEAMA 峰值穿透法已做 RMS 保守简化）；
//   - 温升瞬态（I²R 自热时间过程；载流量校核是稳态查表口径）。
// v0.2 解除（2026-10-20 数据批次）：
//   - 载流量/温升：AWM DC 表 + CDA 交叉表 + ORV3 连接器锚点入库（ampacity.ts）；
//   - 脱扣协调：NSX DC / NM8N / K-MCB 磁脱扣带 + 保守选择性判据入库（trip.ts）。

import type { ConductorMaterial } from "./materials.ts";
import type { AmpTableId } from "./ampacity.ts";
import type { TripDeviceId } from "./trip.ts";
import type { SourceSpecId } from "./source.ts";

export interface BusSeg {
  id: string;
  material: ConductorMaterial; // v0.1 仅 copper-iacs
  areaMm2: number; // 截面积（如 80×10 mm 铜排 = 800）
  lenM: number; // 单程长度 m（供+回内部 ×2）
}

export interface AmpacitySpec {
  tableId: AmpTableId;
  widthMm: number; // 铜排宽（orv3-connector 表忽略，填 0 即可）
  thicknessMm: number; // 铜排厚（orv3-connector 表忽略）
  condition?: string; // awm: still|free（默认 still）；cda: rise30|rise50|rise65（默认 rise50）；orv3: still|lfm300
  bars?: number; // 并联条数（默认 1；理想均流假设，见输出 notes）
  ambientC?: number; // 实际环境温度（默认表基准 40°C；偏离时按 √((Tmax−T)/(Tmax−T_base)) 修正）
}

export interface TripRef {
  deviceId: TripDeviceId;
  inA: number; // 该断路器框架额定电流档
  irXIn?: number; // 过载整定（×In，缺省取器件默认档）
  iiA?: number; // 磁脱扣设定值 A（仅 adjust-abs 器件必填）
}

export interface TripSpec {
  loadA?: number; // 过载校核电流（默认 case.currentA）
  prospectiveIscA?: number; // 预期短路电流 rms（缺省则跳过瞬时校核）
  device?: TripRef; // 本级保护
  upstream?: TripRef; // 上级（与 device 同时给出时做选择性校核）
}

export interface SourceSpecInput {
  specId: SourceSpecId; // "orv3-hpr-psu" | "orv3-bbu-3kw"（库见 source.ts）
  units: number; // 并联数（PSU/BBU 台数）
}

export interface P3Case {
  nominalV: number; // 母线标称电压（48 等）
  currentA: number; // 该母排承载电流（直流）
  tC: number; // 导体温度（ρ(T) 修正；温升本身是红灯，此为评估温度）
  maxDropPct: number; // 压降红线（% of nominal）
  segs: BusSeg[]; // 串联段（逐段压降累积）
  ampacity?: AmpacitySpec; // v0.2 可选：载流量校核
  trip?: TripSpec; // v0.2 可选：脱扣校核
  source?: SourceSpecInput; // v0.3 可选：源侧短路模型（droop 阻抗+OCP 窗口）——给定后短路电流自算，覆盖 trip.prospectiveIscA
}

export interface P3Input {
  schema: "p3/v0.1" | "p3/v0.2" | "p3/v0.3";
  case: P3Case;
  meta?: Record<string, unknown>;
}

export interface SegOut {
  id: string;
  rOneWayOhm: number;
  rTotalOhm: number; // ×2（供+回）
  dropV: number;
  lossW: number; // I²·R_total（供+回合计）
}

export interface AmpacityOut {
  tableId: AmpTableId;
  condition: string;
  ratedA: number; // 表值（基准环境）
  kEnv: number; // 环境修正系数（1 = 未修正）
  ratedDeratedA: number; // ratedA × kEnv（单条）
  bars: number;
  perBarA: number; // currentA / bars（理想均流）
  totalRatedA: number; // ratedDeratedA × bars（理想均流上界）
  pass: boolean | null; // perBarA ≤ ratedDeratedA（null = 无匹配规格）
  notes: string[];
}

export interface TripOut {
  device: string;
  family: string;
  inA: number;
  irA: number;
  iiA: number;
  iiBand: [number, number]; // ±20% 容差带
  overloadOk: boolean | null; // loadA ≤ irA
  instantaneous: "certain-trip" | "no-trip" | "uncertain" | null; // Isc 对带三态
  selectivity?: {
    upstreamDevice: string;
    downstreamDevice: string;
    conservativeLimitA: number; // 部分选择性保守下界（= 上级带下限，未计下级限流）
    fullSelectivity: boolean;
  };
}

export interface SourceOut {
  spec: string;
  vendor: string;
  units: number;
  rEffOhm: number; // 并联 droop 等效源阻抗
  iScIdealA: number; // 金属性短路理想上界 V_set/R_eff
  iLimitedA: number; // 峰值窗口内实际可达电流上界（瞬时脱扣校核用这个）
  iOcpA: number; // OCP 动作电流
  protectionWillAct: boolean; // 理想短路 > OCP → 保护必动作
  note: string;
}

export interface P3Output {
  schema: "p3-out/v0.3";
  converged: boolean; // 数值有限 + 输入合法（电气无迭代；红灯项不参与计算）
  warnings: string[];
  inputInvalid: string[];
  currentA: number;
  totalDropV: number;
  dropPct: number;
  endVoltageV: number;
  totalLossW: number;
  pass: boolean | null; // dropPct ≤ maxDropPct（合规发现，不影响 converged）
  ampacity?: AmpacityOut; // v0.2（ampacity 指定且可解析时）
  trip?: TripOut; // v0.2（trip 指定且可解析时）
  source?: SourceOut; // v0.3（source 指定且可解析时）
  segments: SegOut[];
  versions: { solver: string; materials: string; ampacity?: string; trip?: string; source?: string; input: string };
}
