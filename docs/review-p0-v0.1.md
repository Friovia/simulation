# P0 水力求解器骨架 · 敌意评审报告（v0.1，2026-10-17）

评审人立场：外部 reviewer（非共同作者）。评审对象：`p0-hydraulics/src/*.ts`、`vectors/*.json`、`test-case/rack-demo.json`，验收基准 `docs/guarantee-interface.md` §6。全部结论基于代码通读 + 12 组独立数值实验（复现输入见各 finding，实验均在仓库外的临时目录执行，未改动仓库任何文件）。

## 结论

**不建议以当前状态进入下一阶段，禁止用于任何承诺性输出。** 数值内核本身经得起抽验：相似定律、扬程 ρg 换算、mm→m 摩擦、干管 ×2、80/60 定长二分的收敛精度均与独立闭式解逐位一致（见附录 A）——这部分是好的。但包裹内核的"可信度外壳"（域检查、退出码、NaN 政策、输入校验、契约字段）系统性地违背了项目自己定义的契约 §6：存在 1 个 BLOCKER——变频降速后泵域检查用原始总流量而非查表自变量，导致深度钳位的工作点以 `converged=true`、零警告、退出码 0 输出，实测伪造出一台 30 Hz 下 200 L/min 的泵（其 30 Hz 有效数据只到 125 L/min）。另有 6 个 MAJOR 集中在"错误被静默吞掉"这一类。修复均为局部逻辑，工作量小；修完 F1–F7、补齐下文关键向量后可复审放行。

## Findings

### [BLOCKER]

**F1. 变频后泵曲线域检查用错自变量——降速工况静默输出钳位假数**
`solve.ts:116-119`（`domainWarnings`）与 `solve.ts:40`（查表 `qLpm / scale`）不自洽。查表自变量是 `qTotal/scale`，域检查却用原始 `qTotal` 对比 `pMax`。降速（scale<1）时查表自变量放大，实际已越界钳位而检查不触发；超速（scale>1）时反向误报。
实测复现（rated 60 Hz / speed 30 Hz，泵域 [0, 250] L/min，支路线性 m=0.125 kPa/(L/min)）：

```json
{"case":{"pump":{"curveId":"p1","yIs":"kPa","ratedHz":60,"speedHz":30},
         "branches":[{"id":"b","curveIds":["br"]}]},
 "curves":{"p1":{"points":[[0,200],[125,150],[250,100]]},
           "br":{"points":[[0,0],[200,25],[400,50]]}}}
```

输出：`qTotalLpm=200, pumpDpKPa=25, converged=true, residual=0, warnings=[], exit 0`。而查表自变量 = 200/0.5 = 400，超出泵域上限 250 达 60%，插值被钳位到 y=100 后乘 scale²——整个工作点是编造的。变频降速是 CDU 常规运行方式，此路径必踩。
修法：域检查改为 `qTotal / scale > pMax`（等价于对比 `pMax · scale`）；回归向量见向量清单 V9。

### [MAJOR]

**F2. 设计性 NaN 进入输出，JSON 序列化为 null，违反自身输出类型与契约 §6.1**
`solve.ts:185`（关断支路 `dpKPa: NaN`）、`solve.ts:199`（`qTotal`→0 时 `sharePct` 0/0）、`solve.ts:206`（NaN 守卫只覆盖 `[qTotal, pumpDpKPa, pStar, residual]` 四个标量，不含 branches 字段）。实测 `sym-3-off-1` 输入 `--json`：`"dpKPa": null`——违反 `types.ts:53` 的 `dpKPa: number`；契约 §6.1 却宣称"NaN 守卫通过"才允许出数。`margin.single_off` 是承诺参数，意味着**每次关断再分配计算都产出违反输出 schema 的 JSON**。sharePct 的 0/0 目前只靠"定长二分残留 ~2⁻⁶⁰·qMax 永不为精确 0"侥幸避开，无任何护栏。
修法：关断支路 `dpKPa` 输出耦合面压力 pStar（本来就是承诺面语义）或把该字段显式定为 `number | null` 写进契约；NaN 守卫扩展到全部输出字段或显式豁免清单。

**F3. 退出码语义与契约不符：输入无效类错误一律 exit 1，malformed 输入直接抛栈**
契约（`cli.ts:2`、README）：`2=输入或数据无效`。实测：schema 不支持（`solve.ts:149`）、缺曲线引用（`solve.ts:152-154`）、无支路（`solve.ts:151`）、全部关断（`solve.ts:155-156`）、`curveIds:[]` 导致 Infinity（F11）——全部 exit 1（数值失败）；`case.branches: null` 这类 JSON 合法但 schema 非法的输入在 `solve.ts:151` 抛未捕获 TypeError，打整段堆栈后 exit 1。只有 JSON.parse 失败走 exit 2（`cli.ts:44-47`）。用退出码做判断的 agent/CI 会把坏输入误分类为物理不收敛。
修法：`solve()` 返回错误分类（input-invalid vs numerical），CLI 相应 exit 2；或 CLI 层先跑完整 schema 校验。

**F4. "不可信"警告不影响 converged/退出码；两条结构性金向量本身全程运行在钳位饱和区**
`solve.ts:218`（`converged` 只看 finite+residual）+ `cli.ts:59`（exit 只看 converged）。实测 `sym-3-off-1` 求解：支路流量 45.0 L/min，曲线域上限 30，45 = 30×1.5 恰为 `branchQMaxLpm`（`solve.ts:107`）的内层二分饱和值——warning 明确写着"输出已钳位，不可信"，但 `converged=true`、CLI exit 0、向量 pass。即：**sym-2 与 sym-3-off-1 两条已入库金向量的流量数值本身是无意义的钳位值**（只检对称性所以绿），金向量机制目前没有真正锁定过"非线性曲线+多支路+域内收敛"的数值。
修法：domainWarnings 命中 → `converged=false`（或新增 `trusted:false` 并让退出码/向量 harness 感知）；重造 sym 向量曲线使工作点严格在域内。

**F5. 单调性/曲线形态假设零执行——二分法的数学前提无任何一处强制**
`interp.ts:8` 注释"曲线点已通过入库校验"，但 (a) `solve()` 的 inline 曲线（`input.curves`，向量与 test-case 全走这条路）**完全绕过** `validate-data`；(b) `validate-data.ts:96-104` 也只查 x 严格单调与 ≥3 点，**不查 y 单调性**，而 `schema.md:17` 明文允许 y"单调或单峰"；(c) 求解器的前提更强：支路 ΔP 曲线须 y 严格单调升（`solve.ts:60` 注释）、泵曲线须单调降（`solve.ts:163-165` 括界与单调性论证）。非单调 y → 内层二分收敛到任意一支、泵-系统多交点任取其一、泵曲线递增时括界 [0, 1.2·shutoff] 直接退化（shutoff=0 时假收敛零流量）——全部静默。另：域检查只查上界（`solve.ts:119,126`），x 下界钳位（器件 datasheet 曲线常从非零流量起）无告警；实测下界平顶区造成 Q(P) 不连续，残差能抓到一部分（converged=false），但不是设计保证。
修法：`solve()` 入口对 inline 曲线执行与入库同款校验 + 形态断言（泵严格降、器件曲线严格升，不满足即 `bad()`）。

**F6. 契约承诺参数没有对应输出/工具：泵频率、敏感性表、dataVersion**
对照 `guarantee-interface.md`：`pump.oppoint`（L28）承诺"(Q, H, **频率**)"——输出只有 Q/H，实际频率（含缺省解析结果）不回显，变频工况无法归档审计；§6.4（L60）"每个承诺参数附 ±10% 扰动响应"——无任何敏感性/批量扫描工具，`margin.filter_derate`（L32）承诺形式落空（`viz-snapshot.ts` 是视图脚本不算数）；§6.5（L61）归档三元组含 `dataVersion`——`versions` 只有 solver/props/input-schema（曲线内嵌 input 可部分辩护，但库版本无落位）。
修法：输出加 `pumpHz` 与 `dataVersion` 字段；补 `p0 sweep` 子命令（±10% 扰动矩阵）。

**F7. speedHz 边界静默错物理：0 Hz 按额定转速算；speedHz 无 ratedHz 被静默丢弃**
`solve.ts:33-35`：`scale = rated && speed && speed !== rated ? speed/rated : 1` 用 truthiness。实测 `speedHz: 0` → 输出与额定转速逐位相同（q=100 L/min）——物理上泵已停；实测 `speedHz: 30`（无 ratedHz）→ 与额定全同、零警告，用户指定的频率被无声忽略。变频扫描的边界值必踩。
修法：`speedHz<=0` → `bad()`；`speedHz` 有而 `ratedHz` 无 → `bad()` 或显式告警。

### [MINOR]

**F8. residual 语义与契约措辞不符**：`solve.ts:204` 实现的是"泵-系统压力平衡、相对泵压升的相对残差"；契约 §2（L33）写"质量/能量守恒残差"。质量守恒 Σq=Q 是构造性成立（`solve.ts:189` 累加定义），并无独立断言。分母 `max(pump,1e-9)` 在泵压→0 时相对/绝对语义未定义。修法：改契约措辞或双残差输出（压力平衡 + Σq 校验）。

**F9. min 裕度警告文案把裕度值当"保证流量"打印，且关断支路必触发**：`solve.ts:210` 实测输出"支路 b 低于 min 保证流量 -10.0 L/min"——-10.0 是裕度（q−minLpm），不是保证值；且关断支路 `minMarginLpm=-minLpm`（`solve.ts:185`）恒 <0，每个关断场景都报一条误导性警告。修法：文案用 `b.minLpm`；关断支路跳过此检查。

**F10. 支路曲线 yIs 被忽略**：`solve.ts:49` 把支路引用曲线一律当 kPa。`y:"m"` 曲线进支路（类型合法）实测静默按 kPa 直算，量级错 ~ρg/1000≈10 倍，无警告。修法：branch 引用 `y:"m"` 曲线 → `bad()`。

**F11. `curveIds:[]` 合法但发散；纯管路支路无法表达**：`solve.ts:106-107` 对空 curveIds 取 `m=Infinity` → qMax=∞ → 内层二分 mid=∞ → q=Infinity → 全 NaN（实测 exit 1，归 F3 应为 2）。`types.ts:23` `curveIds` 必填但可空数组，`pipe` 支路没有"只有管路"的合法写法。修法：空 curveIds 且无 pipe → `bad()`；有 pipe → qMax 取数值上界（如泵域×系数）。

**F12. CLI 布尔旗标吞后随 token**：`cli.ts:18` `flags[key]=rest[++i]` 无布尔旗标白名单。实测 `p0 solve --json --in x.json` → `--in` 被吃 → usage/exit 2；`--json` 必须放最后。修法：`json` 等布尔旗标不取值。

**F13. `--dir`/`--data` 不认绝对路径**：`cli.ts:63,74` 用 `path.join` 拼，实测绝对路径拼成 `...p0-hydraulics\C:\...\vectors` → ENOENT 崩。修法：`isAbsolute()` 直用。

**F14. 向量 harness 表达力不足以守住契约**：`vectors.ts:50-72` 只有 closeTo/equalsPath/lessThan 三种数值断言且 L72 强制 converged——失败路径、警告存在性、null 语义、退出码全部不可测。这正是 F1/F2 能潜伏的结构性原因（BLOCKER 存在而 5/5 全绿）。修法：加 `expectNotConverged`、`warningIncludes`、`isNull` 等 kind。

**F15. 曲线工质基准（basis）与工况工质从不交叉核对**：case 工质硬编码 PG25（`solve.ts:31`），`types.ts:10` 的 `basis` 字段无消费方；`rack-demo.json:22` 泵曲线 basis="清水"直接用于 PG25 工况，违反 `schema.md` 政策 5 的精神且无警告。修法：basis 非 PG25 系 → 告警或拒绝。

**F16. 数值输入无物理范围校验**：负 `filterDpKPa`、`dMm≤0`（面积 0 → NaN）、`lenM<0`、`tSupplyC≥tReturnC` 等均无检查。修法：入口范围断言，失败归 exit 2。

**F17. 钳位边缘的 dpKPa 输出与耦合面压力可不一致**：`solve.ts:193` dpKPa 在 qj 处重算而非报 pStar；曲线平顶/钳位区两者可发散（域内解时相等是构造性的），且此时承诺参数 `branch.dp[j]` 的物理位置语义（UQD 耦合面）实际对应 pStar。修法：dpKPa 直接报 pStar（或同时报 qj 处压降并注明差异）。

### [NIT]

**F18.** `solve.ts:15` G=9.81 三位有效（标准 9.80665），扬程↔kPa 全链系统性偏差 ~0.07%。内部自洽、复现无碍，与"敢写进 proposal"的位数要求不符。

**F19.** `friction.ts:8` 层流→湍流在 Re=2300 硬切换，无过渡带处理；README 专业性清单承诺"层流/过渡/湍流流态判别"。Haaland 公式本身核对无误。

**F20.** "内部一律 SI"（`units.ts:1`、README）与实践不符：内核 L/min / kPa / Pa 混用（`pumpDpKPaAt` 返回 kPa，`solve.ts:175` 手写 ×1000）。功能无错，纪律表述失真，易误导后续贡献者。

**F21.** `interp.ts:5,12-13` 的 `clamped` 标志被 `solve()` 完全忽略，与 domainWarnings 双轨且后者信息更少（正是 F1 的温床）。修复 F1 时建议直接消费该标志。

**F22.** 死代码/重复计算：`makeCtx` 的 `warnings` 形参未使用（`solve.ts:28`）；`muOf(input)` 每次 re-derive props（`solve.ts:98-100`）而非用 ctx；`systemDpKPaAt`/`pumpDpKPaAt` 每调用重建 ctx（viz 每快照几十次）。

## 建议补测向量清单（按优先级）

现有 5 条向量全部是"kPa 泵 + 纯曲线支路 + 域内工作点"，以下场景零覆盖（括号内为闭式解要点，供盲算 agent 用）：

| # | 向量 | 覆盖缺口 | 闭式解要点 |
|---|---|---|---|
| V1 | blind-head-m：`yIs:"m"` 泵 + 单支路 | ρg 换算、pumpHeadM 往返 | A=ρg·H₀/1000、B=ρg·斜率/1000，q*=A/(B+m)；加检 `pumpHeadM`=曲线原扬程值（已手推：q*=100.6939…可复用本评审实验值） |
| V2 | blind-vfd：kPa 泵 + ratedHz/speedHz | 相似定律（scale、插值自变量） | H_s(q)=scale²A−scale·Bq → q*=scale²A/(m+scale·B)；工作点须满足 q*<pMax·scale 且 q*/scale<pMax 双侧域内（本评审实验值：scale=0.75，q*=59.210526315789…） |
| V3 | blind-vfd-head：m 泵 + 变频 | F1 修复的正面回归（换算×相似定律耦合） | 同 V1/V2 复合 |
| V4 | blind-supply-pipe：含 supplyPipe | 干管 ×2、Haaland、摩擦路径（**friction.ts 目前零向量覆盖**） | 层流选型（k=0、Re<2300）→ dp=32μLv/D² 线性 → 线性方程组闭式解（本评审实验值：D=6mm/L=10m/泵 2→1 kPa，q*=0.1594908050206…）；湍流版由盲算 agent 自写 Haaland 小求解器产出 |
| V5 | blind-branch-pipe：支路 pipe + 器件曲线混合 | 支路摩擦与曲线叠加 | 同 V4 方法 |
| V6 | blind-filter：filterDpKPa>0 | 堵塞情景数值（目前只有 viz 脚本用） | q*=(A−F)/(B+m) |
| V7 | blind-off1of3-filter：关断 + 堵塞组合 | `margin.single_off` 的**数值**版（sym-3-off-1 只有对称性且数值本身在钳位区，见 F4） | 并联导纳 + 常数偏移，线性闭式解 |
| V8 | blind-domain-edge：工作点恰在泵/支路曲线 x-max | 钳位边界语义（clamped=false 应成立于端点） | 端点值即期望值 |
| V9 | blind-vfd-clamp-warn（需 F14 harness 扩展） | **F1 的回归向量**：降速后查表越界必须告警/不收敛 | 用本评审 BLOCKER 复现输入，期望 warningIncludes("泵曲线越界") |
| V10 | blind-min-margin：minLpm 高于/低于实际 | minMarginLpm 数值与告警 | q*−minLpm |
| V11 | 失败路径向量（需 harness 支持 expectNotConverged/exitCode） | 全关断、缺曲线、curveIds 空、schema 错 | 期望 converged=false + exit 2（F3 修复后） |
| V12 | 加固现有向量：并联向量补 `sharePct` 总和=100 与 `qTotalLpm` 闭式检查；sym 向量换域内曲线 | F4 的钳位区问题 | — |
| V13 | speedHz=0 / speedHz 无 ratedHz（F7 修复后） | 变频边界语义 | 期望 bad 或 q≈0 |

## 附录 A：本轮独立验证为正确的项（下轮复审不必重查）

1. 泵相似定律实现（`solve.ts:37-44`）：scale、查表自变量 `q/scale`、×scale² 的推导与实现正确，与闭式解 ulp 级一致（59.210526315789465 vs 手算 …48）。
2. 扬程 m ↔ kPa 的 ρg 换算链（`solve.ts:42` 与 `solve.ts:222`）自洽往返，与闭式解逐位一致（含 tMean 密度修正）。
3. `friction.ts` 的 mm→m、层流 64/Re、Darcy 形式：与手算层流闭式解逐位一致（0.15949080502060914）。
4. 干管"单程参数、内部 ×2"在 `solve.ts:174,203` 与 `systemDpKPaAt`（`solve.ts:89`）贯彻一致。
5. 定长二分 80/60 次的收敛性：区间宽度缩至 1.2·shutoff·2⁻⁸⁰ ≈ 10⁻²⁵·shutoff，远低于 double ulp（~2.2×10⁻¹⁶），约 50 次后即达机器精度；实测全部工况（含陡泵）residual=0，对 1e-8 判据裕度 ~7 个数量级。定长的真实失效模式不在迭代次数，在 F5 的形态前提与 F1/F11 的括界。
6. Σq_j = Q 构造性成立（`solve.ts:188-189`）；向量 runner 的 closeTo/equalsPath 相对容差实现无误。
7. `stripJsonc` 状态机、`validateDir` 对真实曲线库（51 条含 16 redlight）运行通过。

## 附录 B：分级统计

BLOCKER 1 条（F1）；MAJOR 6 条（F2–F7）；MINOR 10 条（F8–F17）；NIT 5 条（F18–F22）。
