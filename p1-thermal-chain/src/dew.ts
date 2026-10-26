// 湿空气露点（Magnus 型）—— data/fluids-and-standards.md §3。
// 主式 Alduchov–Eskridge 1996（A=6.1094 hPa, B=17.625, C=243.04 °C，项目温域内偏差 <0.4%）；
// Sonntag 1990 / WMO CIMO 2008 系数（17.62/243.12）作交叉核验：项目温域 15–45 °C 内两式
// 露点差 <0.1 K，超过 0.15 K 视为实现异常（solve.ts 断言）。
const B_AE = 17.625;
const C_AE = 243.04;
const B_SONNTAG = 17.62;
const C_SONNTAG = 243.12;

function dewPointWith(b: number, c: number, tAirC: number, rhPct: number): number {
  const g = Math.log(rhPct / 100) + (b * tAirC) / (tAirC + c);
  return (c * g) / (b - g);
}

export function dewPointC(tAirC: number, rhPct: number): number {
  return dewPointWith(B_AE, C_AE, tAirC, rhPct);
}

// A-E 拟合域（memo G8：原文拟合域 −40…+50 °C，系数经二级源交叉确认）
export const AE_DOMAIN_C: readonly [number, number] = [-40, 50];

// 两套系数的露点差（K），供交叉断言
export function dewPointCrossDiffK(tAirC: number, rhPct: number): number {
  return Math.abs(dewPointWith(B_AE, C_AE, tAirC, rhPct) - dewPointWith(B_SONNTAG, C_SONNTAG, tAirC, rhPct));
}
