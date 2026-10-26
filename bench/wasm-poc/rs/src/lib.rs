// P0 液力 PoC 求解器 —— Rust→WASM 侧，ts/physics.ts 的孪生实现。
// ABI：单一 f64 线性缓冲区（BUF），JS 侧通过 buf_ptr() 拿指针做 Float64Array 视图。
//   输入区  BUF[0 .. 10+4n]
//   输出区  BUF[2048 .. 2048+4+2n]  （[Q_total, P_branch, head_m, q_j×n, Re_j×n, residual]）
//   MC 汇总 BUF[2032..2035]        （[mean, min, max]）
// 物性为占位线性拟合（非生产数据），物理假设见 ts/physics.ts 头注。

#![allow(static_mut_refs)]

const PI: f64 = std::f64::consts::PI;
const OUT: usize = 2048;
const MC_AGG: usize = 2032;
const MAXN: usize = 32;

static mut BUF: [f64; 4096] = [0.0; 4096];

#[no_mangle]
pub extern "C" fn buf_ptr() -> *mut f64 {
    unsafe { BUF.as_mut_ptr() }
}

#[inline]
fn rho_t(t: f64) -> f64 {
    1037.0 - 0.65 * (t - 25.0)
}
#[inline]
fn mu_t(t: f64) -> f64 {
    (3.0 - 0.045 * (t - 25.0)) * 1e-3
}

#[inline]
fn branch_dp(q: f64, d: f64, l: f64, k: f64, eps: f64, rho: f64, mu: f64) -> f64 {
    let area = PI * d * d / 4.0;
    let v = q / area;
    let re = rho * v * d / mu;
    let f = if re < 2300.0 {
        64.0 / re
    } else {
        let inv = -1.8 * ((eps / d / 3.7).powf(1.11) + 6.9 / re).log10();
        1.0 / (inv * inv)
    };
    (k + f * l / d) * rho * v * v / 2.0
}

#[inline]
fn branch_qp(p: f64, d: f64, l: f64, k: f64, eps: f64, rho: f64, mu: f64) -> f64 {
    let mut lo = 0.0;
    let mut hi = 0.005;
    for _ in 0..40 {
        let mid = 0.5 * (lo + hi);
        if branch_dp(mid, d, l, k, eps, rho, mu) < p {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    0.5 * (lo + hi)
}

// 与 TS solve() 逐操作对齐；返回 Q_total，输出写入 out。
fn solve_core(inp: &[f64], n: usize, out: &mut [f64]) -> f64 {
    let t_mean = 0.5 * (inp[1] + inp[2]);
    let rho = rho_t(t_mean);
    let mu = mu_t(t_mean);
    let g = inp[9];

    let mut lo = 0.0;
    let mut hi = 300000.0;
    for _ in 0..60 {
        let p = 0.5 * (lo + hi);
        let mut q_tot = 0.0;
        for j in 0..n {
            let b = 10 + 4 * j;
            q_tot += branch_qp(p, inp[b], inp[b + 1], inp[b + 2], inp[b + 3], rho, mu);
        }
        let sr = branch_dp(q_tot, inp[5], 2.0 * inp[6], 2.0 * inp[7], inp[8], rho, mu);
        let head_pa = rho * g * (inp[3] - inp[4] * q_tot * q_tot);
        if head_pa - (sr + p) > 0.0 {
            lo = p;
        } else {
            hi = p;
        }
    }
    let p_star = 0.5 * (lo + hi);

    let mut q_tot = 0.0;
    for j in 0..n {
        let b = 10 + 4 * j;
        let qj = branch_qp(p_star, inp[b], inp[b + 1], inp[b + 2], inp[b + 3], rho, mu);
        out[3 + j] = qj;
        let v = qj / (PI * inp[b] * inp[b] / 4.0);
        out[3 + n + j] = rho * v * inp[b] / mu;
        q_tot += qj;
    }
    let sr = branch_dp(q_tot, inp[5], 2.0 * inp[6], 2.0 * inp[7], inp[8], rho, mu);
    let head_pa = rho * g * (inp[3] - inp[4] * q_tot * q_tot);
    out[0] = q_tot;
    out[1] = p_star;
    out[2] = head_pa / (rho * g);
    out[3 + 2 * n] = (head_pa - (sr + p_star)) / head_pa;
    q_tot
}

#[inline]
fn lcg(x: u32) -> u32 {
    x.wrapping_mul(1664525).wrapping_add(1013904223)
}

#[no_mangle]
pub extern "C" fn solve(n: i32) -> i32 {
    let n = n as usize;
    if n == 0 || n > MAXN as usize {
        return 1;
    }
    let ilen = 10 + 4 * n;
    let olen = 4 + 2 * n;
    let mut inp = [0.0f64; 10 + 4 * MAXN];
    unsafe {
        for i in 0..ilen {
            inp[i] = BUF[i];
        }
    }
    let mut out = [0.0f64; 4 + 2 * MAXN];
    solve_core(&inp, n, &mut out);
    unsafe {
        for i in 0..olen {
            BUF[OUT + i] = out[i];
        }
    }
    0
}

// 批量蒙特卡洛：扰动序与 ts/physics.ts 的 mc() 严格一致（h0 先、支路后）。
#[no_mangle]
pub extern "C" fn solve_mc(n: i32, samples: i32, seed: i32) -> i32 {
    let n = n as usize;
    if n == 0 || n > MAXN as usize || samples <= 0 {
        return 1;
    }
    let ilen = 10 + 4 * n;
    let mut pristine = [0.0f64; 10 + 4 * MAXN];
    unsafe {
        for i in 0..ilen {
            pristine[i] = BUF[i];
        }
    }
    let mut work = pristine;
    let mut out = [0.0f64; 4 + 2 * MAXN];
    let mut x = seed as u32;
    let mut sum = 0.0;
    let mut mn = f64::INFINITY;
    let mut mx = f64::NEG_INFINITY;
    for _ in 0..samples {
        x = lcg(x);
        work[3] = pristine[3] * (0.95 + 0.1 * (x as f64 / 4294967296.0));
        for j in 0..n {
            x = lcg(x);
            let u = x as f64 / 4294967296.0;
            work[10 + 4 * j + 2] = pristine[10 + 4 * j + 2] * (0.8 + 0.4 * u);
        }
        let q = solve_core(&work, n, &mut out);
        sum += q;
        if q < mn {
            mn = q;
        }
        if q > mx {
            mx = q;
        }
    }
    let olen = 4 + 2 * n;
    unsafe {
        for i in 0..olen {
            BUF[OUT + i] = out[i];
        }
        BUF[MC_AGG] = sum / samples as f64;
        BUF[MC_AGG + 1] = mn;
        BUF[MC_AGG + 2] = mx;
    }
    0
}
