# 器件曲线库 schema 与数据政策

中台仿真的输入。规则沿用 guide-site 选品器已验证的**英维克模式**：
无源不入库、未公开规格亮红灯列欠账、绝不编数。

## 每条记录必填字段

```jsonc
{
  "id": "pump-xcdu-240v",            // 库内唯一 id
  "type": "pump",                     // pump | cold-plate | qd | manifold | hx | fan | dx-unit
  "vendor": "…", "model": "…",
  "fluid": { "basis": "PG25 @ 25°C" },// 曲线的工质基准，必须写明（PG25/水/乙二醇浓度+温度）
  "curve": {
    "x": "L/min",                     // 自变量单位
    "y": "kPa",                       // 因变量：泵=扬程/压升@流量；冷板/QD/manifold=ΔP@流量
    "points": [[0, 320], [20, 300], [40, 250], [60, 180]]   // 单调或单峰，≥3 点
  },
  "source": {
    "url": "https://…",               // 必填，可追溯
    "type": "datasheet | literature | ocp-spec | measured", // measured 仅限自家 commissioning 数据
    "retrieved": "2026-10-16"
  },
  "uncertainty": "datasheet 单点插值，未见误差带",  // 必填，一句话说清可信度
  "redlight": null                    // 数据缺口占位时为 "缺 XX 曲线"，且 curve 必须为 null
}
```

## 曲线单位文法（2026-10-17 增补：换热器数据落地后按域定义）

单位必须是下方规范 token（机器校验），工况条件进结构化字段，禁止揉进单位字符串：

| 域 | type | curve.x | curve.y | 必填字段 |
|---|---|---|---|---|
| 水力 | pump / cold-plate / qd / manifold | `L/min` | `kPa`（泵可用 `m`） | — |
| 热 | hx | `°C`（ATD，OCP 口径=TCS供水−FWS供水） | `kW` | `curve.flowBasis`（哪侧、多大流量下的换热量曲线） |
| 风 | fan / dx-unit | 待首批数据落地时定义 | — | — |

## 数据政策

1. **无 `source.url` 一律不入库**。口口相传的"大概值"不允许。
2. 只有单点（如 datasheet 只给额定流量下 ΔP）→ 用该点 + 同类器件曲线族形状插值，
   `uncertainty` 里必须写明"形状借自同类，绝对值有据"。
3. 完全无数据 → 记 `redlight` 占位条目，`curve: null`，进欠账表。仿真输出中
   该器件参与的结果必须标注"未验证"。
4. `measured` 类型只有一种合法来源：我们交付柜的 commissioning 遥测（V&V 第 3 层）。
5. 工质基准不明的曲线（常见坑：厂商曲线是纯水 20 °C，我们跑 PG25）不得直接使用，
   按 PG25 黏度修正后另立条目，注明修正方法。

## 优先采集清单（P0 启动前必须到位）

- [ ] 机柜 CDU 泵 P-Q 曲线（候选：在售 L2A/L2L in-rack CDU，≥2 家）
- [ ] ORv3 manifold 支路 ΔP（首选 OCP 冷板/manifold 规格文档）
- [ ] UQD (UQD06/UQD04) 插拔对 ΔP 曲线（Staubli/DNP 公开数据）
- [ ] 主流 8 卡液冷服务器的冷板组需水量 + ΔP 限值（NVIDIA HGX/DGX 设计指南、
      OCP cold plate spec）
- [ ] CDU 换热器 ε-NTU 或 K·A 值（多数厂商不公开 → 预期首批红灯欠账）
