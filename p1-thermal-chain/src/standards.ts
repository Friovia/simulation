// ASHRAE W 级与供水温度下限 —— data/fluids-and-standards.md §2（TC 9.9 第 5 版参考卡 [S6]）。
// 级数 = 最高设施供水温度（W17 即 17 °C）；所有等级最低供水温度 2 °C（官方表脚注 a）。
export type WClass = "W17" | "W27" | "W32" | "W40" | "W45";

export const WCLASS_MAX_SUPPLY_C: Record<WClass, number> = {
  W17: 17,
  W27: 27,
  W32: 32,
  W40: 40,
  W45: 45,
};

export const ASHRAE_MIN_SUPPLY_C = 2;
