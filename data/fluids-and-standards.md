# 工质物性与标准等级调研 memo：PG25 物性 / ASHRAE W 级 / 湿空气露点

- **检索日期**：2026-10-17（本 memo 所有来源均于当日访问核实）
- **用途**：P0 液力求解器的 PG25 物性温度修正、P1 热链的露点纪律与 W 级对标；本 memo 将定稿为 fluids schema 的数据基础
- **数据政策**：沿用 `data/component-curves/schema.md`——无 `source.url` 不入库、分歧双列、缺口亮红灯、绝不编数
- **来源编号**：正文所有数字用 [S1]…[S10] 指向文末来源列表

---

## 1. PG25（25 vol% 丙二醇水溶液）物性 vs 温度

### 1.1 浓度基准先行澄清（避免张冠李戴）

| 项目 | 数值 | 来源 |
|---|---|---|
| "PG25" 浓度基准 | **25 vol%（体积百分数）**，数据中心/直接芯片冷却行业口径 | [S1][S3] |
| 25 vol% ≈ 质量分数 | ≈ 25.5 wt%（Dow 官方 wt↔vol 对照表内插：24.5 vol% = 25 wt%，25.5 vol% = 26 wt%） | [S1] Table 4 |
| 冰点 | 14 °F / **−10 °C**（Dow 产品页与指南 Table 1）；Dynalene 25 vol% 给 −10.1 °C | [S1][S2][S3] |
| 沸点（760 mmHg） | 101.4 °C | [S1] Table 1 |
| 产品定位 | DOWFROST LC 25：USP 级 PG + 缓蚀剂，直接标用于 Datacom Equipment Cooling System / Direct-to-Chip Liquid Cooling / Data Center Cooling，许用温区 −10…90 °C | [S2] |

> 注意：是**丙二醇**（propylene glycol，PG），不是乙二醇（EG）。所有表均取自 PG 文档，勿与 EG 数据混用（Dow 文档 [S4] 同时含 EG 段落，明确提示两者黏度/密度差异显著）。

### 1.2 主表 A —— DOWFROST LC 25 官方工程指南 Table 2（首选数据集）

原生数字版 PDF（非扫描），25 vol% 专用表，5 °C 步进。Pr 为计算值 `Pr = c_p·μ/k`（**无任何来源直接发表 PG25 的 Pr 数**，全部为推导值，见缺口 G5）。

| T (°C) | ρ (kg/m³) | c_p (kJ/(kg·K)) | k (W/(m·K)) | μ (mPa·s) | Pr（计算） |
|---|---|---|---|---|---|
| 0 | 1040.5 | 3.82 | 0.432 | 6.32 | 55.9 |
| 5 | 1038.8 | 3.83 | 0.438 | 5.13 | 44.9 |
| 10 | 1036.9 | 3.84 | 0.444 | 4.17 | 36.1 |
| 15 | 1034.9 | 3.85 | 0.450 | 3.42 | 29.3 |
| 20 | 1032.7 | 3.87 | 0.456 | 2.84 | 24.1 |
| 25 | 1030.3 | 3.88 | 0.462 | 2.39 | 20.1 |
| 30 | 1027.8 | 3.89 | 0.467 | 2.05 | 17.1 |
| 35 | 1025.2 | 3.90 | 0.472 | 1.78 | 14.7 |
| 40 | 1022.5 | 3.92 | 0.476 | 1.58 | 13.0 |
| 45 | 1019.7 | 3.93 | 0.481 | 1.41 | 11.5 |
| 50 | 1016.8 | 3.94 | 0.485 | 1.27 | 10.3 |
| 55 | 1013.7 | 3.95 | 0.488 | 1.15 | 9.3 |
| 60 | 1010.6 | 3.97 | 0.492 | 1.04 | 8.4 |

来源：[S1] DOWFROST LC Engineering & Operating Guide（Dow 表单 176-01641-01）Table 2 与 Table 1（Table 1 单点交叉验证一致：μ(20 °C)=2.8、μ(50 °C)=1.3、k(50 °C)=0.485、c_p(50 °C)=3.94 ✓）。产品身份经 Dow 官网产品页 [S2] 确认（冰点 14 °F/−10 °C、直接芯片冷却应用）。
不确定性：Dow 自注 "Typical properties, not to be construed as specifications"——厂商典型值，无误差带。

### 1.3 交叉验证表 B —— 经典 DOWFROST 工程指南（25 vol% 内插）+ 两家美系厂商

经典 Dow 指南只有 10% 步进的浓度列；**25 vol% = 20% 与 30% 两列的线性中点**（方法透明：浓度方向线性内插）。三家来源独立交叉：

**B1. 经典 DOWFROST & DOWFROST HD 工程指南（Dow 老版，OCR 扫描副本）**，SI 表 Table 10/14/18/22（DOWFROST 流体，Volume Percent 列），20%/30% 列中点：

| T (°C) | ρ (kg/m³) | c_p (kJ/(kg·K)) | k (W/(m·K)) | μ (mPa·s) | Pr（计算） |
|---|---|---|---|---|---|
| 0 | 1032.2 | 3.86 | 0.432 | 5.56 | 49.6 |
| 5 | 1030.5 | 3.87 | 0.439 | 4.47 | 39.5 |
| 10 | 1028.8 | 3.89 | 0.446 | 3.65 | 31.9 |
| 15 | 1026.8 | 3.90 | 0.452 | 3.02 | 26.1 |
| 20 | 1024.8 | 3.91 | 0.457 | 2.54 | 21.7 |
| 25 | 1022.7 | 3.92 | 0.463 | 2.15 | 18.3 |
| 30 | 1020.4 | 3.93 | 0.468 | 1.85 | 15.6 |
| 35 | 1018.0 | 3.95 | 0.473 | 1.61 | 13.5 |
| 40 | 1015.5 | 3.96 | 0.478 | 1.40 | 11.7 |
| 45 | 1012.8 | 3.97 | 0.481 | 1.25 | 10.3 |
| 50 | 1010.0 | 3.98 | 0.486 | 1.10 | 9.1 |
| 55 | 1007.0 | 4.00 | 0.489 | 0.99 | 8.1 |
| 60 | 1004.0 | 4.01 | 0.492 | 0.90 | 7.3 |

来源：[S4]。**提取 QA**（该副本为 OCR 扫描，已做三重验证）：① 密度页经图像目视逐格核对；② 全部四表按词坐标聚类重建行列；③ 物理锚点校验——纯水列 ρ(25 °C)=996.9（文献 997.0 ✓）、μ(20 °C)=1.00 mPa·s（文献 1.002 ✓）、μ(100 °C)=0.28 ✓、k(20 °C)=0.599 W/(m·K)（文献 0.598 ✓）、比热纯水列偏差 −0.8%（Dow 自家水基准）。残余 OCR 风险见缺口 G4。

**B2. Dynalene PG 系列技术数据表**（25 vol% 专用列，原生数字 PDF，温度为 °F 行，换算后列出）[S3]：

| T (°C) | ρ (kg/m³) | c_p (kJ/(kg·K)) | k (W/(m·K)) | μ (mPa·s) |
|---|---|---|---|---|
| −1.1 (30 °F) | — | — | — | 5.85 |
| 10.0 (50 °F) | 1028.9 | 3.889 | 0.457 | 3.66 |
| 21.1 (70 °F) | 1024.4 | 3.914 | 0.471 | 2.45 |
| 32.2 (90 °F) | 1019.4 | 3.943 | 0.481 | 1.74 |
| 37.8 (100 °F) | 1016.7 | 3.956 | 0.486 | 1.49 |
| 48.9 (120 °F) | 1010.6 | — | 0.490 | 1.14 |

换算：lb/ft³×16.0185、Btu/(lb·°F)×4.186、Btu/(hr·ft·°F)×1.7307（均为该数据表自载换算因子）。附：25 vol% 冰点 −10.1 °C、SG(22 °C)=1.025，与 [S1][S2] 一致。

**B3. Mokon PG 技术数据**（20%/30% vol 两列中点，5 个温度点）[S5]：

| T (°C) | ρ (kg/m³) | c_p (kJ/(kg·K)) | k (W/(m·K)) | μ (mPa·s) |
|---|---|---|---|---|
| −1.1 (30 °F) | — | — | — | 5.84 |
| 26.7 (80 °F) | 1022.0 | 3.924 | 0.470 | 2.04 |
| 54.4 (130 °F) | 1007.3 | 3.991 | 0.494 | 1.01 |
| 82.2 (180 °F) | 988.7 | 4.065 | 0.508 | 0.61 |
| 110 (230 °F) | 966.7 | 4.129 | 0.511 | 0.43 |

### 1.4 来源分歧登记（重要，schema 必须显式承载）

经典 Dow 指南 [S4]、Dynalene [S3]、Mokon [S5] 三者高度一致（构成"共识簇"）；**DOWFROST LC 25 指南 [S1] 的密度与黏度系统性偏高**：

| 物性 @20 °C | 共识簇（S4/S3/S5） | LC 25 指南（S1） | 分歧 |
|---|---|---|---|
| ρ (kg/m³) | 1024.4–1024.8 | 1032.7 | **+0.8%** |
| μ (mPa·s) | 2.54–2.55 | 2.84 | **+11%** |
| k (W/(m·K)) | 0.457（S4）–0.471（S3） | 0.456 | 一致（与 S4 几乎相同；S3 高 ~3%） |
| c_p (kJ/(kg·K)) | 3.910–3.914 | 3.87 | −1% |

@40 °C 同向复现：ρ 共识 ≈1015.5（S4 内插与 S3 换算内插一致）vs LC 1022.5；μ 共识 1.40–1.42 vs LC 1.58。同一偏移量（ρ +8 kg/m³、μ +11%）在 LC 55 产品表上同样出现（LC 55 @20 °C：1052.5 vs 经典指南 55 vol% 内插 ≈1044），说明是 **LC 指南文档级的系统性偏移**，非提取错误（LC 指南 Table 1 与 Table 2 内部自洽）。

**建议（供 schema 定稿决策，需人工复核 G1/G3）**：
- 默认数据集用 **LC 25（主表 A）**：数据中心对口产品（Dow 直接标 direct-to-chip），且其偏高的 μ 使 ΔP 与换热计算**偏保守**（泵选型安全侧），c_p 偏低 1% 同样保守；
- 共识簇（B1）作为敏感性对照入库（μ ±11% 做敏感性分析项）；
- 计算书假设登记表必须写明此分歧。

### 1.5 fluids schema 建议（沿 component-curves/schema.md 风格）

```jsonc
{
  "id": "pg25-dow-lc25",                    // 备选数据集: "pg25-dow-classic-consensus"
  "type": "fluid-properties",
  "fluid": {
    "name": "propylene glycol + water (inhibited)",   // 丙二醇，不是 EG
    "concentration": { "value": 25, "basis": "vol%", "wt_equiv_approx": 25.5 },
    "freeze_point_C": -10
  },
  "properties": {                            // 每条: unit 一律 SI，points = [[T_C, value], ...]，5 °C 步进
    "density":   { "unit": "kg/m3",  "points": [[0,1040.5],[5,1038.8], /* … */ [60,1010.6]] },
    "viscosity": { "unit": "mPa.s",  "points": [[0,6.32],  /* … */ [60,1.04]] },
    "cp":        { "unit": "J/kgK",  "points": [[0,3820],  /* … */ [60,3970]] },
    "k":         { "unit": "W/mK",   "points": [[0,0.432], /* … */ [60,0.492]] },
    "pr":        { "unit": "-",      "points": [[0,55.9],  /* … */ [60,8.4]],
                   "computed_from": "cp*mu/k", "note": "无公开来源发表 Pr，全部为计算值" }
  },
  "valid_range": { "T_min_C": 0, "T_max_C": 60 },
  "source": { "url": "https://www.glycolsales.com.au/wp-content/uploads/2025/07/176-01641-01-dowfrost-lc-engineering-and-operating-guide.pdf",
              "type": "vendor-engguide", "retrieved": "2026-10-17",
              "corroboration": ["https://www.dow.com/en-us/pdp.dowfrost-lc-25-heat-transfer-fluid.497419z.html"] },
  "divergence": "与经典 Dow 指南+Dynalene+Mokon 共识相比: rho +0.8%, mu +11%（见 memo §1.4）",
  "uncertainty": "厂商 typical 值无误差带；跨源散布 rho ±0.8% / mu ±11% / k ±3% / cp ±1%",
  "redlight": null
}
```

插值政策：温度方向线性插值 + 单调性检查；**黏度建议对 ln(μ) 线性插值**（跨 5 °C 段误差 <0.5%，普通线性在低温段误差可达 1–2%）。

---

## 2. ASHRAE W 级（液冷冷却液温度等级）定义表

来源：ASHRAE TC 9.9《Thermal Guidelines for Data Processing Environments》第 5 版（2021，2024 修订）官方参考卡 [S6]，及 ASHRAE 液冷白皮书 [S7]。

| 等级 | 曾用名（第 4 版前） | 最高设施供水温度 (°C) | 设施冷却配置（官方表原文转译） | 适用场景叙述 |
|---|---|---|---|---|
| W17 | W1 | **17** (62.6 °F) | 冷水机组/冷却塔（chiller/cooling tower），可选水侧经济器 | 传统冷冻水数据中心；性能优先、对供水温度最敏感的设备 |
| W27 | W2 | **27** (80.6 °F) | 同 W17（与 W17 同组），可选水侧经济器（冷却塔） | 传统 chiller+冷却塔机房加装水侧经济器提效；白皮书案例：可支撑单 CPU ≤500 W、单 DIMM ≤12 W（1U 半宽双 CPU 串联、DIMM 单侧冷板配置） |
| W32 | W3 | **32** (89.6 °F) | 冷却塔，补充：chiller 或区域供热 | 多数地点可无 chiller 运行；当今主流冷板方案多数可生活在 W32（对应芯片 case 温度 80–90 °C） |
| W40 | （第 5 版新增） | **40** (104 °F) | 冷却塔，补充：区域供热 | 高温水运行；部分地点仍需 chiller 兜底 |
| W45 | W4 | **45** (113 °F) | 区域供热（district heating system） | 完全无 chiller 运行以最大化能效与降低 capex；对超高热流密度芯片其冷却能力逼近低冷通道风冷水平；部分地点不适合干冷器 |
| W+ | W5 | **>45** (>113 °F) | （开放式上界） | 余热回收/区域供热等极限场景 |

- **所有等级的最低供水温度为 2 °C (35.6 °F)**——官方表脚注 a 原文 [S6]。
- 等级承诺语义（第 5 版强化）："operating within a particular environmental class requires full performance of the equipment over the entire environmental range of the specified class, based on nonfailure conditions"（在该等级全温区设备须满性能运行，基于非失效条件）[S7]。
- 级数 = 最高供水温度数字（W17 即 17 °C），2021 第 5 版起改名：W1→W17、W2→W27、W3→W32、W40 新增、W4→W45、W5→W+ [S7]。

> 与本项目 P1 的对接：供水温度同时受**露点下限**（§3，防冷凝红线）与 **W 级上限**双约束；热带 35 °C/60%RH 场景露点 ≈26.1 °C，W27 的 27 °C 上限只剩 ~0.9 K 干预空间，实际需按"露点 + 余量"取供水温度，见 §3.4。

---

## 3. 湿空气露点计算式（Magnus 型）与算例

### 3.1 公式与系数（两套推荐，均为公开可引用）

**通用形式**（T 为气温 °C，e_s 为饱和水汽压 hPa）：

```
e_s(T) = a · exp( b·T / (T + c) )
实际水汽压  e = RH/100 · e_s(T)
露点（闭式反解） T_d = c·γ / (b − γ)，其中 γ = ln(RH/100) + b·T/(T+c)
```

| 系数集 | a (hPa) | b | c (°C) | 适用范围 | 来源 |
|---|---|---|---|---|---|
| **Alduchov–Eskridge (1996)**（推荐主用） | 6.1094 | 17.625 | 243.04 | 对 Goff–Gratch 最小二乘拟合；常引述拟合域 −40…+50 °C（见 G8 保留项），二手技术页给 −40…+60 °C 内 e_s 偏差约 0.4% | [S8][S9] |
| Sonntag 1990 / WMO CIMO 2008（Vaisala 文档同款） | 6.112 | 17.62 | 243.12 | 0…+100 °C 水面（WMO 气象应用标准式）；Vaisala 湿度换算手册采用同系数 | [S10][S11] |
| Magnus–Tetens (Murray 1967)（交叉核对用） | 6.1078 | 17.269388 | 237.3（K 式等价 T−35.86） | 经典气象近似 | [S10] |
| Bolton (1980)（交叉核对用） | 6.112 | 17.67 | 243.5 | 气象常用 | [S10] |

> 项目温度域（15–45 °C）内四套系数给出的露点差异 <0.1 K（见算例），选 A-E 或 WMO/Sonntag 均可；建议 schema 固定一套（A-E）并在金向量中锁定位级预期，另一套做交叉断言。

### 3.2 算例：35 °C、60%RH（/tropical 主张场景，验证 README 自估 ~26 °C）

按 A-E 系数逐步展开（可作求解器单测的金向量）：

1. e_s(35) = 6.1094 · exp(17.625×35/(35+243.04)) = 6.1094 · exp(2.21883) = **56.176 hPa**
2. e = 0.60 × 56.176 = **33.705 hPa**
3. γ = ln(0.60) + 17.625×35/278.04 = −0.51083 + 2.21883 = **1.70800**
4. T_d = 243.04 × 1.70800 / (17.625 − 1.70800) = **26.08 °C**

四套系数横向对比（同工况）：

| 系数集 | e_s(35 °C) (hPa) | T_d (°C) |
|---|---|---|
| Alduchov–Eskridge 1996 | 56.176 | **26.08** |
| Sonntag/WMO/Vaisala (17.62/243.12) | 56.128 | 26.07 |
| Tetens/Murray 1967 | 56.220 | 26.06 |
| Bolton 1980 | 56.312 | 26.09 |

**结论：35 °C/60%RH 露点 = 26.06–26.09 °C，README 的 "~26 °C" 自估验证通过**（跨系数集散布仅 0.03 K）。

### 3.3 代码形态（供 fluids schema / P1 求解器直用）

```ts
// Magnus (Alduchov-Eskridge 1996); T, RH% -> dew point °C
const A = 6.1094, B = 17.625, C = 243.04;           // hPa, -, °C
const es = (T: number) => A * Math.exp((B * T) / (T + C));
export function dewPoint(T: number, RH: number): number {
  const g = Math.log(RH / 100) + (B * T) / (T + C);
  return (C * g) / (B - g);
}
// 金向量: dewPoint(35, 60) ≈ 26.08 ± 0.01
```

### 3.4 对接红线（露点纪律）

热带场景 T_d ≈ 26.1 °C 时：W27（≤27 °C）裕度仅 **0.9 K**——供水温度必须按 `≥ T_d + 设计余量`（建议 ≥1.5–2 K）反推，此时 W27 名义上限在热带高湿季不可全用；W32（≤32 °C）裕度 5.9 K，是热带场景的合理目标等级。此约束应写成 P1 输出的硬断言。

---

## 4. 来源列表（全部于 2026-10-17 访问核实）

| # | 来源 | URL |
|---|---|---|
| S1 | DOWFROST LC Engineering & Operating Guide（Dow 表单 176-01641-01；含 LC 25 Table 1/2、wt↔vol 对照 Table 4） | https://www.glycolsales.com.au/wp-content/uploads/2025/07/176-01641-01-dowfrost-lc-engineering-and-operating-guide.pdf |
| S2 | Dow 官网 DOWFROST LC 25 产品页（产品身份/冰点/直接芯片冷却应用） | https://www.dow.com/en-us/pdp.dowfrost-lc-25-heat-transfer-fluid.497419z.html |
| S3 | Dynalene PG 技术数据表（25 vol% 列：密度/比热/导热/黏度/冰点/SG） | https://www.dynalene.com/wp-content/uploads/2020/05/Dynalene-PG-Tech-Data-Sheet-Rev1.pdf |
| S4 | 经典 DOWFROST & DOWFROST HD 工程与运行指南（老版 Dow，OCR 扫描副本；SI 表 Table 10/14/18/22） | https://ingredi.com/content/pdfs/DOWFROST_Manual.pdf |
| S5 | Mokon PG 技术与工程数据（20–60 vol% 物性表） | https://www.mokon.com/products/fluids/glycol-solutions/pdf/Propylene-Glycol-Technical-Data.pdf |
| S6 | ASHRAE TC 9.9 官方参考卡《2021 Thermal Guidelines, 5th Ed (Revised 2024)》（W 级表 Table 2.2 组、A/H 级表） | https://www.ashrae.org/file%20library/technical%20resources/bookstore/supplemental%20files/therm-gdlns-5th-r-e-refcard.pdf |
| S7 | ASHRAE 白皮书《Emergence and Expansion of Liquid Cooling in Mainstream Data Centers》(©2021)（W 级改名史、W27 500 W CPU 能力、W32 冷板 case 温度叙述） | https://www.ashrae.org/file%20library/technical%20resources/bookstore/emergence-and-expansion-of-liquid-cooling-in-mainstream-data-centers_wp.pdf |
| S8 | Alduchov & Eskridge (1996), J. Appl. Meteor. 35(4):601–609, "Improved Magnus Form Approximation of Saturation Vapor Pressure"（DOI: 10.1175/1520-0450(1996)035<0601:IMFAOS>2.0.CO;2） | https://ui.adsabs.harvard.edu/abs/1996JApMe..35..601A/abstract （OSTI 记录: https://www.osti.gov/biblio/548871） |
| S9 | watervaporpressure.com Magnus 页（A-E 系数 P₀=610.94 Pa, a=17.625, b=243.04 °C；−40…+60 °C 内约 ±0.4%） | https://watervaporpressure.com/formulas/magnus |
| S10 | UCAR/NCAR EOL 水汽压公式汇编页（WMO 2008: 6.112/17.62/243.12；Tetens/Murray；Bolton 等 12 套公式） | https://www.eol.ucar.edu/data-software/conventions-and-standards/water-vapor-pressure-formulations |
| S11 | Vaisala《Humidity Conversion Formulas》B210973EN-F（17.62/243.12 系数组与露点式；官方电子书入口） | https://www.vaisala.com/en/ebook/make-your-job-easier-humidity-conversion-formulas （公开镜像 PDF: https://www.hatchability.com/Vaisala.pdf） |

未采用的候选来源及理由：
- **Engineering Toolbox PG 页**（https://www.engineeringtoolbox.com/propylene-glycol-d_363.html）：页面多表基准标注不清、抓取值自相矛盾（SG 1.017@20 wt% 与密度 1023@20 °C 无法同时成立），且与本次三家厂商共识不符——**不采信**，仅登记。
- **ASHRAE Handbook—Fundamentals, Ch.31（Secondary Coolants 物性表）**：任务首选来源之一，但付费墙后无法访问（见 G1）。
- **Koolen 著作**：未能在线定位可引用的公开 URL/物性表（见 G7）。

---

## 5. 缺口清单（红灯项，schema 定稿前需人工处理）

| # | 缺口 | 影响 | 建议动作 |
|---|---|---|---|
| G1 | **ASHRAE Handbook Fundamentals Ch.31 PG 物性表未获取**（付费墙） | 任务首选来源缺位；无法作为 Dow 分歧的第三方仲裁 | 采购/馆际获取 2021 版 Ch.31 表后补一轮对标 |
| G2 | **Dow 官方版 LC 指南未直接获取**：engage.dow.com/LP=14576 需注册留资；S1 为澳洲经销商镜像 | 镜像与官方版存在被改版风险（低：原生数字版、与产品页 [S2] 交叉一致） | 人工注册下载官方 PDF 核对 Table 2 逐值 |
| G3 | **Dow 两份文档 ρ/μ 系统性分歧**（LC 25 vs 经典指南+Dynalene+Mokon：ρ +0.8%、μ +11%，LC 55 同样偏移） | 默认数据集选择影响全部 ΔP/换热结果 | 人工复核：向 Dow 技术支持求证，或以 G1 的 ASHRAE 表仲裁；期间按 §1.4 建议（LC 25 默认 + 共识敏感性） |
| G4 | 经典 Dow 指南 [S4] 为 **OCR 扫描副本**：密度页已图像目视核对、四表坐标重建 + 水锚点校验通过，但数字位级仍有残余 OCR 风险 | B1 表若被引为默认数据集，需更高置信 | 找 Dow 官方在售版本 PDF（form 180-01233 系）替换镜像 |
| G5 | **PG25 的 Pr 数无任何来源直接发表**——本文全部 Pr 为 c_p·μ/k 计算值 | Pr 列不能标"来源值" | 保持 computed 标注即可；如需他证可与 EnergyFlowX 类计算器抽样比对（其浓度基准需先核实） |
| G6 | 覆盖域止于 0–60 °C（项目范围）；**−10…0 °C（冬季停机/预冷）与 >60 °C 未采** | 冬季工况仿真缺数据 | LC 25 指南实际给到 −5…80 °C，可直接扩展；经典指南给到 −35 °C |
| G7 | "Koolen" 参考书未能在线核实 | 任务提及的候选来源缺位 | 人工确认书名/版次后补查其 PG 物性表 |
| G8 | A-E 1996 原文 PDF 未下载成功（OSTI/UNT 通道失败）；系数经 ADS 记录 + [S9][S10] 二级源交叉确认，但**原文拟合域（−40…+50 °C）未逐字核对** | 露点公式适用域表述的严谨性 | 人工下载原文（AMS 期刊旧文免费通道或 DOI）核对系数与适用域；35 °C 算例远在安全域内，不影响本 memo 结论 |
| G9 | ASHRAE W 级"适用场景"叙述中 W27 的 500 W CPU / 12 W DIMM 出自白皮书**特定案例配置**（1U 半宽、双 CPU 串联、DIMM 单侧冷板），非等级定义的一部分 | 若按等级通用能力引用会过度承诺 | 计算书中引用时须带案例限定语 |

---

*Memo 编制：曲线库调研 fan-out（工质物性与标准等级分册），2026-10-17。所有数字可经来源列表 URL 复核；分歧与缺口如实登记，未做任何无源补数。*
