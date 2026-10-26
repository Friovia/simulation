// 金向量运行器：p0 vectors 即 CI（README·AI-native 落地）。
// 向量 JSON 结构：
// { "id": "...", "note": "...", "input": P0Input,
//   "checks": [{ "path": "branches[0].qLpm", "kind": "closeTo", "value": 12.3, "tol": 1e-6 },
//              { "path": "a", "kind": "equalsPath", "path2": "b", "tol": 1e-9 },
//              { "path": "residual", "kind": "lessThan", "value": 1e-8 }] }

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { P0Input } from "./types.ts";
import { solve } from "./solve.ts";

interface VectorCheck {
  path: string;
  kind: "closeTo" | "equalsPath" | "lessThan" | "warningIncludes" | "exitCode";
  value?: number;
  path2?: string;
  tol?: number;
}
interface Vector {
  id: string;
  note?: string;
  input: P0Input;
  checks: VectorCheck[];
  expectConverged?: boolean; // 默认 true；false = 失败路径向量（F14）
}

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  const re = /([^[.\]]+)|\[(\d+)\]/g;
  for (const m of path.matchAll(re)) {
    if (cur == null) return undefined;
    const key = m[2] != null ? Number(m[2]) : (m[1] ?? "");
    cur = (cur as Record<string | number, unknown>)[key as string | number];
  }
  return cur;
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
        // F14：失败路径/警告断言，不经过数值守卫
        const w = out.warnings ?? [];
        if (!w.some((s) => s.includes(String(chk.value ?? "")))) {
          failures.push(`warnings 不含「${chk.value}」（实际：${w.join(" | ") || "无"}）`);
        }
        continue;
      }
      if (chk.kind === "exitCode") {
        // N2：CLI 退出码分类断言（0=通过 1=数值失败 2=输入无效，cli.ts 同款映射）
        const code = out.inputInvalid.length ? 2 : out.converged ? 0 : 1;
        if (code !== chk.value) {
          failures.push(`exitCode=${code} ≠ 期望 ${chk.value}（inputInvalid=${out.inputInvalid.length} 项，converged=${out.converged}）`);
        }
        continue;
      }
      const a = getPath(out, chk.path);
      if (typeof a !== "number" || !Number.isFinite(a)) {
        failures.push(`${chk.path} 非有限数值：${String(a)}`);
        continue;
      }
      if (chk.kind === "closeTo") {
        if (typeof chk.value !== "number") { failures.push(`${chk.path} closeTo 期望值非数值`); continue; }
        const v2 = chk.value;
        const tol = chk.tol ?? 1e-9;
        if (Math.abs(a - v2) / Math.max(Math.abs(v2), 1e-9) > tol) {
          failures.push(`${chk.path}=${a} ≠ 期望 ${v2} (tol ${tol})`);
        }
      } else if (chk.kind === "equalsPath") {
        const b = getPath(out, chk.path2!);
        const tol = chk.tol ?? 1e-9;
        if (typeof b !== "number" || Math.abs(a - b as number) / Math.max(Math.abs(a), 1e-9) > tol) {
          failures.push(`${chk.path}=${a} ≠ ${chk.path2}=${String(b)} (tol ${tol})`);
        }
      } else if (chk.kind === "lessThan") {
        if (!(a < (chk.value ?? 0))) failures.push(`${chk.path}=${a} 不小于 ${chk.value}`);
      }
    }
    if (v.expectConverged !== false && !out.converged) failures.push("求解未收敛");
    if (v.expectConverged === false && out.converged) failures.push("期望不收敛但收敛了");
    results.push({ id: v.id, ok: failures.length === 0, failures });
  }
  return { pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).length, results };
}
