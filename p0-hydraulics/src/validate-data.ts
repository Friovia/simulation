// 曲线库入库校验器：p0 validate-data —— schema.md 数据政策的机器执行。
// 退出码约定（契约）：0=通过；2=数据无效。

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isStrictlyIncreasingX } from "./interp.ts";

const TYPES = ["pump", "cold-plate", "qd", "manifold", "hx", "fan", "dx-unit"];
const SRC_TYPES = ["datasheet", "literature", "ocp-spec", "measured"];

// JSONC → JSON：状态机剥离 // 与 /* */ 注释（字符串内的 https:// 不受影响）
export function stripJsonc(text: string): string {
  let out = "";
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inStr) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (ch === '"') inStr = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

interface CurveRec {
  id?: string;
  type?: string;
  vendor?: string;
  model?: string;
  fluid?: { basis?: string };
  curve?: { x?: string; y?: string; points?: [number, number][] } | null;
  source?: { url?: string; type?: string; retrieved?: string };
  uncertainty?: string;
  redlight?: string | null;
}

export interface DataIssue {
  file: string;
  id: string;
  errors: string[];
}

export function validateDir(dir: string): { entries: number; redlights: number; issues: DataIssue[] } {
  let entries = 0;
  let redlights = 0;
  const issues: DataIssue[] = [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonc") || f.endsWith(".json")).sort();
  const ids = new Set<string>();
  for (const f of files) {
    const raw = JSON.parse(stripJsonc(readFileSync(join(dir, f), "utf8")));
    const recs: CurveRec[] = Array.isArray(raw) ? raw : raw.records ?? [raw];
    for (const r of recs) {
      entries++;
      const id = r.id ?? "(无 id)";
      const errs: string[] = [];
      if (!r.id) errs.push("缺 id");
      else if (ids.has(r.id)) errs.push(`id 重复：${r.id}`);
      else ids.add(r.id);
      if (!r.type || !TYPES.includes(r.type)) errs.push(`type 非法：${String(r.type)}`);
      if (!r.vendor || !r.model) errs.push("缺 vendor/model");
      if (!r.fluid?.basis) errs.push("缺 fluid.basis（工质基准）");
      const src = r.source;
      if (!src?.url || !/^https?:\/\//.test(src.url)) errs.push("缺合法 source.url（无源不入库）");
      if (!src?.type || !SRC_TYPES.includes(src.type)) errs.push(`source.type 非法：${String(src?.type)}`);
      if (!r.source?.retrieved) errs.push("缺 source.retrieved");
      if (!r.uncertainty) errs.push("缺 uncertainty");
      if (r.redlight) {
        redlights++;
        if (r.curve != null) errs.push("redlight 条目必须 curve=null");
      } else if (r.curve) {
        // 单位文法按域校验（schema.md 2026-10-17 增补）
        const hydraulic = ["pump", "cold-plate", "qd", "manifold"];
        const c = r.curve as { x?: string; y?: string; flowBasis?: string; points?: [number, number][] };
        if (r.type === "hx") {
          if (c.x !== "°C") errs.push(`curve.x 非法（热域应为 °C）：${String(c.x)}`);
          if (c.y !== "kW") errs.push(`curve.y 非法（热域应为 kW）：${String(c.y)}`);
          if (!c.flowBasis) errs.push("热域曲线缺 curve.flowBasis（流量基准）");
        } else if (hydraulic.includes(r.type ?? "")) {
          if (c.x !== "L/min") errs.push(`curve.x 非法：${String(c.x)}`);
          if (c.y !== "kPa" && c.y !== "m") errs.push(`curve.y 非法：${String(c.y)}`);
        } else {
          // fan / dx-unit：风域文法待首批数据落地定义，暂只查结构
        }
        const pts = c.points;
        if (!Array.isArray(pts) || pts.length < 3) errs.push("curve.points < 3");
        else if (!isStrictlyIncreasingX(pts)) errs.push("curve.points x 非严格单调升");
      } else {
        errs.push("既无 curve 也无 redlight");
      }
      if (errs.length) issues.push({ file: f, id, errors: errs });
    }
  }
  return { entries, redlights, issues };
}
