# ORv3 液冷整機櫃模擬核心（liquid-cooling-kernel）

[English](README.md) · [繁體中文](README.zh-Hant.md)

面向 20–50 kW ORv3 風格液冷整機櫃的物理模擬核心：**四個純函數求解器套件 +
帶溯源的器件曲線庫 + 金向量驗證迴路**。純 TypeScript、求解部分零執行期依賴，
求解器一律 `input JSON → output JSON`。

## 模擬邊界

模擬到**機櫃入口（UQD 耦合面）的流量與溫度**。UQD 之後（伺服器內部管路、
冷板微通道、die 級熱行為）是伺服器廠商的保證域；機房級氣流與 CFD 也不在
本核心範圍。解析度對齊承諾面：粗於物理事實不可用，細於承諾面是浪費。

## 四個套件

| 套件 | 物理 | 版本 | 金向量 | 覆蓋 |
|---|---|---|---|---|
| `p0-hydraulics` | 1D 液冷水力網路 | 0.2.0 | 20 | CDU 泵→manifold→UQD→冷板支路流量分配、泵工作點（Illinois 牛頓求交）、PG25 物性溫度修正（μ/ρ/c_p/Pr）、Haaland/Churchill/Swamee-Jain 摩擦與層流–過渡–湍流判別、單支路關斷再分配、VFD 相似定律、±10% 敏感性掃描、計算書產生 |
| `p1-thermal-chain` | 晶片→機房熱阻鏈 | 0.2.0 | 23 | TDP/熱包絡 θ 鏈、冷板→冷卻液溫升、CDU 熱交換 ε-NTU、室內排熱、露點裕度（防冷凝紅線）、ASHRAE W 級（W17–W45）對標、P0→P1 聯合組裝器 |
| `p2-transient` | 暫態與控制 | 0.3.0 | 8 | 環路流體+金屬熱容、一階階躍閉式解（τ 下界）、泵惰轉（coastdown）閉式解 |
| `p3-electrical` | 48V 電氣 | 0.3.0 | 12 | busbar 壓降/損耗（IACS 銅常數帶源）、載流量與溫度降額、脫扣協調（選擇性）、短路電流源模型 |

共 **63 條金向量**，`npm run vectors` 一條命令全量迴歸。

計算書交付：`doc` 命令產出 md+json 雙格式計算書（示例見
`p0-hydraulics/calc-note-demo/` 與 `p1-thermal-chain/calc-note-chain/`）。

## 快速開始

```bash
# Node >= 22（.ts 原始碼直接執行，依賴 Node 原生 type stripping）
npm install
npm run typecheck   # strict + noUncheckedIndexedAccess，0 錯誤紅線
npm run vectors     # 63 金向量全量迴歸
```

CLI（每個套件同構；`--json` 結構化輸出；退出碼 0=通過 / 1=數值失敗 / 2=輸入或資料無效）：

```bash
node p0-hydraulics/bin/p0.mjs solve   --in p0-hydraulics/test-case/rack-orv3.json --json
node p0-hydraulics/bin/p0.mjs sweep   --in <case.json>        # ±10% 敏感性矩陣
node p0-hydraulics/bin/p0.mjs doc     --in <case.json>        # 計算書（md+json）
node p0-hydraulics/bin/p0.mjs vectors                          # 金向量迴歸
node p0-hydraulics/bin/p0.mjs validate-data                    # 曲線庫入庫校驗

node p1-thermal-chain/bin/p1.mjs solve --in <case.json>
node p2-transient/bin/p2.mjs solve    --in <case.json>
node p3-electrical/bin/p3.mjs solve   --in <case.json>
```

## 驗證方法論

數值庫的可信度來自驗證迴路，不來自聲明：

1. **金向量**：手工閉式解→JSON 測試向量（並聯對稱、單迴路壓降、泵工作點交汇、
   域邊界、無效輸入拒絕路徑），每次改求解器全量跑。
2. **盲算向量**：期望值由獨立推演產生——不讀求解器程式碼，從第一性原理手算，
   再與解算結果對比（獨立性=廉價的第二實作，防「照答案編答案」）。
3. **內建斷言**：質量/能量守恆殘差上限、NaN 守衛、插值單調性檢查；殘差超限
   不允許出數（`converged=false`，輸出標「不可信」）。
4. **敵意評審**：每版求解器按專業性清單（收斂、守恆、單位、邊界情況）過一輪
   獨立評審，findings 全修後放行——記錄見 `docs/review-*.md`（歷史存檔，
   內含當時評審語境）。

## 器件曲線庫（`data/component-curves/`）

git 版本化 JSON（jsonc），入庫三條鐵律（詳見 [schema.md](data/component-curves/schema.md)）：

- **無源不入庫**：每條曲線必帶 `source.url` 與檢索日期；
- **絕不編數**：只有單錨點時按同類形狀插值並在 `uncertainty` 聲明（±15% 量級），
  完全無資料記 `redlight` 佔位（`curve: null`），參與計算的結果必須標註「未驗證」；
- **measured 資料永不入庫**：本庫只收公開來源（datasheet/文獻/OCP spec），
  實測或 commissioning 遙測資料不屬於公開庫。

工質基準顯式登記（常見坑：廠商曲線標定於純水 20 °C，實際跑 PG25——須按物性
修正另立條目）。單位一律 SI（L/min、kPa、°C、W），換算只在 IO 邊界做一次。

## 設計原則

- **純函數核心**：求解器零依賴、無 I/O、無狀態，`solve(input) → output`。
  可直接拷貝進任意宿主（瀏覽器/Worker/後端），下節是各套件可獨立拷貝的檔案清單。
- **CLI-first**：求解、掃描、校驗、出報告每個操作都有 CLI 與 `--json` 輸出，
  語義化退出碼，便於自動化與 agent 消費。
- **資料與程式碼同庫版本化**：曲線庫是 git JSON，可 diff、可評審、可隨版本固定；
  輸出帶 `{solverVersion, dataVersion}`，可重現。
- **strict TypeScript**：`strict + noUncheckedIndexedAccess` 全量 0 錯誤是紅線，
  非空斷言 `!` 清零。

### 可拷貝的純函數檔案（vendoring）

| 套件 | 檔案 |
|---|---|
| p0-hydraulics | `src/{types,units,interp,props,friction,solve}.ts` |
| p1-thermal-chain | `src/{types,standards,dew,hx,thermal,solve}.ts` |

這些檔案無 `node:` 匯入、零依賴；`cli.ts` / `doc.ts` / `sweep.ts` /
`vectors.ts` / `validate-data.ts` 是套件內工具，依賴 Node。

## 授權

[Apache-2.0](LICENSE)。

工程免責：本核心用於工程參考與方案推演；廠商曲線多為單錨點+形狀插值（不確定度
見各條目 `uncertainty`），輸出用於實際專案前必須自行驗證並核對資料來源等級。
