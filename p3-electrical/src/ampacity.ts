// 铜排载流量数据表（2026-10-20 采集批次，无源不入库政策）。
// 校核用"规格匹配制"：输入 (宽,厚) 匹配表内行（|Δarea|/area ≤ 5%），不跨行插值——
// 表行离散且行距大，插值即造数。环境温度修正 k = √((Tmax−Tamb)/(Tmax−T_base))。
//
// 来源（2026-10-20 访问核实）：
//   - Austral Wright Metals《Copper Busbar Rating Table》（数据源 cda.org.uk）
//     https://www.australwright.com.au/wp-content/uploads/2019/01/Copper-Busbar-Rating-Table-Austral-Wright-Metals.pdf
//     适用条件（原文 NOTES）：单条 on edge、40°C 环境、50°C 温升、无柜（Free Air 假设有对流风）。
//     含原生 DC 列（DC 无集肤效应）——本库 DC 校核主表。
//   - Copper Development Association《Table 1: Ampacities of Copper Busbars》（60 Hz AC、40°C 环境、
//     e=0.4、on edge、30/50/65K 三档）https://copper.org/markets-and-applications/building-construction/electrifying-buildings/busbar/table-1-ampacities
//     原表为英制规格；Watteredge 官方再发布给出 DC=AC×√S 换算
//     （https://www.watteredge.com/wp-content/uploads/2024/06/Copper-Bus-Bar-Ampacity-Tables.pdf）。
//     本库按 AC 原值收录作交叉表（L2L DC 场景不直接使用，供 AC 母线与量级交叉）。
//   - OCP《ORv3 48V Power Output Connector Rev 2.0》（Amphenol，2022-03）
//     https://www.opencompute.org/documents/ocp-open-rack-v3-power-output-connector-rev2-0-pdf
//     原文：Power Contact Max current continuous in still air: 360A；in 300LFM @ 45°C airflow: 500A；
//     Max temperature rise: 30°C。机柜取电节点级校核锚点。

export type AmpTableId = "awm-dc-40c-50k" | "cda-ac-40c" | "orv3-connector";

export interface AmpTableRow {
  wMm: number;
  tMm: number;
  /** 各条件下载流量 A；键：awm→still/free；cda→rise30/rise50/rise65；orv3→still/lfm300 */
  byCondition: Record<string, number>;
}

export interface AmpTable {
  id: AmpTableId;
  description: string;
  /** (环境基准°C, 温升基准K, Tmax°C)——环境修正公式用 */
  basis: { ambientC: number; riseK: number; maxC: number };
  conditions: string[];
  defaultCondition: string;
  /** orv3-connector 与铜排规格无关（按触点），rows 为空 */
  rows: AmpTableRow[];
  sourceUrl: string;
  retrieved: string;
}

export const AMPACITY_TABLES: Record<AmpTableId, AmpTable> = {
  "awm-dc-40c-50k": {
    id: "awm-dc-40c-50k",
    description: "AWM/CDA-UK 铜排 DC 载流量（单条 on edge，40°C 环境 +50K 温升，无柜）",
    basis: { ambientC: 40, riseK: 50, maxC: 90 },
    conditions: ["still", "free"],
    defaultCondition: "still",
    rows: [
      { wMm: 25, tMm: 3, byCondition: { still: 315, free: 350 } },
      { wMm: 25, tMm: 5, byCondition: { still: 415, free: 465 } },
      { wMm: 40, tMm: 5, byCondition: { still: 615, free: 685 } },
      { wMm: 50, tMm: 5, byCondition: { still: 745, free: 830 } },
      { wMm: 50, tMm: 6, byCondition: { still: 825, free: 915 } },
      { wMm: 60, tMm: 6, byCondition: { still: 965, free: 1075 } },
      { wMm: 80, tMm: 6, byCondition: { still: 1230, free: 1370 } },
      { wMm: 80, tMm: 8, byCondition: { still: 1435, free: 1595 } },
      { wMm: 80, tMm: 10, byCondition: { still: 1615, free: 1840 } },
      { wMm: 100, tMm: 8, byCondition: { still: 1735, free: 1955 } },
      { wMm: 100, tMm: 10, byCondition: { still: 1950, free: 2225 } },
      { wMm: 100, tMm: 12, byCondition: { still: 2155, free: 2420 } },
    ],
    sourceUrl: "https://www.australwright.com.au/wp-content/uploads/2019/01/Copper-Busbar-Rating-Table-Austral-Wright-Metals.pdf",
    retrieved: "2026-10-20",
  },
  "cda-ac-40c": {
    id: "cda-ac-40c",
    description: "CDA 铜排 60Hz AC 载流量（单条 on edge，40°C 环境，e=0.4；30/50/65K 温升三档）——交叉表",
    basis: { ambientC: 40, riseK: 50, maxC: 90 },
    conditions: ["rise30", "rise50", "rise65"],
    defaultCondition: "rise50",
    // 原表英制规格（宽×厚 in），此处标注最近公制对应；载流量为英制行原值，未换算
    rows: [
      { wMm: 25, tMm: 5, byCondition: { rise30: 340, rise50: 455, rise65: 520 } }, // 1×3/16
      { wMm: 25, tMm: 6, byCondition: { rise30: 400, rise50: 530, rise65: 620 } }, // 1×1/4
      { wMm: 38, tMm: 6, byCondition: { rise30: 560, rise50: 740, rise65: 860 } }, // 1.5×1/4
      { wMm: 50, tMm: 6, byCondition: { rise30: 710, rise50: 940, rise65: 1100 } }, // 2×1/4
      { wMm: 50, tMm: 10, byCondition: { rise30: 880, rise50: 1150, rise65: 1350 } }, // 2×3/8
      { wMm: 75, tMm: 6, byCondition: { rise30: 990, rise50: 1300, rise65: 1550 } }, // 3×1/4
      { wMm: 100, tMm: 6, byCondition: { rise30: 1250, rise50: 1700, rise65: 1950 } }, // 4×1/4
      { wMm: 100, tMm: 10, byCondition: { rise30: 1500, rise50: 2000, rise65: 2350 } }, // 4×3/8
      { wMm: 150, tMm: 10, byCondition: { rise30: 2100, rise50: 2800, rise65: 3250 } }, // 6×3/8
    ],
    sourceUrl: "https://copper.org/markets-and-applications/building-construction/electrifying-buildings/busbar/table-1-ampacities",
    retrieved: "2026-10-20",
  },
  "orv3-connector": {
    id: "orv3-connector",
    description: "OCP ORv3 48V Power Output Connector 触点连续电流（Rev 2.0，节点取电级）",
    basis: { ambientC: 45, riseK: 30, maxC: 75 },
    conditions: ["still", "lfm300"],
    defaultCondition: "still",
    rows: [],
    sourceUrl: "https://www.opencompute.org/documents/ocp-open-rack-v3-power-output-connector-rev2-0-pdf",
    retrieved: "2026-10-20",
  },
};

export const AMPACITY_CONNECTOR_RATINGS: Record<string, number> = { still: 360, lfm300: 500 };

/** 规格匹配：|Δarea|/area ≤ 5% 取行；无匹配返回 null（不插值） */
export function matchRow(table: AmpTable, wMm: number, tMm: number): AmpTableRow | null {
  const area = wMm * tMm;
  let best: AmpTableRow | null = null;
  let bestErr = Infinity;
  for (const r of table.rows) {
    const err = Math.abs(r.wMm * r.tMm - area) / area;
    if (err < bestErr) { bestErr = err; best = r; }
  }
  return bestErr <= 0.05 ? best : null;
}

/** 环境温度修正系数 k = √((Tmax−Tamb)/(Tmax−T_base))；Tamb ≤ Tmax−5K 才有意义 */
export function envDerateK(maxC: number, baseAmbientC: number, ambientC: number): number {
  return Math.sqrt((maxC - ambientC) / (maxC - baseAmbientC));
}

export const AMPACITY_VERSION = "ampacity-v1-2026-10-20";
