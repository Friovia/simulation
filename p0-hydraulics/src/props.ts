// PG25（25 vol% 丙二醇）物性 —— DOWFROST LC 25 官方工程指南 Table 2 带源插值表。
// 来源：data/fluids-and-standards.md §1.2 主表 A（Dow 表单 176-01641-01，原生数字 PDF，
// 5 °C 步进；产品页确认直连芯片冷却用途）。
// 数据集选择（memo §1.4）：LC 25 为默认——黏度较三源共识簇高 ~11%，ΔP 侧偏保守（泵
// 选型安全侧）；共识簇留作 ±11% 敏感性项。假设登记表必须写明此分歧。
// 表域 0–60 °C，域外钳位取端点值（LC 产品许用 −10…90 °C，表外区域无据不外推）。
export const PROP_SET_VERSION = "pg25-dow-lc25-v1";

export interface FluidProps {
  rho: number; // kg/m³
  mu: number; // Pa·s
}

// T(°C), ρ(kg/m³), c_p(kJ/(kg·K)), k(W/(m·K)), μ(mPa·s) —— c_p/k 现为 P1 预留
const LC25: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [0, 1040.5, 3.82, 0.432, 6.32],
  [5, 1038.8, 3.83, 0.438, 5.13],
  [10, 1036.9, 3.84, 0.444, 4.17],
  [15, 1034.9, 3.85, 0.450, 3.42],
  [20, 1032.7, 3.87, 0.456, 2.84],
  [25, 1030.3, 3.88, 0.462, 2.39],
  [30, 1027.8, 3.89, 0.467, 2.05],
  [35, 1025.2, 3.90, 0.472, 1.78],
  [40, 1022.5, 3.92, 0.476, 1.58],
  [45, 1019.7, 3.93, 0.481, 1.41],
  [50, 1016.8, 3.94, 0.485, 1.27],
  [55, 1013.7, 3.95, 0.488, 1.15],
  [60, 1010.6, 3.97, 0.492, 1.04],
];

function col(tC: number, i: 1 | 2 | 4): number {
  const t = Math.min(60, Math.max(0, tC));
  for (let r = 1; r < LC25.length; r++) {
    const row = LC25[r];
    const prev = LC25[r - 1];
    if (row !== undefined && prev !== undefined && t <= row[0]) {
      const t0 = prev[0];
      const t1 = row[0];
      const v0 = prev[i];
      const v1 = row[i];
      return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
  }
  const last = LC25[LC25.length - 1];
  if (last === undefined) throw new Error("props: LC25 表为空（程序性错误）");
  return last[i];
}

export function pg25Props(tMeanC: number): FluidProps {
  return { rho: col(tMeanC, 1), mu: col(tMeanC, 4) * 1e-3 };
}

// P1 热链用：比热（J/(kg·K)，表值 kJ ×1000）与表域常量（域外钳位取端点，调用方告警）
export function pg25CpJkgK(tC: number): number {
  return col(tC, 2) * 1000;
}

export const PROPS_DOMAIN_C: readonly [number, number] = [0, 60]; // Dow LC 25 表域

// LC 产品许用 −10…90 °C、常压（760 mmHg）沸点 101.4 °C —— fluids-and-standards.md §1.1 [S1]
export const PG25_ALLOWABLE_C: readonly [number, number] = [-10, 90];
export const PG25_BOILING_C = 101.4;
