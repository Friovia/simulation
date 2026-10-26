// 48V 源侧短路模型数据登记（2026-10-20 采集批次，无源不入库）。
// 建模口径（采集结论）：DC 侧短路不是恒定内阻问题——正确口径 =
//   ①droop 均流阻抗（PSU/BBU 有意设计的电压-电流斜率，作为有效源阻抗）
//   ②OCP/SCP 限流-限时限流窗口（超过即保护动作）
//   ③短时峰值能力（136%/50ms、160%/400µs）
//
// 来源（2026-10-20 访问核实）：
//   - Advanced Energy《ORv3 HPR 5.5 kW PSU》数据手册（17 页全文）
//     https://www.advancedenergy.com/getmedia/a0b372ed-7676-4d99-ae69-810fe673007f/eng-orv3-hpr-psu-datasheet.pdf
//     原文：Output Current 113A(max)/额定 50V·110A·5.5kW；droop 1V ±0.125V（0→100% 负载，
//     Set Point 49.000V@100%）；SCP 立即关断+5s 单次同步重试后锁死；OCP 平均功率 >115% 持续
//     10s / >120% 持续 100ms；OVP 52.5V（<200ms）；峰值 136%@50ms / 160%@400µs / 100%@1s
//     （移动平均口径）；动态响应 1A/µs 摆率下 50% 阶跃偏差 0.5V、恢复 3ms。
//   - OCP《Open Rack V3 BBU Module Specification》Rev 1.4（Meta）
//     https://www.opencompute.org/documents/open-rack-v3-bbu-module-spec-1-4-pdf/
//     原文：放电 3kW、Vout 63.2A max、droop 0.5V（48.0→47.5V，0→100%）、47.25V@150% peak、
//     OCP 160% 延时 10-20ms、短路自保护重试 5 次后锁死、母排 <48.5V 持续 2ms 激活。
//   - OCP《Open Rack V3 Power Shelf Specification》Rev 1.0：1OU 15.36kW（8 PSU）/18kW（6×3kW）、
//     母排 320A；"Short circuit current available is 25kA" = 机房 AC 侧上游可用短路电流
//     （电源架须承受的故障水平，非 DC 母排短路电流——口径澄清登记）。
//     https://www.opencompute.org/documents/ocp-open-rack-v3-power-shelf-rev-1-0-1-pdf/
//
// 派生值（换算，非原文）：droop 1V÷110A≈9.09 mΩ/PSU；0.5V÷63.2A≈7.91 mΩ/BBU。
// 未找到（红灯保留）：PSU/BBU 的物理直流内阻与 DC 短路电流能力原始值；18650 电芯短路电流
// （规格仅 30A 持续放电）。已查渠道见采集报告。

export type SourceSpecId = "orv3-hpr-psu" | "orv3-bbu-3kw";

export interface SourceSpec {
  id: SourceSpecId;
  vendor: string;
  description: string;
  vSetV: number; // 空载/设定电压
  iRatedA: number; // 额定电流
  droopV: number; // 0→100% 负载压降（均流设计）
  ocpPct: number; // OCP 动作点（% 额定）
  ocpMs: number; // OCP 最长动作延时窗
  peakPct: number; // 短时峰值能力（% 额定）
  peakMs: number; // 峰值窗口
  scpBehavior: string; // 短路保护行为
  sourceUrl: string;
  note?: string;
}

export const SOURCE_SPECS: Record<SourceSpecId, SourceSpec> = {
  "orv3-hpr-psu": {
    id: "orv3-hpr-psu",
    vendor: "Advanced Energy (OCP ORv3 HPR)",
    description: "ORv3 HPR 5.5 kW PSU（50V/110A 额定，8 台/架 15.36kW）",
    vSetV: 50,
    iRatedA: 110,
    droopV: 1,
    ocpPct: 120,
    ocpMs: 100,
    peakPct: 136,
    peakMs: 50,
    scpBehavior: "SCP 立即关断，5s 后单次同步重试，仍短路则锁死",
    sourceUrl: "https://www.advancedenergy.com/getmedia/a0b372ed-7676-4d99-ae69-810fe673007f/eng-orv3-hpr-psu-datasheet.pdf",
    note: "OCP 双窗：>115%/10s 与 >120%/100ms（本表取快窗）；峰值 160%/400µs（取 136%/50ms 稳健窗）",
  },
  "orv3-bbu-3kw": {
    id: "orv3-bbu-3kw",
    vendor: "OCP (Meta)",
    description: "ORv3 BBU 放电模块 3kW（48.0→47.5V，63.2A max）",
    vSetV: 48,
    iRatedA: 63.2,
    droopV: 0.5,
    ocpPct: 160,
    ocpMs: 20,
    peakPct: 150,
    peakMs: 10,
    scpBehavior: "过流/短路自保护，重试 5 次后锁死",
    sourceUrl: "https://www.opencompute.org/documents/open-rack-v3-bbu-module-spec-1-4-pdf/",
    note: "OCP 160% 延时 10-20ms（取上界 20ms）；47.25V@150% peak",
  },
};

export const SOURCE_VERSION = "source-v1-2026-10-20";

/**
 * 源侧短路电流模型（金属性短路，Z_bus << Z_source）：
 *   R_eff = droopV / iRatedA / units（并联均流阻抗）
 *   I_sc_ideal = vSetV / R_eff（未受保护的理想上界）
 *   I_limited = units × iRatedA × peakPct%（短时窗口内源能维持的电流）
 *   I_ocp = units × iRatedA × ocpPct%（超过即保护动作）
 * 语义：I_sc_ideal > I_ocp ⇒ 保护必动作（在 ocpMs 窗口内关断/锁死）；
 * 断路器瞬时校核应使用 I_limited（窗口内实际可达到的电流上界），不是理想短路电流。
 * 假设登记：金属性短路（母排阻抗忽略）；PSU 与 BBU 并存时按调用侧分别评估（不叠加）。
 */
export function sourceShortCircuit(spec: SourceSpec, units: number): {
  rEffOhm: number;
  iScIdealA: number;
  iLimitedA: number;
  iOcpA: number;
  protectionWillAct: boolean;
} {
  const rEffOhm = spec.droopV / spec.iRatedA / units;
  const iScIdealA = spec.vSetV / rEffOhm;
  const iLimitedA = units * spec.iRatedA * (spec.peakPct / 100);
  const iOcpA = units * spec.iRatedA * (spec.ocpPct / 100);
  return { rEffOhm, iScIdealA, iLimitedA, iOcpA, protectionWillAct: iScIdealA > iOcpA };
}
