"""Reference NumPy prototype of Patchwork++ (IROS 2022).

A direct, readable translation of url-kaist/patchwork-plusplus
(cpp/patchworkpp/src/patchworkpp.cpp, BSD-2-Clause) used to verify
docs/patchwork-plusplus-guide.md and as the translation target for the
TypeScript implementation in the Three.js tutorial.

Run:  python reference/patchworkpp_prototype.py <dir-with-KITTI-.bin-frames>
"""

import sys

import numpy as np

DATA_DIR = sys.argv[1] if len(sys.argv) > 1 else "data"

P = dict(num_iter=3, num_lpr=20, num_min_pts=10, num_zones=4, n_roi=4,
         rnr_ang=-15.0, rnr_int=0.2, sensor_height=1.723,
         th_seeds=0.125, th_dist=0.125, th_seeds_v=0.25, th_dist_v=0.1,
         max_range=80.0, min_range=2.7, upright=0.707, seed_margin=-1.2,
         sectors=[16,32,54,32], rings=[2,4,4,4])

def czm_geom(p):
    lo, hi = p['min_range'], p['max_range']
    mins = [lo, (7*lo+hi)/8, (3*lo+hi)/4, (lo+hi)/2]
    ring_sz = [(mins[1]-mins[0])/p['rings'][0], (mins[2]-mins[1])/p['rings'][1],
               (mins[3]-mins[2])/p['rings'][2], (hi-mins[3])/p['rings'][3]]
    sec_sz = [2*np.pi/s for s in p['sectors']]
    return mins, ring_sz, sec_sz

def estimate_plane(pts):
    mean = pts.mean(0)
    cov = np.cov((pts-mean).T, bias=False)
    w, v = np.linalg.eigh(cov)          # ascending
    n = v[:,0]
    if n[2] < 0: n = -n
    sv = w[::-1].clip(0)                # descending
    return n, -n.dot(mean), mean, sv

def seeds(zone_idx, pts_sorted, th_seed, p, sensor_h):
    i0 = 0
    if zone_idx == 0:
        while i0 < len(pts_sorted) and pts_sorted[i0,2] < p['seed_margin']*sensor_h: i0 += 1
    lpr = pts_sorted[i0:i0+p['num_lpr'],2].mean() if i0 < len(pts_sorted) else 0.0
    return pts_sorted[pts_sorted[:,2] < lpr + th_seed]

STATE = dict(sh=P['sensor_height'], elev=[0.,0.,0.,0.], flat=[0.,0.,0.,0.])

def run(scan, p=P, verbose=True):
    p = dict(p); sh = STATE['sh']
    elev_thr = STATE['elev']; flat_thr = STATE['flat']
    xyz, inten = scan[:,:3], scan[:,3]
    r = np.hypot(xyz[:,0], xyz[:,1])
    ang = np.degrees(np.arctan2(xyz[:,2], r))
    noise = (ang < p['rnr_ang']) & (xyz[:,2] < -sh - 0.8) & (inten < p['rnr_int'])
    keep = ~noise
    ground, nonground = [], list(xyz[noise])
    mins, ring_sz, sec_sz = czm_geom(p)
    th = np.arctan2(xyz[:,1], xyz[:,0]) % (2*np.pi)
    inrange = keep & (r > p['min_range']) & (r <= p['max_range'])
    nonground += list(xyz[keep & ~inrange])
    zi = np.digitize(r, mins) - 1
    bins = {}
    idx = np.where(inrange)[0]
    for i in idx:
        z = zi[i]
        ri = min(int((r[i]-mins[z])/ring_sz[z]), p['rings'][z]-1)
        si = min(int(th[i]/sec_sz[z]), p['sectors'][z]-1)
        bins.setdefault((z,ri,si), []).append(i)
    stats = dict(nbins=0, few=0, definite=0, cand=0, reverted=0, rvpf_pts=0)
    cidx = 0; upd_e=[[] for _ in range(4)]; upd_f=[[] for _ in range(4)]
    for z in range(4):
        for ri in range(p['rings'][z]):
            ringflat = []; cands = []
            for si in range(p['sectors'][z]):
                ids = bins.get((z,ri,si))
                if ids is None or len(ids) < p['num_min_pts']:
                    if ids: nonground += list(xyz[ids]); stats['few'] += 1
                    continue
                stats['nbins'] += 1
                pts = xyz[ids]; pts = pts[np.argsort(pts[:,2])]
                # R-VPF
                src = pts
                for _ in range(p['num_iter']):
                    s = seeds(z, src, p['th_seeds_v'], p, sh)
                    if len(s) < 3: break
                    n,d,_,_ = estimate_plane(s)
                    if z == 0 and n[2] < p['upright']:
                        dist = np.abs(src @ n + d)
                        vert = dist < p['th_dist_v']
                        nonground += list(src[vert]); stats['rvpf_pts'] += int(vert.sum())
                        src = src[~vert]
                        if len(src) < 3: break
                    else: break
                if len(src) < 3: continue
                # R-GPF
                s = seeds(z, src, p['th_seeds'], p, sh)
                if len(s) < 3: s = src[:max(3,p['num_lpr'])]
                n,d,mean,sv = estimate_plane(s)
                gnd = src
                for it in range(p['num_iter']):
                    dist = src @ n + d
                    m = dist < p['th_dist']
                    gnd, rest = src[m], src[~m]
                    if gnd.shape[0] < 3: break
                    n,d,mean,sv = estimate_plane(gnd)
                # GLE
                upright = n[2] > p['upright']; near = cidx < p['n_roi']
                heading_out = mean.dot(n) < 0
                not_elev = near and mean[2] < elev_thr[cidx]
                flat = near and sv[2] < flat_thr[cidx]
                if upright and not_elev and near:
                    upd_e[cidx].append(mean[2]); upd_f[cidx].append(sv[2]); ringflat.append(sv[2]); stats['definite'] += 1
                if not upright: nonground += list(gnd)
                elif not near: ground += list(gnd)
                elif not heading_out: nonground += list(gnd)
                elif not_elev or flat: ground += list(gnd)
                else: cands.append((sv[2], sv[0]/sv[1] if sv[1] else 1e9, gnd)); stats['cand'] += 1
                nonground += list(rest)
            if cands and ringflat:
                mf, sf = np.mean(ringflat), (np.std(ringflat, ddof=1) if len(ringflat)>1 else 0)
                mu = mf + 1.5*sf
                for f, lv, g in cands:
                    pf = 1/(1+np.exp((f-mu)/(mu/10))) if mu else 0
                    if len(g) > 1500 and f < p['th_dist']**2: pf = 1.0
                    pl = 0.0 if lv > 8.0 else 1.0
                    if pl*pf > 0.5: ground += list(g); stats['reverted'] += 1
                    else: nonground += list(g)
            elif cands:
                for f,lv,g in cands: nonground += list(g)
            cidx += 1
    if verbose:
        print(f"points={len(xyz)} noise={int(noise.sum())} ground={len(ground)} nonground={len(nonground)} sum={len(ground)+len(nonground)}")
        print(stats)
        print("elev_thr next:", [float(np.mean(e)+ (3 if i==0 else 2)*np.std(e,ddof=1)) if len(e)>1 else None for i,e in enumerate(upd_e)])
        print("flat_thr next:", [float(np.mean(f)+np.std(f,ddof=1)) if len(f)>1 else None for f in upd_f])
    for i,e in enumerate(upd_e):
        if len(e) > 1:
            m, sd = float(np.mean(e)), float(np.std(e, ddof=1))
            STATE['elev'][i] = m + (3 if i==0 else 2)*sd
            if i == 0: STATE['sh'] = -m
    for i,f in enumerate(upd_f):
        if len(f) > 1:
            STATE['flat'][i] = float(np.mean(f) + np.std(f, ddof=1))
    return ground, nonground

for k in range(6):
    scan = np.fromfile(f"{DATA_DIR}/{k:06d}.bin", dtype=np.float32).reshape(-1,4)
    print(f"--- frame {k} | sensor_h={STATE['sh']:.3f} elev={[round(v,3) for v in STATE['elev']]} flat={[round(v,5) for v in STATE['flat']]}")
    run(scan)
