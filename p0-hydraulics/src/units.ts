// 单位换算只在 IO 边界做一次；求解器内部一律 SI（m³/s、Pa、K）。
export const lpmToM3s = (q: number) => q / 60000;
export const m3sToLpm = (q: number) => q * 60000;
export const kpaToPa = (p: number) => p * 1000;
export const paToKpa = (p: number) => p / 1000;
