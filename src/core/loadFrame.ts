import type { PointCloud } from "../patchwork/index.ts";
import { decodeQuantizedCloud } from "./pcq.ts";

/** Bytes received so far, and the total when the server reports one. */
export interface LoadProgress {
  received: number;
  total: number | null;
}

/**
 * Fetch one of the sample scans from `public/data`. Browser only.
 *
 * Streamed rather than awaited whole, so the status chip can say what it is waiting for:
 * the download is the entire wait on a slow connection. Segmenting the scan afterwards is
 * fast enough to happen between two frames.
 */
export async function loadKittiFrame(
  name: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<PointCloud> {
  const url = `${import.meta.env.BASE_URL}data/${name}.pcq`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);

  const length = res.headers.get("content-length");
  const total = length ? Number(length) : null;

  // No reader (or no callback) means nothing to report; take the simple path.
  if (!res.body || !onProgress) return decodeQuantizedCloud(await res.arrayBuffer());

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress({ received, total });
  }

  const buffer = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  return decodeQuantizedCloud(buffer.buffer as ArrayBuffer);
}
