import { type PointCloud } from "../patchwork/index.ts";
import { parseKittiBin } from "./kitti.ts";

/** Fetch one of the sample scans from `public/data`. Browser only. */
export async function loadKittiFrame(index: number): Promise<PointCloud> {
  const name = String(index).padStart(6, "0");
  const url = `${import.meta.env.BASE_URL}data/${name}.bin`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return parseKittiBin(await res.arrayBuffer());
}
