// 一次性数据变换（可复审、可重放）：为 qd.jsonc 全部水基准曲线生成 PG25 修正条目。
// 修正依据：Cv 口径 ΔP = (Q/Cv)²·SG，SG=ρ(工质)/ρ(水)。
//   SG = ρ(DOWFROST LC25, 25°C)/ρ(水, 25°C) = 1030.3/997.0 = 1.03340
//   （来源 data/fluids-and-standards.md §1.2 主表 A；水密度为标准值）
// 黏度项在湍流区贡献 ~2-3%，未计入，逐条写进 uncertainty。
// 用文本插入而非整文件重写：保留原 JSONC 注释与顺序。
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripJsonc } from "../src/validate-data.ts";

const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, "..", "..", "data", "component-curves", "qd.jsonc");
const raw = readFileSync(file, "utf8");
const recs = JSON.parse(stripJsonc(raw)) as Array<Record<string, unknown>>;
const SG = 1030.3 / 997.0;

const added: string[] = [];
for (const r of recs) {
  const curve = r.curve as { points: [number, number][] } | null | undefined;
  if (!curve || r.redlight) continue;
  if (/-pg25$/.test(String(r.id))) continue; // 幂等：已修正过就跳过
  const c = structuredClone(r) as Record<string, unknown>;
  c.id = String(r.id) + "-pg25";
  c.fluid = {
    basis: `PG25 @ 25°C（水基准 ×SG ${SG.toFixed(4)} 修正：SG=ρ(DOWFROST LC25,25°C)/ρ(水,25°C)=1030.3/997.0，Cv 口径 ΔP∝SG）`,
  };
  (c.curve as { points: [number, number][] }).points = curve.points.map(([x, y]) => [x, +(y * SG).toFixed(4)]);
  c.uncertainty = String(r.uncertainty) + "；PG25 修正：密度项按 SG 精确，黏度项（湍流区 ~2-3%）未计入";
  c.notes = "政策第 5 条：PG25 工况优先用本条，不用水基准原条目";
  added.push(JSON.stringify(c, null, 2).replace(/\n/g, "\n  "));
}

if (added.length) {
  const idx = raw.lastIndexOf("]");
  const head = raw.slice(0, idx).replace(/\s*$/, "");
  writeFileSync(file, head + ",\n  " + added.join(",\n  ") + "\n]\n");
}
console.log(`qd.jsonc: 新增 ${added.length} 条 PG25 修正条目（SG=${SG.toFixed(5)}）`);
