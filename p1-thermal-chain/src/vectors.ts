// P1 金向量运行器：p1 vectors 即 CI（README·AI-native 落地）。
// 向量 JSON 结构沿 P0：{ id, note, input: P1Input, checks: [...], expectConverged? }
// check 种类：closeTo / equalsPath / warningIncludes / inputInvalidIncludes / flag。

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { P1Input } from "./types.ts";
import { solve } from "./solve.ts";
import { getPath } from "../../p0-hydraulics/src/vectors.ts";

interface VectorCheck {
  path: string;
  kind: "closeTo" | "equalsPath" | "lessThan" | "warningIncludes" | "inputInvalidIncludes" | "flag";
  value?: number | boolean | string;
  path2?: string;
  tol?: number;
}
interface Vector {
  id: string;
  note?: string;
  input: P1Input;
  checks: VectorCheck[];
  expectConverged?: boolean; // 默认 true；false = 失败路径向量
}

export interface VectorResult {
  id: string;
  ok: boolean;
  failures: string[];
}

export function runVectors(dir: string): { pass: number; fail: number; results: VectorResult[] } {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const results: VectorResult[] = [];
  for (const f of files) {
    const v = JSON.parse(readFileSync(join(dir, f), "utf8")) as Vector;
    const out = solve(v.input);
    const failures: string[] = [];
    for (const chk of v.checks) {
      if (chk.kind === "warningIncludes") {
        const w = out.warnings ?? [];
        if (!w.some((s) => s.includes(String(chk.value ?? "")))) {
          failures.push(`warnings 不含「${chk.value}」（实际：${w.join(" | ") || "无"}）`);
        }
        continue;
      }
      if (chk.kind === "inputInvalidIncludes") {
        const iv = out.inputInvalid ?? [];
        if (iv.length === 0) failures.push(`inputInvalid 为空（期望含「${chk.value}」的输入无效分类）`);
        else if (!iv.some((s) => s.includes(String(chk.value ?? "")))) {
          failures.push(`inputInvalid 不含「${chk.value}」（实际：${iv.join(" | ")}）`);
        }
        continue;
      }
      if (chk.kind === "flag") {
        const a = getPath(out, chk.path);
        if (a !== chk.value) failures.push(`${chk.path}=${String(a)} ≠ 期望 ${String(chk.value)}`);
        continue;
      }
      const a = getPath(out, chk.path);
      if (typeof a !== "number" || !Number.isFinite(a)) {
        failures.push(`${chk.path} 非有限数值：${String(a)}`);
        continue;
      }
      if (chk.kind === "closeTo") {
        const v2 = chk.value;
        if (typeof v2 !== "number") { failures.push(`${chk.path} closeTo 期望值非数值`); continue; }
        const tol = chk.tol ?? 1e-9;
        if (Math.abs(a - v2) / Math.max(Math.abs(v2), 1e-9) > tol) {
          failures.push(`${chk.path}=${a} ≠ 期望 ${v2} (tol ${tol})`);
        }
      } else if (chk.kind === "equalsPath") {
        const b = getPath(out, chk.path2!);
        const tol = chk.tol ?? 1e-9;
        if (typeof b !== "number" || Math.abs(a - (b as number)) / Math.max(Math.abs(a), 1e-9) > tol) {
          failures.push(`${chk.path}=${a} ≠ ${chk.path2}=${String(b)} (tol ${tol})`);
        }
      }
    }
    if (v.expectConverged !== false && !out.converged) failures.push("求解未收敛/含不可信红旗");
    if (v.expectConverged === false && out.converged) failures.push("期望不收敛但收敛了");
    results.push({ id: v.id, ok: failures.length === 0, failures });
  }
  return { pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).length, results };
}
