// Where the model comes from. NOT Hugging Face at runtime: the ONNX vision encoder is packed into
// a release asset of this repo by scripts/build-model-asset.mjs, downloaded once when icon
// recognition is first turned on, checked against the SHA-256 below and unpacked into the app's
// cache folder. Every run after that reads it from there, so the app works offline.
//
// To move to another build of the asset: run the script, upload the zips to a new release tag, and
// put the tag in MODEL_RELEASE and the script's output in MODEL_FILES.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** The one place the download URL is built. */
export const MODEL_RELEASE = "model-siglip2-base-patch16-224-v1";
export const MODEL_ASSET_BASE = `https://github.com/mscrnt/diablo-companion/releases/download/${MODEL_RELEASE}`;

/**
 * The zips, by the dtype of the weights inside, with the size and SHA-256 of the exact bytes the
 * app must get. fp16 is what the GPU runs: half precision is the GPU's native dtype, costs nothing
 * in accuracy, and the WebGPU backend has no int8 matmul (an int8 model would quietly run its
 * matmuls on the CPU, which is the opposite of what this feature is for). q8 is half the download
 * and is what the CPU fallback uses when there's no WebGPU.
 */
export const MODEL_FILES = {
  fp16: { zip: "siglip2-base-patch16-224-onnx-fp16.zip", bytes: 186045147, sha256: "04857c540f4789e1482bebd573eec05d386d21d015042b474623d7160ffdfae4" },
  q8: { zip: "siglip2-base-patch16-224-onnx-q8.zip", bytes: 94558964, sha256: "a7e2b572cb4b1e851d41c7447e8e447dfb7de892e9fe99ea78c3ceea7e647042" },
} as const;

export type Dtype = keyof typeof MODEL_FILES;

/** Where a dtype's files live inside the app cache folder. */
export const modelDir = (dtype: Dtype) => `model/${dtype}`;
export const modelFile = (dtype: Dtype) => `${modelDir(dtype)}/vision_model.onnx`;

/** Is the model already unpacked and the right size? */
export async function modelInstalled(dtype: Dtype): Promise<boolean> {
  const st = await invoke<{ bytes: number } | null>("icon_cache_stat", { path: modelFile(dtype) });
  return !!st && st.bytes > 1_000_000;
}

/**
 * Download the asset, check its SHA-256 and unpack it. `onProgress` gets 0..1 while it downloads.
 * Rust does the work (the zip is far too big to pass through the bridge) and reports progress on
 * an event.
 */
export async function installModel(dtype: Dtype, onProgress?: (fraction: number) => void): Promise<void> {
  const f = MODEL_FILES[dtype];
  const stop = onProgress
    ? await listen<{ done: number; total: number }>("icons://model-progress", (e) => onProgress(e.payload.total ? e.payload.done / e.payload.total : 0))
    : null;
  try {
    await invoke("icon_model_install", { url: `${MODEL_ASSET_BASE}/${f.zip}`, sha256: f.sha256, bytes: f.bytes, dest: modelDir(dtype) });
  } finally {
    stop?.();
  }
}

/** The model's bytes, for the worker's ONNX session (raw, not base64: it's ~186 MB). */
export async function modelBytes(dtype: Dtype): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("icon_cache_read", { path: modelFile(dtype) });
}
