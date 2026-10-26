# P1 热阻链求解器 · 敌意评审报告 v0.1（2026-10-19）

评审人立场：外部 reviewer（非共同作者）。对象：`p1-thermal-chain` 首版（solver 0.1.0、
schema p1/v0.1、17 条金向量、演示工况 rack-orv3-thermal.json）。全部结论基于实际运行：
自写**完全独立的参考实现**（`%TEMP%\p1rev\indep*.mjs`，不 import 任何被审代码，Dow LC25
物性表按 memo §1.2 手工重新录入、自有插值/定点/ε-NTU/露点实现）复算全部盲向量数值；
7 组边界攻击工况（e1–e7，仓库外）；CLI 退出码与 `--from-p0` 联动核验。未改动仓库任何
文件（本报告除外）。

## 结论

**有条件放行。** 0 BLOCKER、1 MAJOR、5 MINOR、7 NIT。

MAJOR（M1：物性表域越界只告警不翻旗）违反 solve.ts 自宣的收敛语义
（`converged = 数值有限 + 定点收敛 + 无数据域越界`），e1/e7 实锤：回液 94.9 °C、
TCS 供水 161.2 °C（物性在 60 °C 钳位、已超 LC25 许用 90 °C 与常压沸点 101.4 °C）仍
`converged=true`、exit 0。**任何高温/低流量工况出数前必须修复**；当前演示工况全部
温度在 0–60 °C 域内，不受影响。核心物理全部经独立复算证实正确：三条指定盲算
（12.485249 / 43.7670 与 31.6446281 / ε=0.7734857）我独立推得
12.4852497 / 43.7669990 / 31.644628099 / 0.7734855，偏差 ≤4e-7，**向量数值无一错误**。
ε-NTU 逆流式（含 C_r=1 分支与极限行为）、slope 闭式、能量平衡、Magnus 露点、W 级常数
全部与理论及数据源头一致。17/17 向量全绿且断言非空转。

## 核验通过项（先列正向，均经独立复算或实验）

1. **三条指定盲算独立复算 [PASS]**（我的推导过程，与向量对照）：
   - **blind-node-energy（ΔT=12.485249）**：q=12 L/min=2e-4 m³/s，Q=10 kW，T_in=32。
     初值 ΔT₀=10000/(ρ(32)·q·cp(32))=10000/(1026.76×2e-4×3894)=12.5056 →
     T̄=38.2528 → ρ=1023.4435、cp=3913.01 → C=800.9492 W/K → ΔT₁=12.485187 →
     T̄=38.24259 → ρ=1023.44900、cp=3912.970 → C=800.94512 → **ΔT*=12.4852497**
     （收缩因子 ≈ΔT·(dC/dT̄)/C/2 ≈0.003，4 次收敛）。向量 12.485249，差 7e-7 < tol 1e-5。
     T_case(inlet)=32+0.02×1000=52 精确，裕度 75−52=23 精确。
   - **blind-hx-slope（T_r=43.7670 / T_s=31.6446281）**：S=121 kW/4 K=30.25 kW/K →
     ATD=80000/30250=**2.644628099**，T_s=29+ATD=**31.644628099**（闭式，逐位）。
     机柜定点：q_tot=98.9 L/min=1.6483e-3 m³/s，T̄*=37.7058 → ρ=1023.7389、
     cp=3910.82 → C=6599.37 W/K → **ΔT*=12.1223709 → T_r*=43.7669990**。
     FWS：C_f=1000×(100/60000)×4180=6966.67 → T_fout=**40.483253589** < T_r ✓。
     流量偏离 |98.9/120−1|=17.58% → 落 ±10%~±25% 告警带 ✓。
   - **blind-hx-ua（ε=0.7734857）**：C_f=1000×(21.6/60000)×4180=**1504.8**（C_min）→
     NTU=3000/1504.8=**1.993620415**；定点 T̄*=37.7054 → ρ=1023.73907、cp=3910.8217 →
     C_t=3002.746 → C_r=0.5011413；NTU·(1−C_r)=0.9945347，e^−=0.3698956 →
     ε=(1−0.3698956)/(1−0.5011413×0.3698956)=0.6301044/0.8146300=**0.7734855**
     （向量 0.7734857，差 2.4e-7 < tol 2e-5）；T_hot_in=10+40000/(ε·1504.8)=**44.3660055**；
     T_s=44.3660055−40000/3002.746=**31.0448643**；T_fout=**36.581605529**。
   - 其余数值向量同实现复核：dew(30,70)=23.9304678（γ=1.5798544）、
     dew(35,60)=26.0769341（γ=1.7078300）、theta-mean T̄=38.2426249、
     T_case=58.2426249、wclass 精确整数——全部在容差内。**未发现任何向量数值错误。**
2. **ε-NTU 逆流式及极限 [PASS]**——hx.ts:15–19 与 Incropera 逆流效能式逐字一致；
   C_r=1 分支（|1−C_r|<1e-12 → NTU/(1+NTU)）与主式在 C_r→1 处解析连续（泰勒展开
   (1−C_r) 相消后恰为极限式）；NTU 极大时 exp 欠溢出为 0 → ε=1 正确；C_r>1 不可能
   （cMin/max 构造，hx.ts:62）。**C_r≈1 连续性扫描**（FWS 42.9→43.3 L/min 横跨
   C_tcs）：ε 与 T_s 光滑无跳变（0.50136→0.50014→0.50043），且 e4（C_r=0.9986587）
   求解器与我的独立实现 **13 位小数一致**（ε=0.500283946825…）。但该分支无回归向量（m5）。
3. **slope 模式方向性与自洽 [PASS]**——ATD=TCS 供水−FWS 供水（OCP 口径）与
   hx.jsonc 头注、types.ts:16、schema 口径三方一致；S=末点 kW/K（线性已入口校验）；
   Q=S·ATD 闭式反推 T_s 正确。能量自洽：slope 模式 T_r 由机柜平衡补齐（同一
   Q、同一总流量、同一平均温度区间），HX 热侧 ΔT 与机柜 ΔT 构造性相等。热力学可行性
   检查（solve.ts:206–210，T_fout>T_r 拒绝）在 slope 必要（经验式域外可给出荒谬解，
   blind-fws-capacity 向量锁定 603 °C 案例）、在 ua 构造性成立（我验证：violation ⟺
   ε·C_min>C_fws，仅可能当 C_min=C_fws 且 ε>1，恒假）。
4. **能量平衡 [PASS]**——ΣQ_j=qTotalW 进 HX 构造性守恒；同构支路下 nodes tOut 与
   rack tReturn 一致（向量 equalsPath 锁定）；**异构支路混合近似量化**（e5：5 L/min
   8 kW + 25 L/min 2 kW）：求解器 T_r=37.002165 vs 能量加权混合 37.000274，差
   **1.9 mK**——ρ/c_p 弱变化的混合误差可忽略（但未文档化，见 n11）。
5. **露点/W 级/θ 域 [PASS]**——A-E 1996 系数（17.625/243.04）与 memo §3.1 一致，
   Sonntag 交叉核验存在且实测域内差 ≤0.024 K（60 °C/5%RH 亦仅 0.024 K，断言阈值
   0.15 K 不误报）；W17/27/32/40/45=17/27/32/40/45 与全级下限 2 °C（脚注 a）与
   memo §2 逐值一致；θ 域 splitN 语义（支路流量/N=每板流量）与 cold-plate.jsonc
   Wiwynn 条目 notes（每板 1.5–3.5 L/min、0.014–0.019 °C/W）正确对接，演示工况
   per-plate=12.358/8=1.5448 ∈ [1.5,3.5]。
6. **契约面 [PASS 主体]**——CLI 退出码 0/1/2 与 P0 语义一致（实测：invalid-room-rh
   经 CLI 退 2；e2/e3 数值失败退 1；正常退 0）；inputInvalid（结构/单位/域错误）与
   converged=false（信任红旗：流量带宽、θ 域、零流量、热力学不可行）划分自洽；
   `--from-p0` 用 P0 真实输出（rack-orv3，98.8656 L/min）注入后结果与内嵌 flows 逐位
   一致；合规发现（露点/W 级/T_case）不改 converged，warning 照报——与"方案不合格≠
   算错数"的登记语义一致。
7. **数据纪律 [PASS]**——代码内未发现编造默认数据混入：FWS 物性全部由输入显式给出
   （无默认值）；tCaseMaxC 无默认（缺省不评估）；W 级与露点系数有源（memo §2/§3）；
   slope 曲线点 [[0,0],[2,60.5],[4,121],[6,181.5]] 与 hx.jsonc `hx-vertiv-coolchip-cdu121`
   逐点一致；演示 θ=0.019×1.15 可溯至 cold-plate.jsonc notes；tCaseMaxC=80 在 meta
   自注占位。props 表域 0–60 端点钳位实现正确（props.ts:32）。

## Findings

### [MAJOR] M1 —— 物性表域越界只告警不翻旗：违反自宣收敛语义，高温/低流量工况可"绿灯"出不可信数

- **位置**：solve.ts:261–267（props 域循环只 `warnings.add`，无 `untrusted=true`；且
  `break` 只报首个越界温度）× solve.ts:2 与 types.ts:127（自宣语义
  "converged = 数值有限 + 定点收敛 + **无数据域越界**（信任红旗）"）× props.ts:32
  （0–60 °C 端点钳位）。
- **机理**：节点/机柜 ΔT 与 ua 模式 C_tcs 全部由 ρ(T̄)、c_p(T̄) 计算；T̄>60 °C 时
  props 钳位取 60 °C 值（cp 偏低 ~0.5%、ρ 偏高 ~0.4%），ΔT 系统性偏低 ~0.5%。该
  情形是"数据域越界"的教科书案例（对照：θ 域、hx 流量带宽、曲线域检查全部翻
  untrusted），但此处只出 warning，converged=true、exit 0——下游（cabinet3d 灰化
  逻辑、计算书、proposal）按绿灯采信。同时无 LC25 产品许用上限（90 °C，memo §1.1）
  与常压沸点（101.4 °C）守卫：出流温度物理荒谬（沸腾/变质）仍算"收敛"。
- **复现**（仓库外 `%TEMP%\p1rev`）：
  - e1：given 50 °C + 单节点 4 L/min/12 kW → T_r=**94.86 °C**（超 LC25 许用
    90 °C）、T̄=72.4 °C（props 钳位）→ 告警在、**converged=true、exit 0**；
  - e7：ua UA=300 W/K + 40 kW → TCS 供水 **161.2 °C**、回液 171.2 °C（远超沸点
    101.4 °C）→ 仅 props 域告警，**converged=true、exit 0**。数值本身与我的独立
    实现逐位一致（161.230377/171.200263）——错不在算术，在信任语义。
- **触发面**：W40/W45 高供液 + 大 ΔT、低流量调试工况、ua 欠选型（UA 过小）。演示
  工况（T̄=37.7 °C）不触发。
- **修法**：(a) solve.ts:263 命中即 `untrusted=true`（一行，语义即与自宣一致）；
  (b) 去掉 `break`，逐个报或聚合报（max 越界温度）；(c) 加许用/沸腾守卫：
  任意 TCS 点温度 >90 °C（许用）或 >101.4 °C（沸点）→ untrusted + 明确文案；
  (d) 回归向量：e1/e7 期望 converged=false。

### [MINOR] m2 —— ua 模式零流量退化路径：0/0→NaN→误导性"物性表异常"，全零工况本可平凡求解

- **位置**：hx.ts:56–73（cTcs=0 → cMin=0 → NTU=∞ → ε=1 → tHotIn=T_f+qW/0；qW=0 时
  0/0=NaN，qW>0 时 ∞−∞=NaN；100 次后 return null）× solve.ts:169–171（null →
  "hx ua 模式定点未收敛（物性表异常）" → fail() 全 null 输出、nodes=[]）。
- **复现**：e2（q=0、Q=0、ua）→ exit 1、"物性表异常"；e3（q=0、Q=6 kW、ua）→ 同。
  对照 slope 模式相同输入走 solve.ts:199 的"过热无解"正确文案。e2 的物理答案平凡
  （零流量零负荷：T_s=T_f，无可算内容），报数值失败属误分类；e3 该报"零流量带载"。
- **修法**：ua 分支前移零流量检查（与 slope 对称）：qTot≤0 且 qW=0 → 平凡解直通；
  qTot≤0 且 qW>0 → "零流量带载：过热无解"。hxUa 亦可入口短路返回明确错误类型。

### [MINOR] m3 —— ±10%/±25% 斜率流量带宽的"登记"引用失实：guarantee-interface §3 并无此内容

- **位置**：solve.ts:5（"登记假设（guarantee-interface §3）：hx 斜率流量带宽 ±10%
  告警 / ±25% 不可信"）与 solve.ts:16–18（常量 10/25）× docs/guarantee-interface.md
  §3（35–42 行，仅 3 个占位参数，无任何带宽字样；全文唯一"±10%"是 §6 敏感性表要求）。
- **问题**：±10%/±25% 是会把 converged 翻 false 的策略数，实际只存在于代码注释、
  告警文案、向量 note 与 test-case meta——**承诺契约里没有登记，引用指向落空**。
  数值本身在各处一致（10/25、17.6%），无漂移；缺的是契约登记与出处（这两个数是
  工程判断，无外部来源）。
- **修法**：把带宽写进 guarantee-interface §3（或独立假设登记表：数值、依据、生效
  版本），修正 solve.ts:5 引用；向量 note 引用同步。

### [MINOR] m4 —— README 的 P1 范围与实现缺口未登记：capture（液体捕获比）、T_fluid_max、最小流量、室内排热

- **位置**：README.md:17（"TDP + **capture** → 冷板 → 冷却液温升 → CDU 换热 →
  **35 °C 室内排热**"）与 README.md:29–31（热包络四要素：θ、T_case_max、
  **T_fluid_max**、**最小流量**）× types.ts（HotSpot 无 tFluidMaxC、无 min-flow 字段；
  P1Case 无 capture/液体占比字段；room 仅用于露点，无排热模型）。
- **问题**：实现是"Q 全进液体"（types.ts:10 有注释、演示工况按 10 kW/节点全额），
  与 OCP ACS 口径"冷板带走 70–75%"（cold-plate.jsonc notes 转录）相差最多 ~30%
  的 TCS 侧温升——保守方向可辩护，但 README 明示 capture 是 P1 输入而 v0.1 无此
  旋钮、也无任何"未实现"登记；T_fluid_max（冷板厂商最高进液温度）与最小流量阈值
  （cold-plate.jsonc 有专门 redlight 条目）同样缺席。客户拿 README 对照交付物会对不上。
- **修法**：在 types.ts 头注与 README 状态列登记 v0.1 范围缺口清单；下一版加
  `capturePct`（默认 1.0、告警提示保守性）与 `tFluidMaxC`/`minLpm` 保证字段（后者
  与 θ 域检查共用流量）。

### [MINOR] m5 —— 向量覆盖缺口：ε-NTU C_r=1 分支、props 域越界、ua 失败路径、异构支路、invalid 分类均无回归锚

- **位置**：vectors/（17 条）× vectors.ts:70–72（`lessThan` 无任何向量使用，死代码）。
- **缺口清单**：(a) **C_r=1 分支**（hx.ts:16）从未被 CI 触发——e4 证明实现正确，但
  换人有回归风险；(b) **props 域越界**（M1）无向量锁定语义；(c) **ua 失败路径**（m2）
  无向量；(d) **异构多支路**（不同 q/Q 的能量与混合）无向量——现有 equalsPath 只在
  同构支路上验证 tOut==tReturn；(e) Q=0+slope 平凡解、given 负温（<0 °C 钳位）无
  向量；(f) invalid-* 三条只借 `warningIncludes`+`expectConverged:false` 断言，
  **未锁 inputInvalid 数组与 CLI exit 2 分类**（本次手工验证通过，CI 无锚）。
- **修法**：按上列补 6 类向量；invalid-* 增 `inputInvalid` 内容断言（vectors.ts 加
  `inputInvalidIncludes` 检查种类或直接断 `inputInvalid.length>0`）。

### [MINOR] m6 —— 输出无收敛残差/迭代数审计面：guarantee §6.1 的 residual 判据在 P1 无对应字段

- **位置**：types.ts:125–144（P1Output 无 residual/iter 字段）× docs/guarantee-interface.md
  §6.1（"solver.residual < 1e-8 且 NaN 守卫通过"）× 对照 P0（residual 是输出字段与
  承诺参数）。
- **问题**：P1 定点在 3–5 次内确定性收敛到 1e-12（我按收缩因子 ~0.003 复算一致），
  数值上无风险；但"converged"是黑盒布尔，审计/对拍（如未来 Rust 孪生、bench/wasm
  双引擎位级对比）没有可比较的量化收敛证据，验收判据 §6.1 在 P1 语境落空。
- **修法**：P1Output 增加 `maxFixedPointStep`（最后定点步差）或 iter 计数；或在
  guarantee-interface §6 写明 P1 等价判据（"定点末步差 ≤1e-12·max(1,|·|)"）。

### [NIT] n7 —— 两条向量 note 的手算记录有小错（不影响断言值）

blind-hx-slope.json:3 note 称偏离"17.4%"，实际 |98.9/120−1|=17.58%→17.6%（CLI/告警
与 test-case meta 均正确显示 17.6%）；blind-node-energy.json:3 note 的迭代标签混乱
（"iter1 T̄=38.2426"用的是收敛后的 ΔT/2，真实序列 12.5056→12.4852→12.4852）。
盲算的意义在可独立复算，note 应忠实记录推导链。建议勘误。

### [NIT] n8 —— room.tAirC 无 Magnus 拟合域检查

dew.ts:3 自述 A-E 拟合域 −40…+50 °C（memo G8），validateInput（solve.ts:117）对
tAirC 无范围检查：e6（60 °C/5%RH）给出露点 7.01 °C、零告警。实测该点 Sonntag 交叉
差仅 0.024 K（不触发 0.15 K 断言），风险低。建议 tAirC 出 [−40,+50] 时告警"超出
A-E 拟合域"。

### [NIT] n9 —— 输入一致性小缺口：hotSpot.qW 与 load.qW、fws.supplyC 无交叉/范围检查

solve.ts:103 允许 hotSpot.qW > 节点 qW（物理矛盾：单 die 热点功率超过节点总负荷），
fws.supplyC 任意有限值均接受（−5 °C 或 200 °C 无告警）。建议 hotSpot.qW>qW 告警、
fws.supplyC 出 [2,60] 提示。

### [NIT] n10 —— --from-p0 不校验 P0 输出的 converged/schema/versions

cli.ts:38–46：只查 branches 数组存在即注入。注入未收敛 P0 的 NaN 流量会被下游
validateInput 兜住（退 2），但垃圾而有限的流量会静默通过；cabinet3d-interface §2
要求消费者核对 versions——CLI 作为消费者未核对。建议检查 `p0.converged` 与
`p0-out/v0.1` schema，不符退 2。

### [NIT] n11 —— 机柜混合近似未文档化（量化：~2 mK）

rack ΔT 用聚合口径（总流量 + 机柜平均温度物性，solve.ts:190/thermal.ts），支路各自
用支路平均物性；异构支路下两者与能量加权混合的差实测 1.9 mK（e5）——可忽略，但
types.ts/thermal.ts 未说明该近似口径。建议 thermal.ts 头注补一句。

### [NIT] n12 —— given 模式 W 级查 TCS 供水的"从严"口径易误读

solve.ts:292–304/types.ts:86 已文档化（hx→FWS、given→TCS），但 given 模式下 FWS=27
（W27 合规）+ ATD=2 → TCS=29 会判 wClassPass=false 且无解释性告警。建议 given 模式
输出附一句"无设施信息按 TCS 从严"的提示。

### [NIT] n13 —— FWS 物性溯源强度不足（演示可、报价前须换）

向量与演示工况用 cp=4180/ρ=1000，note 仅"Incropera Table A.6 量级"（A.6 水 @300K
实为 997/4182）。输入侧登记、责任在作者，符合"无源不入库"的字面；但作为露点/W 级
承诺计算的一次侧容量输入，正式报价前应登记精确值与温度点。

## 加固建议（优先级序）

1. **M1**：props 域命中翻 untrusted + 去 break + 许用/沸点守卫 + e1/e7 回归向量
   （半天工作量，出数前必修）。
2. **m2**：ua 零流量对称处理（与 slope 同文案）。
3. **m3**：±10%/±25% 写入 guarantee-interface §3 或假设登记表，修正引用。
4. **m5**：补 6 类向量（C_r=1、props 域、ua 失败、异构支路、平凡解、invalid 分类断言）。
5. **m4/m6**：v0.1 范围缺口登记（capture/T_fluid_max/min-flow/室内排热）+ 输出补
   收敛审计字段。
6. n7–n13 顺手清。

## 统计

- Findings：**0 BLOCKER / 1 MAJOR（M1）/ 5 MINOR（m2 ua 零流量、m3 带宽登记失实、
  m4 范围缺口未登记、m5 向量覆盖、m6 残差审计面）/ 7 NIT**。
- 回归面：`p1 vectors` 17/17 exit 0；演示工况 rack-orv3-thermal 80 kW、供液
  31.64→回液 43.77（ΔT 12.13 K）、T_case 59.0 °C（裕度 +21.0 K）、露点 26.08/
  裕度 5.57 K、W32 检查 29.0 °C 通过、exit 0；`--from-p0` 联动逐位一致。
- 数值一致性：17 条向量全部数值断言经完全独立参考实现复算吻合（三条指定盲算偏差
  ≤4e-7，e4/e7 与求解器 12–13 位一致）；ε-NTU C_r=1 连续性扫描无跳变；异构混合
  差 1.9 mK。
- 实验环境：Node v24.21.0；独立脚本与边界工况位于仓库外 `%TEMP%\p1rev`
  （indep.mjs/indep2.mjs + e1–e7）。

## 修复记录（2026-10-19，solver 0.2.0）

全部 findings 已修复并回归：M1（物性域/许用/沸点越界翻 untrusted + 聚合报告）、
m2（ua 零流量对称前置拦截 + 零负荷平凡解）、m3（带宽与全部策略数登记进
guarantee-interface §3.2 假设登记表）、m4（capturePct 参数化落地 + §3.3 缺口登记 +
README 状态更新）、m5（补 6 类向量：近 C_r=1/props 域/ua 零流量/全零平凡/异构支路/
capture；invalid-* 改断 inputInvalidIncludes）、m6（输出加 maxFixedPointStep，§6.1
P1 等价判据）、n7（向量 note 勘误）、n8（A-E 域告警）、n9（hotSpot.qW≤qW 校验 +
FWS 水温范围提示）、n10（--from-p0 校验 schema/converged）、n11（thermal.ts 头注
登记混合近似 ~2 mK）、n12（given 模式 W 级从严口径提示）、n13（fws.note 必填）。
向量 23/23 绿（新增 6 条手算盲值一次通过），演示工况与 P0 19/19 回归不变。
