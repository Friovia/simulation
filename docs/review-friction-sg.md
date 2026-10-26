# 合并评审：Churchill 切换 + SG 1.026/1.0334 统一（2026-10-20）

> 评审对象：P0 摩擦式默认链（层流 64/Re → 2300–4000 线性内插 → Haaland）vs Churchill (1977) 全域单式；
> PG25 修正批次 SG 1.026（早期）vs 1.0334（canonical）。两议题都动数值基线，合并一轮评审闭合。
> 关联材料：docs/friction-churchill-compare.md（2026-10-19 对拍）、add-pg25-variants.ts 头注。

## 议题一：Churchill 切换——裁定：维持现行链，新增过渡带运行告警

### 论据（对拍已有 + 本轮新增场景核实）

1. 湍流区（Re≥6000）两式差 <2%（光滑管 0.2–0.4%），在曲线库 ±15% 不确定度内是零头；机柜管路主工况 Re 1e4–1e5 落此区。
2. **过渡带场景真实性（本轮核实）**：rack-orv3 支路（19.1mm 内径、PG25 @35°C，ν=1.736e-6 m²/s）——
   - 3 LPM/支路 → Re≈1920（层流上界）
   - 5 LPM/支路 → Re≈3200（**过渡带**）
   - 8 LPM/支路 → Re≈5119（湍流）
   
   即轻载柜（支路 <5 LPM）与 P2 瞬态泵启停低流量段**确实会进入过渡带**，该区两式差 20–25%。
3. 但该区实验散布本身 ±20–30%（临界 Re 随入口条件漂移，两式各有文献依据）——切换不产生可分辨的精度收益，而成本是 major 变更（全部金向量重算 + parity 链重建）。
4. 裁定：**维持现行链**（M1 评审已锁定的内插连续性修复有效）；Churchill 实现保留为对拍基准（F19 升级候选冻结）。

### Actionable（已落地）

- **P0 过渡带告警**：solve 输出新增——支路 Re 落 [2300, 4000] 时 warning 提示摩擦式不确定度 ±25% 级、压降按保守区间解读（`p0-hydraulics/src/solve.ts`）。
- 金向量锁定：`vectors/blind-transition-warning.json`（19.1mm 支路 5.6 LPM → Re≈3750 → 告警触发 + converged）。**P0 20/20 绿**。
- 语义：过渡带告警是**合规发现**（不翻 converged）——数字仍可信（内插连续），不确定度扩大是解读边界。

## 议题二：SG 1.026 → 1.0334 统一——裁定：执行回改（已落地）

### 依据

- canonical：SG = ρ(DOWFROST LC25, 25°C)/ρ(水, 25°C) = 1030.3/997.0 = **1.03340**（fluids-and-standards.md §1.2 主表 A）
- 早期批次 1.026 = ρ(PG25,25°C)/ρ(水,20°C) = 1.024/0.998（不同水温基准的比值——口径混用）
- 差 0.72%，在 ±15% 曲线不确定度内；但"暂不回改"状态违反单一 canonical 原则，本次评审闭合。

### 执行记录（2026-10-20）

| 条目 | 修正 | shut-off 变化 |
|---|---|---|
| pump-vertiv-coolchip100kw-inrack-pg25 | points ×1.00721 | 148 → 149.0675 kPa |
| pump-motivair-mcdu25-pg25 | points ×1.00721 | 327 → 329.3585 kPa |
| rack-orv3.json 模板（CDU121 demo） | 同步 | — |

### 影响面

- **60 金向量零影响**（P0 向量全部用内置合成曲线，不引用库泵条目——grep 核实）
- demo/chain/计算书输出、official-site smoke 中/重载档数字 ~+0.7%（泵压升微升）——非承诺参数级变化，chain exit 0 复验
- add-pg25-variants.ts 头注的"已知不一致"条目就此注销

## 附：同批关联变更（政策记录）

- **CDU40 泵曲线数字化转正**（pump-nvent-cdu40 / -max，红灯解除）：政策修订——矢量渲染 PDF 曲线可数字化入库，须 ①tick 反验标定 ②量化读图误差 ③锚点交叉验证三件套（本次：8 tick 全对齐 ±1 LPM；读图误差 ±1 psi/±3%；Max 线 60 LPM@6.2 psi 对规格锚点 7 psi）。方法学与 bypass 限制登记于条目 uncertainty。
- 20 psi bypass 限制：CDU40 曲线 <26 LPM（Default）/<33 LPM（Max）段为泵本体能力，运行时受旁通调制——P0 求解落在该段结果偏乐观，条目已登记。

## 放行

- 向量：P0 20/20（+1 过渡带）、P1 23/23、P2 7/7、P3 11/11 = **61/61 绿**
- validate-data：80 条全过（pumps +2 数字化 +2 PG25 变体）
- chain exit 0；vendor parity 逐位；双仓 tsc strict 0 错
- 结论：**两项裁定闭合，无遗留 findings**
