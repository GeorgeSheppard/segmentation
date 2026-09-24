# Scans, as served

`000000.pcq` … `000005.pcq` are the six sample scans in the quantized format described in
`src/core/pcq.ts`: 16-bit fixed-point positions at 2.5 mm and one byte of intensity, 7
bytes a point instead of KITTI's 16. Regenerate them from the raw scans in `data/raw` with:

```
pnpm run data:quantize
```

The tutorial fetches one of them (the hero frame); the rest are here so the verification
script hashes byte-identical inputs to what the site serves.

`*.labels.rle` files are the pipeline's *final* per-point verdict for the matching `.pcq`
— ground or not, nothing in between — run-length encoded (`src/core/labelsRle.ts`) to a
few KB. Regenerate with:

```
pnpm run data:bake-labels
```

They are not a substitute for running the pipeline: the tutorial's own twelve stages read
the full per-cell trace (`FrameTrace`), which stays too large and irregular to bake this
way and is still computed live, once, for the default scan. These exist for colouring a
scan — any scan — without that cost, which only starts to matter once more than one is on
screen at a time.
