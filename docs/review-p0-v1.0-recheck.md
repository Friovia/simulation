# P0 水力求解器 · 复审报告 v1.0-recheck（2026-10-17）

评审人立场：外部 reviewer（非共同作者），对上轮敌意评审（review-p0-v0.1.md）所列 F1–F13 的修复做逐条核验。对象：`p0-hydraulics/src/*.ts`（solver v0.2.0）、`vectors/*.json`（9 条）、`test-case/rack-demo.json`、`docs/guarantee-interface.md`。全部结论基于实际运行（约 20 组 CLI 实验 + 独立手算），复现输入放在仓库外临时目录，未改动仓库任何文件（本报告除外）。

## 结论

**放行进入下一阶段（物性替换 + 真实曲线接入）。** F1（BLOCKER）修复真实且双向正确，并有回归向量锁定；F2–F5、F7–F13 全部核验通过；F6 为 PARTIAL（pumpHz/dataVersion 已落地，`p0 sweep` 显式延期且有文档落位，不阻断本阶段）。数值面无回归：demo 工况与修复前一致，5 条数值金向量经独立闭式解手算逐位吻合，且 sym 两条向量已重造为严格域内工作点。新发现 2 MINOR + 2 NIT，均不阻断，建议随下一阶段顺手修复。

## 逐条核验（F1–F13）

- **F1 [PASS]** — 用 v0.1 报告的 BLOCKER 复现输入补齐 schema/温度后跑 `p0 solve --json`：`converged:false`、warnings 含「泵曲线越界：查表流量 400.0 > 域 250 L/min（变频 50%）」、exit 1；超速方向（rated 30/speed 60，域内工作点 q=200 与手算 800/4=200 逐位一致）不再误报、converged:true exit 0；回归向量 `f1-vfd-clamp` 已入 CI（9/9 绿）。注：v0.1 原始复现 JSON 本身缺 `schema`/温度字段，现被入口校验直接拦为 exit 2——比要求的"告警+exit 1"更严格，语义等价偏安全。
- **F2 [PASS]** — 域内关断例（sym-3-off-1 输入走 CLI `--json`）：关断支路 `"dpKPa": 150`（=pStar，数值）、`sharePct: 0`，全输出无 null 数值字段；越域关断例同样全数值；0/0 护栏在 `solve.ts:234`。`minMarginLpm: null` 为类型明示的 `number | null`，不算违例。
- **F3 [PASS]** — `branches: null` → exit 2、干净 JSON 无堆栈；全关断 → exit 2（「全部支路关断，无解」）；malformed JSON / 文件不存在 / 缺 `--in` 均 exit 2 且无堆栈；数值失败（越域）exit 1，三类退出码与契约一致。（残余缺口见 N1/N2。）
- **F4 [PASS]** — 越域工作点（F1 复现 + 自造 3 支路关断越域例）均 `converged:false` +「输出不可信」告警 + exit 1；sym-2/sym-3-off-1 曲线已重造，工作点严格域内（见下"独立手算"）。
- **F5 [PASS]** — 支路 y 非单调（[0,0],[100,80],[200,30]）→ exit 2「支路曲线 br y 非严格单调升（二分法前提）」；泵 y 递增 → exit 2「泵曲线 p1 y 非严格下降（二分括界前提）」。下界钳位残余见 N4（NIT）。
- **F6 [PARTIAL]** — `pumpHz` 已输出且含缺省解析（VFD 例 30、仅 ratedHz 例 60、无频率 null），`versions.dataVersion` 正确回显（实测 "curve-lib-test-v9"）；但 `p0 sweep` 子命令未实现（全仓 grep 仅 `calc-note-template.md:49` 标注"将来"），契约 §6.4 ±10% 扰动矩阵仍无工具支撑。两输出字段是 F6 的核，sweep 是出 proposal 数的门（非 P0→下阶段之门），判 PARTIAL、不阻断。
- **F7 [PASS]** — `speedHz:0` → exit 2「speedHz 必须 > 0」；`speedHz:30` 无 `ratedHz` → exit 2「给 speedHz 必须同时给 ratedHz」；回归向量 `f7-speed-zero` 在 CI。
- **F8 [PASS]** — 契约 §2 `solver.residual` 行已改为「泵-系统压力平衡相对残差（质量守恒 Σq=Q 构造性成立）」，与实现措辞一致；types.ts/solve.ts 注释同步。
- **F9 [PASS]** — 实测告警「支路 a 流量 109.1 低于 min 保证 120 L/min」（打印保证值本身，非裕度）；带 minLpm 的关断支路不再触发误报（`f9-minmargin` 例支路 b 静默跳过）。
- **F10 [PASS]** — 支路引用 `y:"m"` 曲线 → exit 2「支路曲线 brm y 必须为 kPa（got m）」。
- **F11 [PASS]** — `curveIds:[]` 且无 pipe → exit 2「curveIds 为空且无 pipe」；纯管路支路（空 curveIds + pipe）可正常求解（converged、q=23.33 L/min，与 Haaland 手检量级 ~190 kPa 一致），qMax 用泵域×1.2 作数值上界，无 Infinity 泄漏；向量 `f11-empty-curves` 在 CI。
- **F12 [PASS]** — `solve --in x.json --json` 与 `solve --json --in x.json` 两种顺序均正常出 JSON、exit 0。
- **F13 [PASS]** — `vectors --dir <绝对路径>` 9/9 绿；`validate-data --data <绝对路径>` 51 条全通过；`--in` 全程绝对路径使用正常。

## 回归面与独立手算

- `p0 vectors`：**9/9 绿**（5 条原有/重造 + 4 条新增失败路径 f1-vfd-clamp、f3-all-off、f7-speed-zero、f11-empty-curves），exit 0。
- demo（rack-demo.json）：Q_total=321.2 L/min、每支路 32.1 L/min、residual 0、converged、exit 0——与修复前一致，无回归；新增的水基准告警（F15，范围外）按预期触发。
- **sym-2 独立手算**：泵 150−0.2Q（3 点共线斜率 −0.2）、支路 2q（斜率 2）、双支路对称 → P=150−0.2P ⇒ P*=125 kPa、q*=62.5、Q*=125；工作点严格域内（62.5<160，125<300）。与向量期望值逐位一致。
- **sym-3-off-1 独立手算**：泵 180−0.15Q、支路 1.5q、关断 1/3 → P=180−0.2P ⇒ P*=150 kPa、q*=100、Q*=200；严格域内（100<160，200<400）。与向量期望值逐位一致。两条 sym 向量的数值不再是 v0.1 时无意义的钳位饱和值（F4 关闭）。
- blind-single / blind-parallel-same / blind-parallel-diff 手检闭式解（100；100/200；250/125/375=P/0.8,P/1.6）亦逐位吻合，工作点均在域内。
- 接口面：`solve`/`systemDpKPaAt`/`pumpDpKPaAt` 导出签名未变，viz-snapshot.ts 静态核对兼容（未运行——它会写仓库内文件）。

## 新发现问题

- **N1 [MINOR]** `p0 vectors --dir <不存在的目录>` 抛未捕获 ENOENT：整段 Node 堆栈 + exit 1，违反"2=输入或数据无效"契约（`validate-data` 子命令有 try/catch 正确退 2，`vectors` 没有；`cli.ts:71`）。修法：与 validate-data 同款包裹。
- **N2 [MINOR]** 失败路径向量无法断言错误分类与退出码：`f1-vfd-clamp`（数值失败，exit 1）与 `f3-all-off`（输入无效，exit 2）在 harness 里都只表达为 `expectConverged:false`+`warningIncludes`——F3 的退出码契约目前未被 CI 锁定，本轮靠手工验证。修法：vectors.ts 增加 `inputInvalidIncludes` 断言 kind（F14 的自然延伸）。
- **N3 [NIT]** input-invalid 路径 `--json` 的数值字段序列化为 null（`fail()` 返回 NaN），严格读 types.ts `residual: number` 仍不一致（有 `inputInvalid`/`converged:false` 兜底，语义可辨）；文本模式同路径打印 "Q_total = NaN"。修法：fail 路径字段类型 `number|null` 或输出前省略。
- **N4 [NIT]** 域检查仍只查上界，支路曲线 x 下界 >0 时无专门诊断：实测工作点落入下界平顶区的退化情形会 `converged:false`（residual 0.167）失败可见、不产假数，但 warnings 为空，失败原因不可读。承接 v0.1 F5 的"另"部分与 F21（`clamped` 标志仍未被消费），明确不在本轮 F1–F13 范围，记录备查。

## 范围外观察（不影响本次判定）

- 开发者顺带修了 F15（水基准告警，demo 实测触发）、F18（G=9.80665）、F16 部分（filterDpKPa<0、dMm≤0、lenM/k<0 拒绝；`tSupplyC≥tReturnC` 仍未查）——超出承诺范围，方向正确。
- F14（harness 表达力）已扩 `warningIncludes` + `expectConverged:false`，够本次 4 条失败向量用；距"锁退出码"还差 N2 一步。
- 上轮附录 A 认定正确的数值内核（相似定律、ρg 换算、干管 ×2、二分收敛性）本轮未重查，仅在新增路径上做了抽验（超速域内例逐位吻合）。

## 统计

F1–F13：**12 PASS / 1 PARTIAL（F6）/ 0 FAIL**。新问题：0 BLOCKER / 0 MAJOR / 2 MINOR（N1、N2）/ 2 NIT（N3、N4）。向量 9/9 绿；demo 数值无回归；退出码 0/1/2 三分类在 solve 全部路径实测符合契约。放行。
