// p2 CLI —— 环路热容与一阶阶跃响应（时间常数下界）。退出码：0=通过 1=失败 2=输入无效。

import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { P2Input } from "./types.ts";
import { solve, validateInput } from "./solve.ts";
import { runVectors } from "./vectors.ts";

const here = dirname(fileURLToPath(import.meta.url));

function usage(): never {
  console.log(`p2 —— 液冷环路瞬态骨架 CLI（流体热容 + 一阶阶跃闭式）
用法：
  p2 step --in <case.json> [--json]   负荷阶跃响应（时间常数下界）
  p2 vectors [--dir vectors] [--json] 跑金向量（CI）
退出码：0=通过 1=数值失败 2=输入/数据无效
红灯（不承诺）：金属热容/服务器热惯性、泵切换水力瞬态、控制回路、DX 周期`);
  process.exit(2);
}

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags: Record<string, string> = {};
  const asJson = rest.includes("--json");
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i];
    if (tok === undefined || tok === "--json") continue;
    if (tok.startsWith("--")) flags[tok.slice(2)] = rest[++i] ?? "";
  }

  if (cmd === "step") {
    if (!flags.in) usage();
    let input: P2Input;
    try {
      input = JSON.parse(readFileSync(flags.in, "utf8"));
    } catch (e) {
      console.error(`输入无效：${(e as Error).message}`);
      process.exit(2);
    }
    const errs = validateInput(input);
    if (errs.length) {
      console.error(`输入无效：\n  ${errs.join("\n  ")}`);
      process.exit(2);
    }
    const out = solve(input);
    if (asJson) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.log(`环路容积 ${(out.volumeM3 * 1000).toFixed(1)} L | 流体 ${(out.massKg).toFixed(1)} kg | 热容 ${out.capWJK.toFixed(0)} J/K | τ=${out.tauS.toFixed(2)} s（下界） | 终温 ${out.tInfC.toFixed(2)}°C | ${out.converged ? "converged" : "NOT CONVERGED"}`);
      for (const s of out.samples) console.log(`  t=${String(s.tS).padStart(6)} s   T=${s.TC.toFixed(3)}°C`);
      for (const w of out.warnings) console.log(`  ⚠ ${w}`);
    }
    process.exit(out.inputInvalid.length ? 2 : out.converged ? 0 : 1);
  }

  if (cmd === "vectors") {
    const d = flags.dir;
    const dir = d ? (isAbsolute(d) ? d : join(here, "..", d)) : join(here, "..", "vectors");
    let r: ReturnType<typeof runVectors>;
    try {
      r = runVectors(dir);
    } catch (e) {
      console.error(`向量目录无效：${(e as Error).message}`);
      process.exit(2);
    }
    if (asJson) {
      console.log(JSON.stringify(r, null, 2));
    } else {
      for (const v of r.results) console.log(`${v.ok ? "✓" : "✗"} ${v.id}${v.ok ? "" : ` — ${v.failures.join("; ")}`}`);
      console.log(`${r.pass} pass / ${r.fail} fail`);
    }
    process.exit(r.fail ? 1 : 0);
  }

  usage();
}

main();
