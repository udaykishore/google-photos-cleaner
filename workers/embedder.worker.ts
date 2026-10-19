/// <reference lib="webworker" />

// Standalone Web Worker for MediaPipe image embedding AND community detection.
// Built separately with esbuild so it can be loaded as a classic worker
// from the extension (CSP: script-src 'self').
//
// Message protocol (main → worker):
//   { type: "init", data: { wasmLoaderUrl, wasmBinaryUrl, modelBuffer: ArrayBuffer } }
//   { type: "embed", data: { items: Array<{ localIdx: number, blob: Blob }> } }
//   { type: "detect", data: { flatEmbeddings: Float32Array, n: number, dim: number, threshold: number } }
//   { type: "detectSmart", data: { flatEmbeddings: Float32Array, n: number, dim: number, threshold: number, buckets: number[][] } }
//
// Message protocol (worker → main):
//   { type: "ready" }
//   { type: "results", results: Array<{ localIdx: number, embedding: ArrayBuffer }> }
//   { type: "initError", message: string }
//   { type: "detectionProgress", current: number, total: number }
//   { type: "detectionResults", groups: number[][] }

import { ImageEmbedder } from "@mediapipe/tasks-vision";

let embedder: ImageEmbedder | null = null;

self.addEventListener("message", async (event: MessageEvent) => {
  const { type, data } = event.data;

  if (type === "init") {
    try {
      const { wasmLoaderUrl, wasmBinaryUrl, modelBuffer } = data as {
        wasmLoaderUrl: string;
        wasmBinaryUrl: string;
        modelBuffer: ArrayBuffer;
      };

      // Pre-load the WASM loader JS via importScripts (CSP-safe from extension origin).
      // This is the same workaround as the main thread: load the global manually so
      // MediaPipe can find it, then pass wasmLoaderPath: "" to skip its own injection.
      importScripts(wasmLoaderUrl);

      const vision = {
        wasmLoaderPath: "",
        wasmBinaryPath: wasmBinaryUrl,
      };

      embedder = await ImageEmbedder.createFromOptions(vision, {
        baseOptions: { modelAssetBuffer: new Uint8Array(modelBuffer) },
        quantize: false,
        l2Normalize: true,
        runningMode: "IMAGE",
      });

      self.postMessage({ type: "ready" });
    } catch (e) {
      self.postMessage({ type: "initError", message: String(e) });
    }
  }

  if (type === "embed") {
    const { items } = data as {
      items: Array<{ localIdx: number; blob: Blob }>;
    };

    const results: Array<{ localIdx: number; embedding: ArrayBuffer }> = [];

    for (const { localIdx, blob } of items) {
      try {
        const bitmap = await createImageBitmap(blob);
        const w = bitmap.width;
        const h = bitmap.height;
        const angles = [0, 90, 180, 270];
        const angleEmbeddings: Float32Array[] = [];

        for (const angle of angles) {
          const isTransposed = angle === 90 || angle === 270;
          const cw = isTransposed ? h : w;
          const ch = isTransposed ? w : h;
          const canvas = new OffscreenCanvas(cw, ch);
          const ctx = canvas.getContext("2d")!;

          if (angle === 0) {
            ctx.drawImage(bitmap, 0, 0);
          } else {
            ctx.translate(cw / 2, ch / 2);
            ctx.rotate((angle * Math.PI) / 180);
            ctx.drawImage(bitmap, -w / 2, -h / 2);
          }

          const imageData = ctx.getImageData(0, 0, cw, ch);

          // Black frame / low-variance guard: protect against solid black opening frames
          const px = imageData.data;
          let sumL = 0;
          let sumSqL = 0;
          const sampleStep = 16;
          let sampleCount = 0;
          for (let p = 0; p < px.length; p += sampleStep) {
            const lum = 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2];
            sumL += lum;
            sumSqL += lum * lum;
            sampleCount++;
          }
          const meanL = sumL / sampleCount;
          const varL = sumSqL / sampleCount - meanL * meanL;
          const isBlank = meanL < 18 && varL < 20;

          if (isBlank) {
            // Assign a unique unit vector per item so black frames never false-match
            const dimSize = 1024;
            const uniqueVec = new Float32Array(dimSize);
            let norm = 0;
            for (let vi = 0; vi < dimSize; vi++) {
              const v = Math.sin((localIdx + 1) * 9973 + vi * 7919 + angle);
              uniqueVec[vi] = v;
              norm += v * v;
            }
            norm = Math.sqrt(norm);
            for (let vi = 0; vi < dimSize; vi++) uniqueVec[vi] /= norm;
            angleEmbeddings.push(uniqueVec);
          } else {
            const result = embedder!.embed(imageData);
            if (result?.embeddings?.[0]?.floatEmbedding) {
              angleEmbeddings.push(
                new Float32Array(result.embeddings[0].floatEmbedding),
              );
            }
          }
        }

        bitmap.close();

        if (angleEmbeddings.length > 0) {
          const singleDim = angleEmbeddings[0].length;
          while (angleEmbeddings.length < 4) {
            angleEmbeddings.push(angleEmbeddings[0]);
          }
          const combined = new Float32Array(4 * singleDim);
          for (let aIdx = 0; aIdx < 4; aIdx++) {
            combined.set(angleEmbeddings[aIdx], aIdx * singleDim);
          }
          results.push({ localIdx, embedding: combined.buffer.slice(0) });
        }
      } catch {
        // Skip unprocessable images
      }
    }

    const transferables = results.map((r) => r.embedding);
    self.postMessage({ type: "results", results }, transferables);
  }

  if (type === "detect") {
    const { flatEmbeddings, n, dim, threshold, timestamps } = data as {
      flatEmbeddings: Float32Array;
      n: number;
      dim: number;
      threshold: number;
      timestamps?: number[];
    };

    // Unpack flat buffer back into array of row views (zero-copy)
    const embeddings: Float32Array[] = [];
    for (let i = 0; i < n; i++) {
      embeddings.push(flatEmbeddings.subarray(i * dim, (i + 1) * dim));
    }

    const groups = await workerCommunityDetection(
      embeddings,
      threshold,
      timestamps,
      (current, total) => {
        self.postMessage({ type: "detectionProgress", current, total });
      },
    );
    self.postMessage({ type: "detectionResults", groups });
  }

  if (type === "detectSmart") {
    const { flatEmbeddings, n, dim, threshold, buckets } = data as {
      flatEmbeddings: Float32Array;
      n: number;
      dim: number;
      threshold: number;
      buckets: number[][];
    };

    // Unpack flat buffer into row views (zero-copy)
    const embeddings: Float32Array[] = [];
    for (let i = 0; i < n; i++)
      embeddings.push(flatEmbeddings.subarray(i * dim, (i + 1) * dim));

    const allGroups: number[][] = [];
    for (let bi = 0; bi < buckets.length; bi++) {
      const bucket = buckets[bi];
      // Union-Find over bucket indices
      const parent = bucket.map((_, j) => j);
      const find = (x: number): number =>
        parent[x] === x ? x : (parent[x] = find(parent[x]));
      const union = (a: number, b: number) => {
        parent[find(a)] = find(b);
      };

      const baseDim = dim % 4 === 0 && dim >= 512 ? Math.floor(dim / 4) : dim;
      const numRots = dim % 4 === 0 && dim >= 512 ? 4 : 1;

      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          const a = embeddings[bucket[i]];
          const b = embeddings[bucket[j]];
          let maxDot = -1;
          for (let rot = 0; rot < numRots; rot++) {
            let dot = 0;
            const bOffset = rot * baseDim;
            for (let k = 0; k < baseDim; k++) dot += a[k] * b[bOffset + k];
            if (dot > maxDot) maxDot = dot;
          }
          if (maxDot >= threshold) union(i, j);
        }
      }

      const components = new Map<number, number[]>();
      for (let i = 0; i < bucket.length; i++) {
        const root = find(i);
        if (!components.has(root)) components.set(root, []);
        components.get(root)!.push(bucket[i]); // original embedding indices
      }
      for (const [, members] of components)
        if (members.length >= 2) allGroups.push(members);

      // Report every bucket, not every 100th. Buckets are capped upstream
      // (see MAX_BUCKET_SIZE), but comparison cost is quadratic in bucket
      // size, so a batch of 100 large buckets could otherwise leave the
      // progress bar frozen for minutes with the scan looking hung.
      self.postMessage({ type: "detectionProgress", current: bi + 1, total: buckets.length });
    }

    self.postMessage({ type: "detectionResults", groups: allGroups });
  }
});

// ============================================================
// Community detection helpers (inlined — no browser/extension dependencies)
// ============================================================

/**
 * Full pairwise community detection.
 *
 * For each item, finds all other items whose cosine similarity exceeds the
 * threshold (via batched matrix multiplication). Extracts the largest
 * non-overlapping communities.
 *
 * This is the correct algorithm for the "full" scan — it catches all
 * duplicate pairs regardless of timestamp order, unlike the old adjacent-only
 * linear scan that missed non-temporally-adjacent duplicates.
 */
async function workerCommunityDetection(
  embeddings: Float32Array[],
  threshold: number,
  _timestamps?: number[],
  onProgress?: (current: number, total: number) => void,
): Promise<number[][]> {
  const n = embeddings.length;
  const dim = embeddings[0].length;
  const batchSize = 128;
  const minCommunitySize = 2;
  const extractedCommunities: number[][] = [];
  let sortMaxSize = Math.min(Math.max(2 * minCommunitySize, 50), n);

  for (let startIdx = 0; startIdx < n; startIdx += batchSize) {
    const endIdx = Math.min(startIdx + batchSize, n);
    const batchLen = endIdx - startIdx;

    // Compute cosine similarity: batch x all embeddings
    // Embeddings are L2-normalized so cos_sim = dot product
    const cosScores = matMul(embeddings, startIdx, endIdx, embeddings, 0, n, dim);

    for (let i = 0; i < batchLen; i++) {
      const row = cosScores.subarray(i * n, (i + 1) * n);

      // Quick check: are there at least minCommunitySize items above threshold?
      const topKMin = topK(row, minCommunitySize);
      if (topKMin.values[topKMin.values.length - 1] < threshold) continue;

      // Find all items above threshold
      let topKResult = topK(row, sortMaxSize);

      // Expand search window if needed
      while (
        topKResult.values[topKResult.values.length - 1] > threshold &&
        sortMaxSize < n
      ) {
        sortMaxSize = Math.min(2 * sortMaxSize, n);
        topKResult = topK(row, sortMaxSize);
      }

      const cluster: number[] = [];
      for (let j = 0; j < topKResult.values.length; j++) {
        if (topKResult.values[j] < threshold) break;
        cluster.push(topKResult.indices[j]);
      }

      if (cluster.length >= minCommunitySize) {
        extractedCommunities.push(cluster);
      }
    }

    onProgress?.(endIdx, n);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  // Sort communities by size (largest first)
  extractedCommunities.sort((a, b) => b.length - a.length);

  // Remove overlapping communities (greedy: assign each item to largest community first)
  const uniqueCommunities: number[][] = [];
  const assignedIds = new Set<number>();

  for (const community of extractedCommunities) {
    const nonOverlapping = community
      .slice()
      .sort((a, b) => a - b)
      .filter((idx) => !assignedIds.has(idx));

    if (nonOverlapping.length >= minCommunitySize) {
      uniqueCommunities.push(nonOverlapping);
      for (const idx of nonOverlapping) assignedIds.add(idx);
    }
  }

  uniqueCommunities.sort((a, b) => b.length - a.length);
  return uniqueCommunities;
}

function matMul(
  A: Float32Array[],
  startA: number,
  endA: number,
  B: Float32Array[],
  startB: number,
  endB: number,
  dim: number,
): Float32Array {
  const rowsA = endA - startA;
  const rowsB = endB - startB;
  const result = new Float32Array(rowsA * rowsB);

  const baseDim = dim % 4 === 0 && dim >= 512 ? Math.floor(dim / 4) : dim;
  const numRots = dim % 4 === 0 && dim >= 512 ? 4 : 1;

  for (let i = 0; i < rowsA; i++) {
    const aRow = A[startA + i];
    for (let j = 0; j < rowsB; j++) {
      const bRow = B[startB + j];
      let maxDot = -1;
      for (let rot = 0; rot < numRots; rot++) {
        let dot = 0;
        const bOffset = rot * baseDim;
        for (let k = 0; k < baseDim; k++) dot += aRow[k] * bRow[bOffset + k];
        if (dot > maxDot) maxDot = dot;
      }
      result[i * rowsB + j] = maxDot;
    }
  }

  return result;
}

function topK(
  arr: Float32Array,
  k: number,
): { values: number[]; indices: number[] } {
  k = Math.min(k, arr.length);

  const indexed: Array<{ val: number; idx: number }> = [];
  for (let i = 0; i < arr.length; i++) indexed.push({ val: arr[i], idx: i });
  indexed.sort((a, b) => b.val - a.val);

  const values: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < k; i++) {
    values.push(indexed[i].val);
    indices.push(indexed[i].idx);
  }

  return { values, indices };
}
