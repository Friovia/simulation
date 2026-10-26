// p3 CLI —— 48V busbar 压降/损耗。退出码：0=通过 1=数值失败 2=输入无效。

import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { P3Input } from "./types.ts";
import { solve, validateInput } from "./solve.ts";
import { runVectors } from "./vectors.ts";

const here = dirname(fileURLToPath(import.meta.url));

function usage(): never {
  console.log(`p3 —— 48V busbar 电气求解器 CLI（压降/损耗）
用法：
  p3 busbar --in <case.json> [--json]   母排压降/损耗求解
  p3 vectors [--dir vectors] [--json]   跑金向量（CI）
退出码：0=通过 1=数值失败 2=输入/数据无效
红灯（v0.1 不承诺）：脱扣协调、载流量/温升、短路电流`);
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

  if (cmd === "busbar") {
    if (!flags.in) usage();
    let input: P3Input;
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
      console.log(`I = ${out.currentA} A | 总压降 ${out.totalDropV.toFixed(4)} V（${out.dropPct.toFixed(3)}% of ${out.inputInvalid.length ? "?" : input.case.nominalV}V）→ 末端 ${out.endVoltageV.toFixed(3)} V | 损耗 ${out.totalLossW.toFixed(1)} W | ${out.pass ? "红线通过" : "超红线"}`);
      for (const s of out.segments) {
        console.log(`  ${s.id.padEnd(16)} R_单程 ${(s.rOneWayOhm * 1e6).toFixed(1)} µΩ  压降 ${(s.dropV * 1000).toFixed(1)} mV  损耗 ${s.lossW.toFixed(1)} W`);
      }
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
