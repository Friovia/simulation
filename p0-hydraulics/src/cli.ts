// p0 CLI —— AI-native 工具面：agent 的万能接口是 shell。
// 退出码（契约）：0=通过；1=数值失败；2=输入或数据无效。

import { readFileSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { P0Input } from "./types.ts";
import { solve, validateInput } from "./solve.ts";
import { runVectors } from "./vectors.ts";
import { validateDir } from "./validate-data.ts";
import { sweep } from "./sweep.ts";
import { generateDoc } from "./doc.ts";

const here = dirname(fileURLToPath(import.meta.url));

const BOOL_FLAGS = new Set(["json"]); // F12：布尔旗标不吃后随 token

function parseArgs(rest: string[]): { flags: Record<string, string>; bare: string[] } {
  const flags: Record<string, string> = {};
  const bare: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i];
    if (tok === undefined) continue;
    if (tok.startsWith("--")) {
      const k = tok.slice(2);
      if (BOOL_FLAGS.has(k)) flags[k] = "true";
      else flags[k] = rest[++i] ?? "";
    } else bare.push(tok);
  }
  return { flags, bare };
}

function usage(): never {
  console.log(`p0 —— 液冷 P0 水力求解器 CLI
用法：
  p0 solve --in <case.json> [--json]        求解一个工况
  p0 sweep --in <case.json> [--json]        ±10% 敏感性矩阵（契约 §6.4）
  p0 doc --in <case.json> [--out <dir>]     生成计算书（md+json，RFQ 交付物）
  p0 vectors [--dir vectors] [--json]       跑金向量（CI）
  p0 validate-data [--data <dir>] [--json]  校验曲线库入库
退出码：0=通过 1=数值失败 2=输入/数据无效`);
  process.exit(2);
}

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2);
  const { flags } = parseArgs(rest);
  const asJson = "json" in flags;

  if (cmd === "solve") {
    if (!flags.in) usage();
    let input: P0Input;
    try {
      input = JSON.parse(readFileSync(flags.in, "utf8"));
    } catch (e) {
      console.error(`输入无效：${(e as Error).message}`);
      process.exit(2);
    }
    const out = solve(input);
    if (asJson) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      const fmt = (v: number | null, d = 1) => (v == null ? "—" : v.toFixed(d));
      console.log(`Q_total = ${fmt(out.qTotalLpm)} L/min | 泵压升 ${fmt(out.pumpDpKPa)} kPa (${fmt(out.pumpHeadM, 2)} m) | residual ${out.residual == null ? "—" : out.residual.toExponential(2)} | ${out.converged ? "converged" : "NOT CONVERGED"}`);
      for (const b of out.branches) {
        const margin = b.minMarginLpm == null ? "" : ` | min裕度 ${b.minMarginLpm >= 0 ? "+" : ""}${b.minMarginLpm.toFixed(1)}`;
        console.log(`  ${b.id.padEnd(12)} ${b.shutdown ? "— 关断 —" : `${b.qLpm.toFixed(1).padStart(6)} L/min  ${b.sharePct.toFixed(1).padStart(5)}%  ΔP ${b.dpKPa.toFixed(1)} kPa${margin}`}`);
      }
      for (const w of out.warnings) console.log(`  ⚠ ${w}`);
    }
    // F3：输入无效退 2，数值失败退 1，通过退 0
    process.exit(out.inputInvalid.length ? 2 : out.converged ? 0 : 1);
  }

  if (cmd === "sweep") {
    if (!flags.in) usage();
    let input: P0Input;
    try {
      input = JSON.parse(readFileSync(flags.in, "utf8"));
    } catch (e) {
      console.error(`输入无效：${(e as Error).message}`);
      process.exit(2);
    }
    const errs = validateInput(input); // m2：sweep 输入先校验，坏输入退 2 不抛栈
    if (errs.length) {
      console.error(`输入无效：\n  ${errs.join("\n  ")}`);
      process.exit(2);
    }
    const rows = sweep(input);
    if (asJson) {
      console.log(JSON.stringify(rows, null, 2));
    } else {
      console.log("扰动            Q_total(L/min)   泵压升(kPa)   min裕度(L/min)   收敛");
      for (const r of rows) {
        console.log(
          `${r.perturbation.padEnd(16)}${r.qTotalLpm.toFixed(1).padStart(10)}${r.pumpDpKPa.toFixed(1).padStart(14)}${(r.minMarginLpm == null ? "—" : (r.minMarginLpm >= 0 ? "+" : "") + r.minMarginLpm.toFixed(1)).padStart(15)}${(r.converged ? "  ✓" : "  ✗").padStart(10)}`,
        );
      }
    }
    process.exit(rows.every((r) => r.converged) ? 0 : 1);
  }

  if (cmd === "doc") {
    if (!flags.in) usage();
    let raw: string;
    let input: P0Input;
    try {
      raw = readFileSync(flags.in, "utf8");
      input = JSON.parse(raw);
    } catch (e) {
      console.error(`输入无效：${(e as Error).message}`);
      process.exit(2);
    }
    const errs = validateInput(input);
    if (errs.length) {
      console.error(`输入无效：\n  ${errs.join("\n  ")}`);
      process.exit(2);
    }
    const command = `p0 doc --in ${flags.in}`;
    const bundle = generateDoc(raw, input, command);
    const outDir = flags.out ?? "calc-note";
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "calc-note.md"), bundle.md, "utf8");
    writeFileSync(join(outDir, "calc-note.json"), JSON.stringify(bundle.json, null, 2) + "\n", "utf8");
    console.log(`计算书已生成：${join(outDir, "calc-note.md")}（+ 同名 .json）`);
    console.log(bundle.json.status === "ok" ? "状态：允许出数" : `状态：${String(bundle.json.status)}——禁止进 proposal`);
    process.exit(bundle.inputInvalid.length ? 2 : bundle.converged ? 0 : 1);
  }

  if (cmd === "vectors") {
    const d = flags.dir;
    const dir = d ? (isAbsolute(d) ? d : join(here, "..", d)) : join(here, "..", "vectors");
    let r: ReturnType<typeof runVectors>;
    try {
      r = runVectors(dir);
    } catch (e) {
      console.error(`向量目录无效：${(e as Error).message}`); // N1：坏目录退 2，不抛栈
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

  if (cmd === "validate-data") {
    const dd = flags.data;
    const dir = dd ? (isAbsolute(dd) ? dd : join(here, "..", "..", dd)) : join(here, "..", "..", "data", "component-curves");
    let r: ReturnType<typeof validateDir>;
    try {
      r = validateDir(dir);
    } catch (e) {
      console.error(`数据目录无效：${(e as Error).message}`);
      process.exit(2);
    }
    if (asJson) {
      console.log(JSON.stringify(r, null, 2));
    } else {
      console.log(`曲线库 ${dir}：${r.entries} 条（含 ${r.redlights} redlight）`);
      for (const i of r.issues) console.log(`✗ ${i.file} :: ${i.id}\n    ${i.errors.join("\n    ")}`);
      if (!r.issues.length) console.log("全部通过");
    }
    process.exit(r.issues.length ? 2 : 0);
  }

  usage();
}

main();
