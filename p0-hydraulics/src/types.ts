// P0 求解器 I/O 类型 —— 与 docs/guarantee-interface.md 的承诺参数表对齐。
// 约束：erasable syntax only（Node 原生 strip-types 直跑，无构建步骤）。

export type CurveY = "kPa" | "m";

export interface Curve {
  x: "L/min";
  y: CurveY; // kPa=压升/压降；m=扬程（泵）
  points: [number, number][]; // x 严格单调升，≥3 点
  basis?: string; // 工质基准，如 "PG25 @ 25°C"（政策第 5 条）
  provenance?: CurveProvenance; // 计算书 C 节数据登记来源（自包含归档）
}

export interface CurveProvenance {
  url: string;
  type?: string; // datasheet | literature | ocp-spec | measured
  retrieved?: string;
  uncertainty?: string;
}

export interface PipeSeg {
  dMm: number; // 内径 mm
  lenM: number; // 单程长度 m
  k: number; // 附加当量损失系数（弯头/三通/阀门）
  epsMm?: number; // 绝对粗糙度 mm，默认 0.015
}

export interface BranchSpec {
  id: string;
  curveIds: string[]; // 串联器件曲线（manifold 支路段 + UQD + 冷板 …）
  pipe?: PipeSeg; // 支路管路摩擦（纯曲线支路可省）
  minLpm?: number; // min 保证流量 → 输出 minMarginLpm（承诺参数 branch.q[j]）
  shutdown?: boolean; // 单支路关断再分配场景（承诺参数 margin.single_off）
}

export interface PumpSpec {
  curveId: string;
  yIs: CurveY;
  ratedHz?: number; // 变频相似定律基准
  speedHz?: number; // 实际频率，缺省 = 额定（不缩放）
}

export interface CaseSpec {
  tSupplyC: number;
  tReturnC: number;
  pump: PumpSpec;
  supplyPipe?: PipeSeg; // 供+回干管（单程参数，内部 ×2）
  branches: BranchSpec[];
  filterDpKPa?: number; // 各支路统一附加压降（过滤器堵塞漂移情景）
}

export interface P0Input {
  schema: "p0/v0.1";
  case: CaseSpec;
  curves: Record<string, Curve>; // 曲线随 input 归档：自包含、可一字不差重放
  dataVersion?: string; // 曲线库版本（归档三元组之一，F6）
  meta?: Record<string, unknown>; // 项目登记信息（A 节透传，不影响求解）
}

export interface BranchOut {
  id: string;
  qLpm: number;
  dpKPa: number;
  sharePct: number;
  minMarginLpm: number | null;
  shutdown: boolean;
}

export interface P0Output {
  schema: "p0-out/v0.1";
  converged: boolean; // 残差<1e-8 且无 NaN 且工作点无钳位（契约 §6，F4）
  residual: number | null; // 泵-系统压力平衡相对残差；质量守恒 Σq=Q 构造性成立（F8 措辞）。null=输入无效路径（N3：JSON 序列化诚实，不用 NaN）
  qTotalLpm: number | null;
  pumpDpKPa: number | null;
  pumpHeadM: number | null;
  pumpHz: number | null; // 实际运行频率回显（含缺省解析，F6）
  branches: BranchOut[];
  warnings: string[];
  inputInvalid: string[]; // 非空 = 输入无效（CLI 退 2，F3）；空 = 进入数值求解
  versions: { solver: string; props: string; input: string; dataVersion: string | null };
}
