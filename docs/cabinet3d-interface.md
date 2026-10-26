# Cabinet3D 数据驱动接口规范 v0.1（2026-10-18）

> 定位：official-site / configurator 的 three.js 机柜视图（Cabinet3D）从"营销装配动画"
> 升级为**求解器输出的视图**。本文件定义 P0Output JSON → 3D 场景的映射契约，
> official-site 侧按此对接，两仓只通过这个接口耦合。
>
> 铁律：**3D 层不做任何物理**。所有数字、颜色阈值、动画速度都由求解器输出派生，
> 3D 层只做视觉编码。好看的每一帧都必须能追溯到 p0-out JSON 的某个字段。

## 1. 数据流

```
configurator 交互（拖负载/房间条件/关断支路）
  → 组装 P0Input JSON（Nuxt 侧组装器）
  → solve(input)            ← @liquid/p0-hydraulics 直接 import，浏览器内 165 µs/次
  → P0Output JSON
  → Cabinet3D 映射层（本规范）→ three.js 场景更新
```

- 同一份求解器包服务 Web/后端/Worker（README 技术栈），3D 看到的数字 = 合同数字。
- 求解频率：交互事件驱动 + 节流（60fps 预算下求解耗时占比 <0.1%，无需 worker）。

## 2. 消费契约

- 输入：`P0Output`（schema `p0-out/v0.1`）+ 场景元数据（机柜几何、支路槽位顺序）。
- **必须消费 `versions` 做版本对齐**：solver/props/dataVersion 任一不匹配映射层支持范围 → 显示"版本不支持"，禁止静默渲染。
- `converged=false` → 整柜渲染为"不可承诺"态（灰化 + 警示角标），可展示 warnings 列表，**禁止**对未收敛输出做正常着色。

## 3. 场景实体映射表

| 3D 实体 | 数据源字段 | 视觉编码 |
|---|---|---|
| CDU 泵组 | `qTotalLpm`, `pumpDpKPa`, `pumpHeadM`, `pumpHz` | 读数牌（4 值）；泵叶轮动画速度 ∝ `pumpHz/maxHz` |
| 供液集管 | — | 静态几何 |
| 支路 i 管路 | `branches[i].qLpm` | 管径视觉粗细 ∝ q/q_ref；**流粒/流光动画速度 ∝ qLpm**（归一化：v = q / max(q)） |
| 支路 i 配色 | `branches[i].minMarginLpm` | margin ≥ +Δ 绿；0..+Δ 琥珀；<0 红（Δ=2 L/min，展示层常数，写死在此并注明非承诺值） |
| 节点 i 盒体 | `branches[i].qLpm`, `sharePct` | 盒面读数 q + share；margin 徽标同支路配色 |
| 关断支路 | `branches[i].shutdown` | 灰化 + 虚线 + "OFF"标签，无动画 |
| 整柜状态条 | `residual`, `converged`, `warnings[]` | 收敛徽标；warnings 计数角标，点击展开 |
| 堵塞情景 | 输入侧 `case.filterDpKPa` | 滤网器件变色 + 压差读数 |

## 4. P1 预留（本版不实现，字段占位）

| 实体 | 未来数据源 | 编码 |
|---|---|---|
| 供/回液温度着色 | `rack.t_supply_max`, 供回温度 | 蓝→红渐变（色标固定） |
| 露点裕度 | `margin.dewpoint` | 独立警示灯（<2 K 闪烁） |
| 芯片热裕度 | `chip.t_case_margin` | 节点盒第二徽标 |

## 5. 禁止事项（映射层红线）

1. 禁止在 3D 层计算任何物理量（压降、压降换算、流量估计）——一切来自 JSON；
2. 禁止缓存跨版本输出（版本变了必须整场重渲染）；
3. 禁止对 null/NaN 字段渲染数值（fail path 输出只进"不可承诺"态）；
4. 展示层常数（配色阈值 Δ、归一化基准）只能来自本文件，不得散落组件里。

## 6. 版本与变更

- 本规范 semver；`p0-out` schema 升 minor 时映射层必须同步并升 minor。
- 变更记录：v0.1（2026-10-18）首版，覆盖 P0 水力全字段 + P1 占位。
- **v0.2（2026-10-19）映射层落地 official-site**：`utils/simMap.ts` 实现本规范 §2/§3 全部
  P0 编码 + §4 P1 占位三实体（供回温度着色[固定色标 15/30/45 °C]、露点警示灯[<2 K 闪烁]、
  T_case 裕度徽标数据）；Cabinet3D 组件接收 `sim` prop 进入数据模式（无 prop 保持营销模式）。
  求解器以 vendored 纯函数进驻 `official-site/sim/`（`official-site/scripts/vendor-from-simulation.ts`
  分发——2026-10-26 自本仓 p0-hydraulics/scripts/ 迁出，消费者拥有分发工具；+ MANIFEST 版本登记 +
  逐位 parity 对拍：rack-orv3 工况对 + P1 全 23 向量输入）。
  组装器 `utils/simRack.ts`（wizard→P0Input/P1Input，假设登记见文件头注）；
  服务端同源入口 `functions/api/simulate.ts`（POST wizard 状态→P0+P1+view）。
