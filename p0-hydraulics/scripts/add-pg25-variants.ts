// 一次性数据变换（可复审、可重放）：为 cold-plate.jsonc / pumps.jsonc 的水基准曲线
// 生成 PG25 修正条目（政策第 5 条欠账，qd.jsonc 同方法）。
// 修正依据：ΔP ∝ ρ（冷板/快插以形阻为主；泵 ΔP=ρ·g·H 随密度同比例抬升）。
//   SG = ρ(DOWFROST LC25, 25°C)/ρ(水, 25°C) = 1030.3/997.0 = 1.03340
//   （data/fluids-and-standards.md §1.2 主表 A；水密度标准值）
// 登记假设：比值统一取 25°C 基准；原曲线标定温度（20–45°C）下比值变化 <0.4%，
// 计入 uncertainty。黏度项（湍流区 ~2-3%）未计入。
// 已知不一致（待数据评审合并）：早期 pump-vertiv-* -pg25 条目用 1.026，
// 与本脚本 canonical 1.0334 差 0.7%，在曲线 ±15% 不确定度内，暂不回改已发布条目。
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripJsonc } from "../src/validate-data.ts";

const here = dirname(fileURLToPath(import.meta.url));

// 原基准中包含这些 token 的才修正（水基准识别；PG25 原生条目跳过）
const WATER_HINTS = ["DI water", "纯水", "清水", "处理水", "100% 水", "水或 PG", "PG-25 或去离子水"];

function isWaterBasis(basis: string): boolean {
  return WATER_HINTS.some((t) => basis.includes(t)) && !/PG25 @ 25°C（由/.test(basis);
}

const SG = 1030.3 / 997.0;

function process(file: string, extraAssumptions: Record<string, string>): void {
  const path = join(here, "..", "..", "data", "component-curves", file);
  const raw = readFileSync(path, "utf8");
  const recs = JSON.parse(stripJsonc(raw)) as Array<Record<string, unknown>>;
  const existingIds = new Set(recs.map((r) => String(r.id)));
  const added: string[] = [];
  for (const r of recs) {
    const curve = r.curve as { points: [number, number][] } | null | undefined;
    if (!curve || r.redlight) continue;
    if (/-pg25$/.test(String(r.id))) continue; // 幂等：已修正条目跳过
    if (existingIds.has(String(r.id) + "-pg25")) continue; // 已有兄弟 -pg25 条目（早期 1.026 批次）跳过
    const basis = String((r.fluid as { basis?: string })?.basis ?? "");
    if (!isWaterBasis(basis)) continue;
    const c = structuredClone(r) as Record<string, unknown>;
    c.id = String(r.id) + "-pg25";
    const extra = extraAssumptions[String(r.id)] ? `；${extraAssumptions[String(r.id)]}` : "";
    c.fluid = {
      basis: `PG25 @ 25°C（水基准 ×SG ${SG.toFixed(4)} 修正：SG=ρ(DOWFROST LC25,25°C)/ρ(水,25°C)=1030.3/997.0，ΔP∝ρ）`,
    };
    (c.curve as { points: [number, number][] }).points = curve.points.map(([x, y]) => [x, +(y * SG).toFixed(4)]);
    c.uncertainty = String(r.uncertainty) + `；PG25 修正：密度项按 SG@25°C 精确（原标定温度下比值变化 <0.4%），黏度项（湍流区 ~2-3%）未计入${extra}`;
    c.notes = "政策第 5 条：PG25 工况优先用本条，不用水基准原条目";
    added.push(JSON.stringify(c, null, 2).replace(/\n/g, "\n  "));
  }
  if (added.length) {
    const idx = raw.lastIndexOf("]");
    const head = raw.slice(0, idx).replace(/\s*$/, "");
    writeFileSync(path, head + ",\n  " + added.join(",\n  ") + "\n]\n");
  }
  console.log(`${file}: 新增 ${added.length} 条 PG25 修正条目（SG=${SG.toFixed(5)}）${added.length ? `：${added.length} 条见文件` : ""}`);
}

process("cold-plate.jsonc", {
  "coldplate-sxm-hopper-ats-aic1012": "原条目工质未注明（疑清水）——按清水基准修正是额外登记假设，用于敏感性/初选，正式选型须向厂商确认基准",
});
process("pumps.jsonc", {
  "pump-vertiv-coolchip600-single": "厂商口径『水或 PG-25』双适用：修正量级 ~3% 在曲线 ±15% 内，保守起见两条并存",
  "pump-vertiv-coolchip600-dual": "同 single 条目口径",
  "pump-vertiv-coolchip2300-dual": "厂商口径『PG-25 或去离子水』：修正量级 ~3% 在曲线不确定度内，两条并存",
});
