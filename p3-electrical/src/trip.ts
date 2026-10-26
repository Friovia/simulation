// 断路器脱扣特性器件库 + 校核（2026-10-20 采集批次）。
// 全部为热磁（TM）脱扣、真 DC 安培值（48V 场景无电子 I²t 模式——三家 DC 产品均为 TM，产品事实）。
// IEC 60947-2 不规定 MCCB 磁脱扣标准带（BEAMA 指南），数值一律以厂商 datasheet 为准；磁带容差 ±20%（标准瞬时容差）。
//
// 来源（2026-10-20 访问核实）：
//   - Schneider DOCA0066EN-05《ComPact NSX DC 100-1200A User Guide》（16-1200A，750Vdc 级）
//     https://productinfo.se.com/compactnsxdclegacyuserguide/doca0066-compact-nsx-dc-legacy-user-guide/English/DOCA0066EN-05.pdf
//   - Chint《NM8N MCCB Catalog》（16-1600A；DC 250/500/750/1000V；IEC/EN 60947-2；DC 段仅 TM）
//     https://www.chintglobal.com/content/dam/chint/global/product-center/low-voltage/iec/secondary-power-distribution/mccb/nm8n/catalog/NM8N-MCCB-Catalog.pdf
//   - ABB 2CDC400002D0201（MCB 直流修正：电磁脱扣值 ×1.5；K 特性 ≤14·In）
//     https://library.e.abb.com/public/114371fcc8e0456096db42d614bead67/2CDC400002D0201_view.pdf
//   - selectivity 判据：BEAMA《Guide to LV Circuit-Breaker Standards》5.4.3.1 峰值穿透法
//     https://www.beama.org.uk/static/2ccf2300-dc04-42e1-86b5a1fb8986c75d/guide-to-low-voltage-circuit-breakers.pdf
//     Siemens 3VA Selectivity Manual（<100ms 区用 I²t，DIN VDE 0636-2 Table 113）
//     https://support.industry.siemens.com/cs/attachments/109743975/3VA_configuring_manual_selectivity_en_en-US.pdf

export type TripDeviceId =
  | "nsx-tmd-1p2p-fixed" // TM-D 1P/2P，16-160A，Ii 固定绝对值
  | "nsx-tmdc-3p4p-adjust" // TM-DC 3P/4P，250-600A，Ii 6 档可调绝对值
  | "nm8n-125-fixed" // NM8N 125 壳架，16-125A，Ii=10×In 固定
  | "nm8n-250-fixed" // NM8N 250 壳架，125-250A，Ii=10×In 固定
  | "mcb-k-dc"; // K 特性 MCB（IEC 60947-2），DC 磁值 ×1.5 → 上限 21×In

export interface TripDevice {
  id: TripDeviceId;
  vendor: string;
  family: string;
  /** 允许的 In 档（A）；空数组=任意（MCB） */
  inA: number[];
  /** 过载 Ir 档（×In）；默认取数组尾（多数 1.0） */
  irXIn: number[];
  iiMode: "fixed-abs" | "adjust-abs" | "fixed-x-in";
  /** fixed-abs：In→Ii(A) */
  iiFixedA?: Record<number, number>;
  /** adjust-abs：In→[min,max](A)（设定值 iiA 必须落在内） */
  iiAdjustA?: Record<number, [number, number]>;
  /** fixed-x-in：Ii = iiXIn × In */
  iiXIn?: number;
  tolerancePct: number; // 磁带容差（±%）
  sourceUrl: string;
  note?: string;
}

export const TRIP_DEVICES: Record<TripDeviceId, TripDevice> = {
  "nsx-tmd-1p2p-fixed": {
    id: "nsx-tmd-1p2p-fixed",
    vendor: "Schneider",
    family: "ComPact NSX DC TM-D 1P/2P",
    inA: [16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160],
    irXIn: [1.0], // 1P/2P 固定 = In
    iiMode: "fixed-abs",
    iiFixedA: { 16: 260, 20: 260, 25: 400, 32: 400, 40: 700, 50: 700, 63: 700, 80: 800, 100: 1000, 125: 1200, 160: 1250 },
    tolerancePct: 20,
    sourceUrl: "https://productinfo.se.com/compactnsxdclegacyuserguide/doca0066-compact-nsx-dc-legacy-user-guide/English/DOCA0066EN-05.pdf",
    note: "DOCA0066EN-05 表：Fixed pickup Ii (A) +/- 20% DC value（TM-D 1P/2P 列）",
  },
  "nsx-tmdc-3p4p-adjust": {
    id: "nsx-tmdc-3p4p-adjust",
    vendor: "Schneider",
    family: "ComPact NSX DC TM-DC 3P/4P 250-600A",
    inA: [250, 320, 400, 500, 600],
    irXIn: [0.7, 0.8, 0.9, 1.0],
    iiMode: "adjust-abs",
    iiAdjustA: { 250: [625, 1250], 320: [800, 1600], 400: [1000, 2000], 500: [1250, 2500], 600: [1500, 3000] },
    tolerancePct: 20,
    sourceUrl: "https://productinfo.se.com/compactnsxdclegacyuserguide/doca0066-compact-nsx-dc-legacy-user-guide/English/DOCA0066EN-05.pdf",
    note: "TM-DC 250-600A 可调档（近似 2.5-5×In），5 档 ±20%",
  },
  "nm8n-125-fixed": {
    id: "nm8n-125-fixed",
    vendor: "Chint",
    family: "NM8N-125 DC（125 壳架）",
    inA: [16, 20, 25, 32, 40, 50, 63, 80, 100, 125],
    irXIn: [1.0], // 125 壳架 Ir=In×1.0 不可调
    iiMode: "fixed-x-in",
    iiXIn: 10,
    tolerancePct: 20,
    sourceUrl: "https://www.chintglobal.com/content/dam/chint/global/product-center/low-voltage/iec/secondary-power-distribution/mccb/nm8n/catalog/NM8N-MCCB-Catalog.pdf",
    note: "NM8N 样本：125/250 壳架 Ii=In×10 固定（Accuracy ±20%）；DC 250-1000V 仅 TM 脱扣",
  },
  "nm8n-250-fixed": {
    id: "nm8n-250-fixed",
    vendor: "Chint",
    family: "NM8N-250 DC（250 壳架）",
    inA: [125, 160, 180, 200, 225, 250],
    irXIn: [0.7, 0.8, 0.9, 1.0],
    iiMode: "fixed-x-in",
    iiXIn: 10,
    tolerancePct: 20,
    sourceUrl: "https://www.chintglobal.com/content/dam/chint/global/product-center/low-voltage/iec/secondary-power-distribution/mccb/nm8n/catalog/NM8N-MCCB-Catalog.pdf",
    note: "同上（250 壳架 Ir 0.7-1.0 可调）",
  },
  "mcb-k-dc": {
    id: "mcb-k-dc",
    vendor: "通用（ABB 文档口径）",
    family: "K 特性 MCB（IEC 60947-2）DC 应用",
    inA: [],
    irXIn: [1.0],
    iiMode: "fixed-x-in",
    iiXIn: 21, // K：AC 上限 14×In（"trips at the latest at 14·In"）；DC 电磁值 ×1.5 → 21×In（上限口径）
    tolerancePct: 20,
    sourceUrl: "https://library.e.abb.com/public/114371fcc8e0456096db42d614bead67/2CDC400002D0201_view.pdf",
    note: "K 特性 14·In 为必跳上限（pickup 带下限未在源文档给出）；DC 修正因子 1.5 为 ABB 文档原文。上限口径：实际 pickup ≤ 21×In",
  },
};

export const TRIP_VERSION = "trip-v1-2026-10-20";

/** 解析一台器件的脱扣参数。ok=false 时 errs 给原因（判别联合，调用侧收窄）。 */
export type TripResolved =
  | { ok: true; dev: TripDevice; irA: number; iiA: number; iiBand: [number, number] }
  | { ok: false; errs: string[] };

export function resolveTrip(
  deviceId: string,
  inA: number,
  irXIn: number | undefined,
  iiA: number | undefined,
): TripResolved {
  const dev = TRIP_DEVICES[deviceId as TripDeviceId];
  if (!dev) return { ok: false, errs: [`trip deviceId 未知：${deviceId}`] };
  if (!(inA > 0)) return { ok: false, errs: ["trip inA 必须 > 0"] };
  if (dev.inA.length > 0 && !dev.inA.includes(inA)) {
    return { ok: false, errs: [`${deviceId} 无 In=${inA} 档（可用：${dev.inA.join("/")}）`] };
  }
  const ir = irXIn ?? dev.irXIn[dev.irXIn.length - 1] ?? 1.0;
  if (!dev.irXIn.includes(ir)) {
    return { ok: false, errs: [`${deviceId} 无 Ir=${ir}×In 档（可用：${dev.irXIn.join("/")}）`] };
  }
  const irA = ir * inA;
  let ii: number;
  if (dev.iiMode === "fixed-abs") {
    const fixed = dev.iiFixedA?.[inA];
    if (fixed === undefined) return { ok: false, errs: [`${deviceId} 缺 In=${inA} 的 Ii 表值（数据登记缺口）`] };
    ii = fixed;
  } else if (dev.iiMode === "adjust-abs") {
    const range = dev.iiAdjustA?.[inA];
    if (range === undefined) return { ok: false, errs: [`${deviceId} 缺 In=${inA} 的可调档表（数据登记缺口）`] };
    if (!(typeof iiA === "number" && iiA >= range[0] && iiA <= range[1])) {
      return { ok: false, errs: [`${deviceId} In=${inA} 的 Ii 设定必须在 [${range[0]}, ${range[1]}] A（收到 ${String(iiA)}）`] };
    }
    ii = iiA;
  } else {
    ii = (dev.iiXIn ?? 0) * inA;
  }
  const tol = dev.tolerancePct / 100;
  return { ok: true, dev, irA, iiA: ii, iiBand: [ii * (1 - tol), ii * (1 + tol)] };
}

/** 瞬时校核：Isc 与 ±容差带的三态判定（诚实语义：带内不定） */
export function instantaneousVerdict(
  iscA: number,
  band: [number, number],
): "certain-trip" | "no-trip" | "uncertain" {
  if (iscA < band[0]) return "no-trip";
  if (iscA > band[1]) return "certain-trip";
  return "uncertain";
}

/**
 * 上下级选择性（短路区，保守 RMS 判据）。
 * BEAMA 峰值穿透法的保守简化：不计下级限流削峰，部分选择性极限（保守下界）= 上级磁脱扣带下限 Ii_min。
 * 凡 Isc < Ii_min(rms)，上级磁脱扣必不动作 → 至少部分选择性到该电流。
 * 全选择性（本简化内）= 下级磁带上限 ≤ 上级带下限（下游任何容差组合都先动作）。
 * 未实现：<100ms I²t 能量法（需穿透 I²t 曲线，三家 DC 产品无公开数据，红灯保留）。
 */
export function selectivityConservative(
  upstreamBand: [number, number],
  downstreamBand: [number, number],
): { conservativeLimitA: number; fullSelectivity: boolean } {
  return {
    conservativeLimitA: upstreamBand[0],
    fullSelectivity: downstreamBand[1] <= upstreamBand[0],
  };
}
