// p1 CLI —— AI-native 工具面：agent 的万能接口是 shell。
// 退出码（契约）：0=通过；1=数值失败/不可信；2=输入或数据无效。

import { readFileSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { P1Input } from "./types.ts";
import { solve, validateInput } from "./solve.ts";
import { runVectors } from "./vectors.ts";
import { sweep } from "./sweep.ts";
import { generateDoc } from "./doc.ts";
import { runChain } from "./chain.ts";

const here = dirname(fileURLToPath(import.meta.url));

const BOOL_FLAGS = new Set(["json"]);

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
  console.log(`p1 —— 液冷 P1 热阻链求解器 CLI（θ 链 + ε-NTU 换热器 + 露点裕度）
用法：
  p1 thermal --in <case.json> [--from-p0 <p0-out.json>] [--json]   热链求解（flows 可由 P0 输出注入）
  p1 sweep --in <case.json> [--from-p0 <p0-out.json>] [--json]     ±10% 敏感性矩阵（契约 §6.4）
  p1 doc --in <case.json> [--from-p0 <p0-out.json>] [--out <dir>]  生成计算书（md+json，RFQ 交付物）
  p1 chain --hydraulic <p0.json> --thermal <p1.json> [--out <dir>] P0→P1→联合计算书一条命令
  p1 vectors [--dir vectors] [--json]                             跑金向量（CI）
退出码：0=通过 1=数值失败/不可信 2=输入/数据无效`);
  process.exit(2);
}

// --from-p0：读 P0 输出 JSON，取 branches（含关断支路 q=0）作为 flows。
// 消费者责任（cabinet3d-interface §2 同款）：核对 schema 与 converged，垃圾流量拒绝注入。
function injectFlowsFromP0(input: P1Input, p0Path: string): P1Input {
  const p0 = JSON.parse(readFileSync(p0Path, "utf8")) as {
    schema?: string;
    converged?: boolean;
    branches?: { id: string; qLpm: number }[];
  };
  if (p0.schema !== "p0-out/v0.1") {
    console.error(`--from-p0 文件 schema 非 p0-out/v0.1：${String(p0.schema)}`);
    process.exit(2);
  }
  if (p0.converged !== true) {
    console.error("--from-p0 文件 P0 未收敛（converged≠true）：flows 不可信，拒绝注入");
    process.exit(2);
  }
  if (!Array.isArray(p0.branches) || p0.branches.length === 0) {
    console.error(`--from-p0 文件无 branches 数组：${p0Path}`);
    process.exit(2);
  }
  input.case.flows = p0.branches.map((b) => ({ id: b.id, qLpm: b.qLpm }));
  return input;
}

function printThermal(out: ReturnType<typeof solve>): void {
  const cap = out.qTotalW !== out.qTotalFluidW ? `（液体侧 ${(out.qTotalFluidW / 1000).toFixed(1)} kW，capture）` : "";
  console.log(`Q_total = ${(out.qTotalW / 1000).toFixed(1)} kW${cap} | 供液 ${out.tSupplyC.toFixed(2)}°C → 回液 ${out.tReturnC.toFixed(2)}°C（ΔT ${out.dtRackK.toFixed(2)} K） | ${out.converged ? "converged" : "NOT CONVERGED/UNTRUSTED"}`);
  if (out.hx) {
    const h = out.hx;
    if (h.mode === "slope") {
      console.log(`  HX(slope)  Q=${h.qKw.toFixed(1)} kW  S=${((h.slopeWKPerK ?? 0) / 1000).toFixed(2)} kW/K  ATD=${(h.atdK ?? 0).toFixed(2)} K  FWS ${h.tColdOutC.toFixed(2)}°C 回水  额定流量偏离 ${(h.ratedFlowDevPct ?? 0).toFixed(1)}%`);
    } else {
      console.log(`  HX(ua)     Q=${h.qKw.toFixed(1)} kW  UA=${h.uaWK} W/K  ε=${(h.eps ?? 0).toFixed(4)}  NTU=${(h.ntu ?? 0).toFixed(3)}  C_min=${(h.cMinWKPerK ?? 0).toFixed(1)} W/K  FWS 回水 ${h.tColdOutC.toFixed(2)}°C`);
    }
  }
  for (const n of out.nodes) {
    const flow = n.tOutC == null ? "— 过热无解 —" : `tOut ${n.tOutC.toFixed(2)}°C  ΔT ${(n.dTK ?? 0).toFixed(2)} K`;
    const tcase = n.tCaseC == null ? "" : `  T_case ${n.tCaseC.toFixed(1)}°C${n.tCaseMarginC != null ? `（裕度 +${n.tCaseMarginC.toFixed(1)} K）` : ""}`;
    console.log(`  ${n.id.padEnd(12)} ${String(n.qLpm.toFixed(1)).padStart(6)} L/min  ${flow}${tcase}`);
  }
  if (out.dewPointC != null) {
    const pass = out.dewPass ? "✓" : "✗ 红线不通过";
    console.log(`  露点 ${out.dewPointC.toFixed(2)}°C  裕度 ${(out.dewMarginK ?? 0).toFixed(2)} K ≥ ${out.dewMarginMinK} K ${pass}`);
  }
  if (out.wClassCheckC != null) {
    console.log(`  ASHRAE W 级检查温度 ${out.wClassCheckC.toFixed(1)}°C（上限 ${out.wClassMaxSupplyC}，下限 2） ${out.wClassPass ? "✓" : "✗"}`);
  }
  for (const w of out.warnings) console.log(`  ⚠ ${w}`);
}

function readInput(flags: Record<string, string>): P1Input {
  if (!flags.in) usage();
  let input: P1Input;
  try {
    input = JSON.parse(readFileSync(flags.in, "utf8"));
  } catch (e) {
    console.error(`输入无效：${(e as Error).message}`);
    process.exit(2);
  }
  if (flags["from-p0"]) {
    try {
      input = injectFlowsFromP0(input, flags["from-p0"]);
    } catch (e) {
      console.error(`--from-p0 读取失败：${(e as Error).message}`);
      process.exit(2);
    }
  }
  const errs = validateInput(input);
  if (errs.length) {
    console.error(`输入无效：\n  ${errs.join("\n  ")}`);
    process.exit(2);
  }
  return input;
}

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2);
  const { flags } = parseArgs(rest);
  const asJson = "json" in flags;

  if (cmd === "thermal") {
    const input = readInput(flags);
    const out = solve(input);
    if (asJson) console.log(JSON.stringify(out, null, 2));
    else printThermal(out);
    process.exit(out.inputInvalid.length ? 2 : out.converged ? 0 : 1);
  }

  if (cmd === "sweep") {
    const input = readInput(flags);
    const rows = sweep(input);
    if (asJson) {
      console.log(JSON.stringify(rows, null, 2));
    } else {
      console.log("扰动            供液(°C)   回液(°C)   ΔT(K)   min T_case裕度(K)   露点裕度(K)   收敛");
      for (const r of rows) {
        console.log(
          `${r.perturbation.padEnd(16)}${r.tSupplyC.toFixed(2).padStart(9)}${r.tReturnC.toFixed(2).padStart(11)}${r.dtRackK.toFixed(2).padStart(8)}${(r.minTCaseMarginC == null ? "—" : (r.minTCaseMarginC >= 0 ? "+" : "") + r.minTCaseMarginC.toFixed(1)).padStart(19)}${(r.dewMarginK == null ? "—" : r.dewMarginK.toFixed(2)).padStart(14)}${(r.converged ? "  ✓" : "  ✗").padStart(8)}`,
        );
      }
    }
    process.exit(rows.every((r) => r.converged) ? 0 : 1);
  }

  if (cmd === "doc") {
    const input = readInput(flags);
    const command = `p1 doc --in ${flags.in}${flags["from-p0"] ? ` --from-p0 ${flags["from-p0"]}` : ""}`;
    const bundle = generateDoc(JSON.stringify(input), input, command);
    const outDir = flags.out ?? "calc-note-thermal";
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "calc-note-thermal.md"), bundle.md, "utf8");
    writeFileSync(join(outDir, "calc-note-thermal.json"), JSON.stringify(bundle.json, null, 2) + "\n", "utf8");
    console.log(`计算书已生成：${join(outDir, "calc-note-thermal.md")}（+ 同名 .json）`);
    console.log(bundle.converged && !bundle.inputInvalid.length ? "状态：允许出数" : `状态：${bundle.inputInvalid.length ? "输入无效" : "未验证——禁止进 proposal"}（契约 §6 未满足）`);
    process.exit(bundle.inputInvalid.length ? 2 : bundle.converged ? 0 : 1);
  }

  if (cmd === "chain") {
    if (!flags.hydraulic || !flags.thermal) usage();
    const outDir = flags.out ?? "calc-note-chain";
    const r = runChain(flags.hydraulic, flags.thermal, outDir, `p1 chain --hydraulic ${flags.hydraulic} --thermal ${flags.thermal}`);
    if (asJson) console.log(JSON.stringify(r.summary, null, 2));
    console.log(`联合交付已生成：${join(outDir, "calc-note-hydraulic.md")} + ${join(outDir, "calc-note-thermal.md")}（+ 同名 .json）`);
    console.log(r.p0.converged && r.p1.converged ? "状态：水力+热链均允许出数" : "状态：存在未收敛/不可信环节——禁止进 proposal");
    process.exit(r.p0.inputInvalid.length || r.p1.inputInvalid.length ? 2 : r.p0.converged && r.p1.converged ? 0 : 1);
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
