# P0 水力求解器 · 二轮敌意评审报告 v2.0（2026-10-19）

评审人立场：外部 reviewer（非共同作者）。对象：放行提交 ea4dd82 之后的两个提交（`git diff ea4dd82..HEAD`）——①Illinois 重构（p0-hydraulics/src/solve.ts，宣称 53× 提速）；②p0 sweep（src/sweep.ts + src/cli.ts 接线）；③qd.jsonc PG25 修正条目（scripts/add-qd-pg25.ts 生成）；④第二批盲算向量 10 条（vectors/blind-*.json）。全部结论基于实际运行：约 40 组实验（新旧对拍、独立参考实现、闭式解直算、应力电池），复现脚本与输入放在仓库外 `%TEMP%\p0v2`，未改动仓库任何文件（本报告除外）。历史发现编号沿用 docs/review-p0-v0.1.md（F*）与 docs/review-p0-v1.0-recheck.md（N*）。

## 结论

**放行。** 0 BLOCKER、1 MAJOR、3 MINOR、5 NIT。MAJOR（M1：Re=2300 摩擦系数跳变下静默假收敛）**不是本轮 diff 引入**——已用 ea4dd82 原版求解器逐位复现同样的假收敛（新旧行为完全一致）——但本轮受命的"假收敛猎捕"实验首次实锤了它，且违反本项目 F4 确立的"输出不可信就不允许出数"哲学，应列为下一批最高优先修复项，并在任何依赖纯管路/低流量支路结论的 P1 工作前修掉。本轮 diff 本身质量过硬：Illinois 内外层方向与减半记账经代码审 + 300 例随机新旧对拍（converged 标志 0 分歧、双收敛例 |Δq|≤9.4e-14）+ 折点/凸/锯齿应力电池全部与独立参考吻合；10 条盲向量经完全独立的双层二分参考实现与闭式解直算全部逐位吻合（偏差 ≤4.3e-16）；qd PG25 修正 9 条算术逐点精确、幂等、redlight 正确跳过；sweep 保形性与聚合语义正确。实测提速 41×（宣称 53×，同量级）。

## 核验通过项（先列正向，均经实验）

1. **Illinois 方向正确性 [PASS]**——内层 dp(q)−P 递增：fx>0 → hi=x（solve.ts:137–141）；外层 g(P) 递减：fx>0 → lo=x（solve.ts:245–250，注释自觉标注"与内层相反"）。同侧保留时的减半条件：内外层均在"另一端连续两次被保留"时把**滞留端**的留存函数值减半（内层 side===1 → flo×0.5、side===−1 → fhi×0.5；外层对称），这是标准 Illinois 记账，正确。割线值 `Math.min(hi, Math.max(lo, m))` 钳位防浮点出界。实验证据：斜率比 1e-6:2 的膝点根、q⁴ 与 e^(q/4) 凸曲线、30 段交替锯齿曲线全部收敛到独立二分参考（真失衡 ≤1e-12 kPa）；分段线性函数下割线一旦括入根所在段即精确命中，这是对拍 300 例 0 分歧的根本原因。
2. **早退分支的暴露性 [PASS]**——`fhi<=0 → return hi=qMax`（solve.ts:129）的饱和值必然超出曲线域 1.5×，被上界域检查（solve.ts:294–304）捕获：实测支路域 [0,10] 例 q=15 → `converged=false` + 越界告警 + exit 1；纯管路支路（无曲线可查）由泵域检查兜底（实测 q=360 > 泵域 200 → 告警）。`flo>=0 → return 0` 与钳位插值语义自洽（见 m3 的静默性问题）。
3. **新旧数值一致性 [PASS]**——300 个随机工况（支路数 1–4、随机斜率/管路/干管/变频/m-kPa 泵/过滤器/关断混合）：converged 标志分歧 0 例；163 例双收敛的 |Δq|≤9.4e-14、|ΔpumpDp|≤1.2e-13。rack-orv3（98.9 L/min/126.5 kPa）与 rack-demo（321.8/160.4）逐位一致。旧版跑 19 向量 18/19，唯一失败即 blind-domain-edge（语义故意翻转，见 m1）。
4. **盲算向量 [PASS]**——自写完全独立的双层二分参考实现（不 import 任何被审代码）重算全部 13 条 blind-* 向量的全部数值断言：偏差 ≤4.3e-16。指定 3 条闭式解手推复核吻合：blind-head-m（c=ρg/1000=10.05377758，q*=A/(B+m)=100.42975841，P*=160.68761346，pumpHeadM 双路径 15.98280966）、blind-vfd（scale²·(A−B·q/scale) 展开为 98−0.28q，q*=100 精确）、blind-supply-pipe（Hagen–Poiseuille s=2×128μL/(πD⁴·6e7)=0.47752247 kPa/(L/min)，q*=2.25915656，Re=1840.8 层流前提成立，干管耗散 1.0788 kPa 恒等互验）。ρ=1025.2、μ=1.78 mPa·s 均与 data/fluids-and-standards.md §1.2 主表 A @35°C 一致。
5. **qd.jsonc PG25 修正 [PASS]**——9 条 -pg25 条目逐点 = 水基准 ×SG（SG=1030.3/997.0=1.0334002）舍入到 4 位小数，0 算术错误；抽查 3 条手算：Stäubli UQD04（3.3→3.4102、9.1→9.4039、15.1→15.6043、26.2→27.0751、36.4→37.6158）、Stäubli UQD06（1.9→1.9635 … 30.3→31.312）、OCP UQD06 包络（2.5→2.5835、12.8→13.2275、22.4→23.1482、39.8→41.1293）全部正确。id 全库唯一（20 条无重复）；2 条 redlight（qd-cpc-everis-uqd06、qd-dnp）正确跳过；生成脚本幂等（`/-pg25$/` 跳过）且用文本插入保留 JSONC 注释。`validate-data`：60 条 0 issue。rack-orv3.json 内嵌三条曲线（泵/冷板/QD）与库条目逐点一致；dataVersion "component-curves@2026-10-17-pg25qd" 与内容相符（但见 n2）。
6. **sweep [PASS 主体]**——±10% 泵/支路扰动为 y 等比缩放，正缩放保严格单调，扰动后输入全部通过 validateInput（保形）；温度 ±5°C 语义正确（供、回水同移 ±5 → 均值 ±5，实测 32/42 → 27/37 与 37/47）；minMargin 聚合取活动支路 min（关断支路剔除），全 null → null，混合取数值；干管 K 行仅在 supplyPipe 存在时生成（rack-orv3 9 行、无干管工况 7 行）；全行收敛 → exit 0。
7. **回归面 [PASS]**——`p0 vectors` 19/19 exit 0；`p0 solve rack-orv3` 98.9 L/min、12.4/支路、residual 1.15e-16、exit 0；`p0 sweep rack-orv3` 9 行全 ✓ exit 0；`validate-data` 60 条全过 exit 0。recheck N1（vectors 坏目录退 2）确认已修。

## Findings

### [MAJOR] M1 —— Re=2300 摩擦系数跳变 → 静默假收敛（residual 达标但支路方程不满足，dp 字段失义）

- **位置**：friction.ts:5–11（`RE_LAMINAR=2300` 处层流 64/Re 与 Haaland 硬切换，f 从 0.02783 跳到 0.04943，+78%）× solve.ts:122–150（内层对不连续函数无根时返回跳变点，无任何告警）× solve.ts:284（residual = |泵侧−(p*+2×干管)|/泵侧，**只证明泵侧平衡**；支路侧 dp(q̃)=p* 仅在内层找到真根时构造性成立）。
- **机理**：支路压降在 q(Re=2300) 处跳变（下例 6.99→12.29 kPa）。当泵扬程落在跳变区间内，内层方程 dp(q)=p* **无根**，false position 括号从两侧塌缩到跳变点，返回 q 钉死在 1.881830；外层随即在"qSum=常数"上解出 p*=泵(q钉死)，residual 构造性为 0 → converged=true、warnings 空。报告的支路工作点 (q=1.8818, dpKPa=7.41) 落在支路曲线跳变间隙里，**左右两侧极限都不满足**（6.99 / 12.29 kPa）；且泵扬程从 7.5 扫到 12 kPa 整段流量纹丝不动（dQ/dpump=0，物理上荒谬——真实过渡区是渐变的）。
- **复现**（仓库外 `%TEMP%\p0v2\re2300.json`）：
  ```json
  {"schema":"p0/v0.1","case":{"tSupplyC":30,"tReturnC":40,"pump":{"curveId":"p","yIs":"kPa"},
    "branches":[{"id":"b","curveIds":[],"pipe":{"dMm":10,"lenM":30,"k":2}}]},
    "curves":{"p":{"x":"L/min","y":"kPa","points":[[0,7.5],[60,4.5],[120,1.5]]}}}
  ```
  `p0 solve --in re2300.json` → `converged=true`、residual≈0、q=1.8818、支路 ΔP=7.4059 kPa；独立评估支路 dp 左/右极限 6.9874/12.2863 kPa。A=7.5…8.5 全带同样假收敛（泵曲线首点 7.5/8/8.5 三例均 q=1.881830）。
- **归属**：**非本轮引入**——ea4dd82 旧二分在同输入下输出逐位相同（q、p*、converged 全同，实测）。旧定长二分对不连续函数同样塌缩到跳变点。但本轮是首次被发现，且与 F4 哲学正面冲突。
- **触发面**：纯管路支路（或管路主导）+ 工作点恰在层流↔湍流过渡（D=10mm 时 q≈1.88 L/min）。机架主流工况（19.1mm、12 L/min，Re≈8000）不触发；但调试/低流量整定场景可达。
- **修法**（三层，任一即消除静默）：(a) 过渡区混合摩擦系数——Re∈[2000,4000] 线性过渡或直接 Churchill 全域式，消除 +78% 的人为跳变（真实 Moody 过渡连续）；(b) 收敛门加入支路侧平衡：`max_b |dp_b(q̃_b) − p*| / p*` 超阈值（如 1e-6）即 converged=false——该守卫同时兜住 m3 的 q=0 早退失配；(c) 内层最终括号两端函数值同号且量级非小（无根钉死特征）时出告警"工作点钉死在模型间断点"。

### [MINOR] m1 —— 域边界误拒带（宽 ~1e-4，含严格域内根）；语义翻转未回写契约

- **位置**：solve.ts:299（`qLpm > cMax` 无容差带）× vectors/blind-domain-edge.json:3（v3 note）+ :61–103（把该行为锁进 CI）。
- **事实**：支路曲线 [[0,0],[10,10],[20,20]]、泵 A−0.5q、真根 20−δ 扫描：δ≥1e-3 域内根正常收敛（残差 0、精确）；**δ≤1e-4 起（含真根恰在端点、乃至域内 19.9999）一律 converged=false + 越界告警**——Illinois 在"根=xMax 折点+域外平坦钳位"下线性收敛、终点落在域外 ~1e-4 处（实测报告值 20.000073510 / 20.000099981）。旧二分在同输入下 q=20 精确、converged=true——**v1.0-recheck F4 明文"闭区间端点属域内、非越界"，本轮语义翻转只记录在向量 note 里，guarantee-interface.md 与 F4 复审结论未同步更新**。
- **正当性评估**：对 blind-domain-edge 本身（根恰在端点）保守拒绝可以辩护——真实数据根恰落曲线端点是设计告警点；但误拒带延伸进域内 1e-4 是数值伪影而非语义（Brent 或吸附处理会改变带宽），且向量用 tol=1e-4 锁定的是实现噪声值（20.0001）而非物理量。"合法工作点被误拒"的客户场景=设计点在曲线末端 1e-4 以内——量级 5 ppm，物理影响可忽略，但 exit 1 + "输出不可信"的措辞对这种情形是误报。
- **修法**：域检查加容差带（如 `q > cMax + 1e-6·qMax` 才拒）；内层最终括号跨 cMax 且宽度 <ε 时吸附 q=cMax（闭区间语义）；同步在 guarantee-interface.md 写明边界语义；向量数值断言改锁物理量（20）并期望 converged=true + 专项告警（或保留 false 但把容差带写进契约）。

### [MINOR] m2 —— sweep 的无效输入契约违反：未捕获 TypeError 崩溃 + 退出码 1≠2

- **位置**：sweep.ts:36（`v.curves[pumpId].points` 在 validate 之前直接解引用）× cli.ts:90（exit 只看 `rows.every(converged)`）。
- **复现**：①`p0 sweep --in <缺泵曲线的工况>` → 未捕获 `TypeError: Cannot read properties of undefined (reading 'points')`，整段 Node 栈、exit 1（同输入 `p0 solve` 干净退 2）；②`p0 sweep --in <全关断工况>` → 7 行全 ✗、表格打印 NaN、exit 1，而 `p0 solve` 判 inputInvalid 退 2——**sweep 丢弃了 inputInvalid 分类，违反"2=输入或数据无效"契约**。
- **修法**：sweep() 入口先 `validateInput`，非空即整体返回失败并让 CLI 退 2（与 solve 对齐）；sweep.ts:36 前置判空。

### [MINOR] m3 —— 下界钳位静默通过（承接 recheck N4，本轮量化危害；非本轮引入）

- **位置**：solve.ts:128（q=0 早退）与 solve.ts:287–304（域检查只查上界）；friction/interp 的下界钳位均为设计行为但无诊断。
- **复现 A**（支路起端 y>0 配低压差泵）：支路 [[10,5],[20,10],[30,15]] + 泵 [[0,3],[50,2],[100,1]]（minLpm=8）→ q=0、converged=true、residual=0、**支路 dpKPa=p*=3.0 与支路曲线自身失配 2.0 kPa（y0=5）**，唯一告警是 min 保证（无 minLpm 时完全静默）。q=0 本身是钳位模型的正确答案，但工作点不在支路曲线上且无标记。
- **复现 B**（泵查表低于泵曲线首点）：泵曲线 x∈[40,240] 配 speedHz=12（scale=0.2）→ 查表 q/scale=3.6 < 40，泵值静默取钳位 0.04×180=7.2 kPa（实测精确）、converged=true、0 告警。
- **修法**：q=0 早退且 p* < branchDp(0) 时加告警"支路 x 曲线起端压降 y0 > 可用压差，零流量（曲线下域未表征）"；泵 lookupQ < 泵曲线首点 x 时对称告警；M1(b) 的支路侧守卫顺带覆盖复现 A。

### [NIT] n1 —— PG25 修正标准跨文件不一致（1.026 vs 1.0334）

qd.jsonc PG25 条目用 SG=1.0334（Dow LC25 1030.3 / 水@25°C 997.0，Cv 口径 ΔP∝SG）；pumps.jsonc 的 pump-vertiv-...-pg25（首轮提交）用密度比 1.026（uncertainty 注明源 engineeringtoolbox、水@20°C 基准，逐点比值 1.0215–1.0313 为取整噪声）。rack-orv3.json:24 在同一 dataVersion 下同时引用两条修正路径，系统性差 ~0.7%（被泵条目 ±15% 不确定度淹没，不阻断）。建议统一到 memo §1.4 选定的 Dow LC25 数据集口径，或在 case 文件登记分歧。

### [NIT] n2 —— dataVersion 标签无机器绑定

"component-curves@2026-10-17-pg25qd" 只在 rack-orv3.json:3 自declare，库内（schema.md/曲线文件）无版本登记，未来库改动不会使标签失效。当前已核验逐点一致；建议在 schema.md 或独立版本文件登记标签↔内容快照（如各文件条目数+检索日期哈希）。

### [NIT] n3 —— sweep 行不携带 warnings；高温越表域静默钳位

SweepRow 只有 converged 布尔，水基准/域/基准类告警全部折叠（minLpm 违约靠 minMargin 列间接可见）；工质温度 +5°C 越出 LC25 表域 60°C 时 props 端点钳位静默发生（props.ts 文档化行为，但 sweep 语境下读作"无敏感性"）。建议行内加 `warnings: string[]` 或告警计数。

### [NIT] n4 —— 温度扰动实现晦暗且带 1 ulp 噪声

sweep.ts:52–53 用 `d*50`（d=±0.1）表达 ±5°C，实测 32+(−0.1×50)=26.999999999999996（1 ulp，无害）。建议直写 `±5`。

### [NIT] n5 —— blind-domain-edge 把实现噪声锁进 CI；提速数字

该向量数值断言 tol=1e-4 恰为 Illinois 在该形态下的线性收敛误差量级，期望值 20 实为噪声上界——后续换 Brent/修 m1 后向量需同步改（note 已自认"根本解法 Brent 列加固欠账"，欠账应在 P1 前清）。另：53× 提速宣称在本机实测 41×（rack-orv3 ×200：1983ms → 48ms），同量级，建议改述为"约 40–50×"。

## 加固建议（优先级序）

1. **M1 三层修法**（friction 过渡区混合 + 支路侧平衡守卫 + 无根钉死告警）——支路侧守卫性价比最高，一并覆盖 m3 复现 A；配套回归向量：re2300 工况期望 converged=false（或修 friction 后期望 q 随泵头单调变化）。
2. **m2**：sweep 入口校验 + 退出码对齐（半小时工作量，契约一致性）。
3. **m1**：域检查容差带 + 边界吸附 + 契约文档回写（guarantee-interface.md 增补边界语义一节）。
4. **m3**：两条下界告警。
5. n1–n5 顺手清。

## 统计

- Findings：**0 BLOCKER / 1 MAJOR（M1，承前遗留、本轮实锤）/ 3 MINOR（m1 域边误拒带、m2 sweep 契约、m3 下界静默）/ 5 NIT**。
- 回归面：vectors 19/19（旧版 18/19，唯一分歧为 domain-edge 故意语义翻转）；rack-orv3 98.9 L/min；sweep 9 行全收敛；validate-data 60 条 0 issue。
- 数值一致性：300 随机工况 converged 0 分歧、|Δq|≤9.4e-14；13 条盲向量独立重算 ≤4.3e-16；qd PG25 9 条 0 算术错误。
- 实验环境：Node v24.21.0，复现脚本位于仓库外 `%TEMP%\p0v2`（exp1–exp8.mjs + 旧版求解器副本）。
