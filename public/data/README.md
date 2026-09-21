# Scans, as served

`000000.pcq` … `000005.pcq` are the six sample scans in the quantized format described in
`src/core/pcq.ts`: 16-bit fixed-point positions at 2.5 mm and one byte of intensity, 7
bytes a point instead of KITTI's 16. Regenerate them from the raw scans in `data/raw` with:

```
pnpm run data:quantize
```

The tutorial fetches one of them (the hero frame); the rest are here so the verification
script hashes byte-identical inputs to what the site serves.
