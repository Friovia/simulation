// 导体材料常数登记（无源不入库政策同样适用）。
// IACS 100% 退火铜：ρ(20°C) = 1.7241×10⁻⁸ Ω·m（=5.8001×10⁷ S/m 的倒数，国际退火铜标准定义值）
// 线性温度系数 α = 0.00393 /K @20°C（退火铜标准值，工程手册通值）
// 来源（2026-10-19 访问核实）：
//   - NDE/NDT Resource Center《Electrical Conductivity and Resistivity》（IACS 定义 5.8001e7 S/m @20°C）
//     https://www.nde-ed.org/Physics/Materials/Physical_Chemical/Electrical.xhtml
//   - Wikipedia《International Annealed Copper Standard》（1.7241e-8 Ω·m）
//     https://en.wikipedia.org/wiki/International_Annealed_Copper_Standard
// ρ(T) = ρ20 · (1 + α·(T−20))，适用域线性近似 0–100°C。
export type ConductorMaterial = "copper-iacs";

export interface MaterialProps {
  rho20OhmM: number;
  alphaPerK: number;
  sourceUrl: string;
}

export const MATERIALS: Record<ConductorMaterial, MaterialProps> = {
  "copper-iacs": { rho20OhmM: 1.7241e-8, alphaPerK: 0.00393, sourceUrl: "https://www.nde-ed.org/Physics/Materials/Physical_Chemical/Electrical.xhtml" },
};

export const MATERIALS_VERSION = "iacs-copper-v1";
