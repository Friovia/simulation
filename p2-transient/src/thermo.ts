// 金属/结构材料热物性登记（2026-10-20 采集批次，无源不入库）。
// 用于 P2 环路金属热容 C_metal = Σ m·cp（流体之外的集总项）。
//
// 来源（2026-10-20 访问核实）：
//   - C11000 铜：CDA 官方合金表（ρ 0.322 lb/in³=8.90 g/cm³、cp 0.092 Btu/lb·°F=385 J/kgK）
//     https://alloys.copper.org/alloy/C11000 ；Amesweb 交叉（385 J/kgK 一致）
//     https://www.amesweb.info/Materials/Specific-Heat-of-Copper.aspx
//   - 6061 铝：Wikipedia 信息框（引 ASM Handbook Vol.2：ρ 2.70 g/cm³、cp 897 J/kgK）
//     https://en.wikipedia.org/wiki/6061_aluminium_alloy
//   - 6063 铝：Wikipedia（cp 900 J/kgK；Hydro 数据表 901，差 <0.5%）
//     https://en.wikipedia.org/wiki/6063_aluminium_alloy
//   - 304 不锈钢：AZoM/CES Selector（ρ 7.85–8.06、cp 490–530 区间）→ 取区间中值 7955 / 510（取值规则登记，非编数）
//     https://www.azom.com/properties.aspx?ArticleID=965
//   - 316 不锈钢：EZ Lok（ρ 8 g/cc、cp 0.5 J/g·°C @0–100°C 区间，与建模窗口吻合）
//     https://www.ezlok.com/316-stainless-steel-properties
//   - Q235 碳钢：天展钢管（ρ 7.85 g/cm³、cp 470 J/kgK@20°C；中文文献 460 亦常见，差 2%）
//     https://cn.tytsteelpipes.com/news/what-is-q235-carbon-steel-68957264.html
//
// 器件质量锚点（metal.massKg 的合规取值依据，调用侧引用）：
//   - CPU 冷板（Xeon 级真空钎焊铜板）：1.5 kg —— Wakefield《Liquid Cooled Products》p.16
//     https://wakefieldthermal.com/content/Liquid%20Cooled%20Products%20HD%20v3%20-%20Compressed.pdf
//   - GPU 冷板（H100 级紧凑板）：455 g —— StorageReview/JetCool SmartPlate
//     https://www.storagereview.com/news/jetcool-unveils-cold-plates-for-the-nvidia-h100-gpu
//   - ORv3 机架集管（38×38 不锈钢，42U）：Dry 11.3 kg / Filled 13.6 kg —— nVent RackChiller 手册（89216863）
//     https://manuals.plus/nvent-hoffman/rcm42001h-rackchiller-rack-manifold-manual
//   - ORv3 裸机柜：145 kg（Cheval frame only）/ 172 kg（Rittal 7100.120 带母排）
//     https://chevalstore.com/ocp-open-rack-orv3/ ；https://www.rittal.com/us-en_US/products/PG20231215ITI101/PG20240402ITI203/PRO136577
//   - 服务器整机热容（独立节点，非环路集总）：实测 11.1 kJ/K（典型 2U、220-350W、满风量）——
//     Electronics Cooling《Characterization of Server Thermal Mass》（Syracuse，12 次实验 ±7%）。
//     ⚠️ 服务器非与供液同温的集总节点，不入 metal 数组；其惯性属服务器热惯性红灯（模型外）。
//     https://www.electronics-cooling.com/2013/12/characterization-server-thermal-mass

export type ThermoMaterialId = "copper-c11000" | "alu-6061" | "alu-6063" | "ss-304" | "ss-316" | "steel-q235";

export interface ThermoProps {
  rhoKgM3: number;
  cpJkgK: number;
  sourceUrl: string;
  note?: string;
}

export const THERMO_MATERIALS: Record<ThermoMaterialId, ThermoProps> = {
  "copper-c11000": { rhoKgM3: 8900, cpJkgK: 385, sourceUrl: "https://alloys.copper.org/alloy/C11000" },
  "alu-6061": { rhoKgM3: 2700, cpJkgK: 897, sourceUrl: "https://en.wikipedia.org/wiki/6061_aluminium_alloy" },
  "alu-6063": { rhoKgM3: 2700, cpJkgK: 900, sourceUrl: "https://en.wikipedia.org/wiki/6063_aluminium_alloy", note: "Hydro 数据表 901，差 <0.5%" },
  "ss-304": { rhoKgM3: 7955, cpJkgK: 510, sourceUrl: "https://www.azom.com/properties.aspx?ArticleID=965", note: "AZoM 区间 ρ 7850–8060 / cp 490–530 的中值（取值规则登记）" },
  "ss-316": { rhoKgM3: 8000, cpJkgK: 500, sourceUrl: "https://www.ezlok.com/316-stainless-steel-properties", note: "cp 为 0–100°C 区间值（源标注），与建模窗口吻合" },
  "steel-q235": { rhoKgM3: 7850, cpJkgK: 470, sourceUrl: "https://cn.tytsteelpipes.com/news/what-is-q235-carbon-steel-68957264.html", note: "中文文献 460 亦常见（差 2%）" },
};

export const THERMO_VERSION = "thermo-v1-2026-10-20";
