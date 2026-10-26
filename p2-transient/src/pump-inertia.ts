// 泵/电机转子惯量数据登记（2026-10-20 采集批次，无源不入库）。
// 用途：P2 泵掉电惰转（coastdown）时间常数——ω(t)=ω0/(1+t/τ)，τ=J·ω0/T0（水力转矩 ∝ω² 近似）。
//
// 来源（2026-10-20 访问核实）：
//   - Grundfos《MS6000 Motors》数据手册（60Hz 2 极，~3450-3480 rpm，全文表格）
//     https://api.grundfos.com/literature/Grundfosliterature-5269326.pdf（美制版 5271208 同数据）
//     原文（Power kW → J kg·m²）：5.5→0.00372、7.5→0.00441、9.2→0.00507、11→0.00567、
//     13→0.00639、15→0.00716、18.5→0.00836、22→0.00968、26→0.0110、30→0.0125
//     ——电机转子惯量；叶轮另加（Neutrium 称典型 10-15% 电机惯量，摘要级未核原文，不硬化，
//     记入 uncertainty：本表 J 偏保守下界，实际 J 总成 ≈ ×1.10-1.15）。
//   - 掉电降速方程与 GD²=4J 换算：Deltares WANDA §6.13（T_d=0 时 N_new=N_old+(60/2π)(−T/J)Δt）
//     https://deltares-wanda-core.readthedocs-hosted.com/en/latest/heat/component_pump.html
//   - 量级佐证（文献锚点，不入计算）：Shi et al. 2026《Buildings》16(9):1752（8×GB200 液冷机架
//     实测 FOPDT：泵调速路径再平衡 τ=13.4 s——那是控制回路时间常数，不是转子惰转）；
//     https://www.mdpi.com/2075-5309/16/9/1752
//   - 未采用：Thorley 关联式 I=0.03768(P/N)^0.9556（AFT 文档警示原文单位换算约定未核实，
//     可疑数字宁可不报——引用文献 https://docs.aft.com/impulse/TransientInertialModels.html）

export const MOTOR_INERTIA_MS6000: ReadonlyArray<readonly [number, number]> = [
  [5.5, 0.00372], [7.5, 0.00441], [9.2, 0.00507], [11, 0.00567], [13, 0.00639],
  [15, 0.00716], [18.5, 0.00836], [22, 0.00968], [26, 0.011], [30, 0.0125],
];

/** 表内线性插值（域外钳位端点并暴露 clamped 标志） */
export function motorInertiaKgm2(shaftKw: number): { jKgm2: number; clamped: boolean } {
  const t = MOTOR_INERTIA_MS6000;
  const first = t[0];
  const last = t[t.length - 1];
  if (first === undefined || last === undefined) throw new Error("pump-inertia: 表为空（程序性错误）");
  if (shaftKw <= first[0]) return { jKgm2: first[1], clamped: true };
  for (let i = 1; i < t.length; i++) {
    const hi = t[i];
    const lo = t[i - 1];
    if (hi !== undefined && lo !== undefined && shaftKw <= hi[0]) {
      return { jKgm2: lo[1] + ((hi[1] - lo[1]) * (shaftKw - lo[0])) / (hi[0] - lo[0]), clamped: false };
    }
  }
  return { jKgm2: last[1], clamped: true };
}

export const PUMP_INERTIA_VERSION = "pump-inertia-v1-2026-10-20";
