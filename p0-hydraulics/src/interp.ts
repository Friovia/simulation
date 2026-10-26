import type { Curve } from "./types.ts";

export interface InterpResult {
  v: number;
  clamped: boolean; // x 越出曲线域：钳位取端点值并暴露，禁止静默外推
}

// 类型层收窄：曲线点经入库校验稠密（x 严格单调升、≥3 点），此处防御仅满足
// noUncheckedIndexedAccess——触发即上游校验失效，属程序性错误。
function pt(points: readonly [number, number][], i: number): [number, number] {
  const p = points[i];
  if (p === undefined) throw new Error(`interp: 点索引越界 ${i}/${points.length}`);
  return p;
}

// 分段线性插值。曲线点已通过入库校验（x 严格单调升、≥3 点）。
export function interpCurve(curve: Curve, x: number): InterpResult {
  const pts = curve.points;
  const n = pts.length;
  const first = pt(pts, 0);
  const last = pt(pts, n - 1);
  if (x <= first[0]) return { v: first[1], clamped: x < first[0] };
  if (x >= last[0]) return { v: last[1], clamped: x > last[0] };
  for (let i = 1; i < n; i++) {
    const pi = pt(pts, i);
    if (x <= pi[0]) {
      const [x0, y0] = pt(pts, i - 1);
      const [x1, y1] = pi;
      return { v: y0 + ((y1 - y0) * (x - x0)) / (x1 - x0), clamped: false };
    }
  }
  throw new Error("interp: unreachable");
}

export function isStrictlyIncreasingX(points: [number, number][]): boolean {
  for (let i = 1; i < points.length; i++) {
    if (pt(points, i)[0] <= pt(points, i - 1)[0]) return false;
  }
  return true;
}
