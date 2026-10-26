import type { PipeSeg } from "./types.ts";
import type { FluidProps } from "./props.ts";
import { lpmToM3s } from "./units.ts";

const RE_LAMINAR = 2300;
const RE_TURBULENT = 4000;

function haaland(re: number, epsOverD: number): number {
  const inv = -1.8 * Math.log10(Math.pow(epsOverD / 3.7, 1.11) + 6.9 / re);
  return 1 / (inv * inv);
}

// 评审 M1（docs/review-p0-v2.0.md）：层流 64/Re 与 Haaland 在 Re=2300 处相差 ~78%，
// 硬切换使 dp(q) 出现跳变间隙 → 求解器可"收敛"到间隙内的工作点（假收敛）。
// 修复：2300–4000 过渡带内对两侧系数线性内插，保证 f(Re) 连续 → dp(q) 连续单调。
// 严格替代方案 Churchill 全域显式式，列升级项（同 F19）。
export function frictionFactor(re: number, epsOverD: number): number {
  if (re < RE_LAMINAR) return 64 / re;
  const ft = haaland(re, epsOverD);
  if (re >= RE_TURBULENT) return ft;
  const fl = 64 / RE_LAMINAR;
  const w = (re - RE_LAMINAR) / (RE_TURBULENT - RE_LAMINAR);
  return fl + w * (ft - fl);
}

// Darcy 压降：管摩擦 + K 系数局部损失。q 单位 L/min，返回 Pa。
export function pipeDpPa(qLpm: number, pipe: PipeSeg, props: FluidProps): number {
  if (qLpm <= 0) return 0;
  const d = pipe.dMm / 1000;
  const area = (Math.PI * d * d) / 4;
  const v = lpmToM3s(qLpm) / area;
  const re = (props.rho * v * d) / props.mu;
  const f = frictionFactor(re, (pipe.epsMm ?? 0.015) / 1000 / d);
  return (pipe.k + (f * pipe.lenM) / d) * props.rho * v * v * 0.5;
}

// Churchill (1977) 全域显式式（层流→湍流单一表达式，Chemical Engineering 84(24):91-92）：
//   f = 8·[(8/Re)^12 + (A+B)^(-3/2)]^(1/12)，
//   A = [2.457·ln(1/((7/Re)^0.9 + 0.27·ε/D))]^16，B = (37530/Re)^16
// 状态（2026-10-19）：对拍候选，未切换默认链（组合式已过两轮评审锁定）。
// 差异量化见 docs/friction-churchill-compare.md：层流/充分湍流两区与现行式一致
// （Re→小极限精确退化为 64/Re；Re=1e5 光滑管 0.01782 ≈ Colebrook 0.0180），
// 过渡带 2300–4000 内高于现行线性内插 20–25%（实验散布本就巨大，两式各有依据）。
// 切换属 major 变更：全部水力金向量需重算，留待评审决策。
export function churchillDarcy(re: number, epsOverD: number): number {
  const t1 = Math.pow(8 / re, 12);
  const a = Math.pow(2.457 * Math.log(1 / (Math.pow(7 / re, 0.9) + 0.27 * epsOverD)), 16);
  const b = Math.pow(37530 / re, 16);
  return 8 * Math.pow(t1 + Math.pow(a + b, -1.5), 1 / 12);
}
