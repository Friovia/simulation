// P2 金向量运行器（结构沿 P0/P1/P3）。

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { P2Input } from "./types.ts";
import { solve } from "./solve.ts";
import { getPath } from "../../p0-hydraulics/src/vectors.ts";

interface VectorCheck {
  path: string;
  kind: "closeTo" | "flag" | "warningIncludes" | "inputInvalidIncludes" | "exitCode";
  value?: number | boolean | string;
  tol?: number;
}
interface Vector {
  id: string;
  note?: string;
  input: P2Input;
  checks: VectorCheck[];
  expectConverged?: boolean;
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
      if (chk.kind === "warningIncludes" || chk.kind === "inputInvalidIncludes") {
        const src = chk.kind === "warningIncludes" ? out.warnings : out.inputInvalid;
        if (!src.some((s) => s.includes(String(chk.value ?? "")))) {
          failures.push(`${chk.kind} 不含「${chk.value}」（实际：${src.join(" | ") || "无"}）`);
        }
        continue;
      }
      if (chk.kind === "exitCode") {
        const code = out.inputInvalid.length ? 2 : out.converged ? 0 : 1;
        if (code !== chk.value) failures.push(`exitCode=${code} ≠ 期望 ${chk.value}`);
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
      const v2 = chk.value;
      if (typeof v2 !== "number") { failures.push(`${chk.path} closeTo 期望值非数值`); continue; }
      const tol = chk.tol ?? 1e-9;
      if (Math.abs(a - v2) / Math.max(Math.abs(v2), 1e-9) > tol) {
        failures.push(`${chk.path}=${a} ≠ 期望 ${v2} (tol ${tol})`);
      }
    }
    if (v.expectConverged !== false && !out.converged) failures.push("求解未收敛");
    if (v.expectConverged === false && out.converged) failures.push("期望不收敛但收敛了");
    results.push({ id: v.id, ok: failures.length === 0, failures });
  }
  return { pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).length, results };
}
