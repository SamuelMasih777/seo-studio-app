import sharp from "sharp";

const MAX_INPUT_BYTES = 20 * 1024 * 1024;

export type CompressFormatOption = "webp" | "original";
export type CompressQualityOption = "lossy" | "lossless";

export type CompressedImage = {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  inputBytes: number;
  outputBytes: number;
};

/**
 * Re-encode product image bytes for smaller files. GIF/SVG are rejected (unsafe or unsupported for replace flow).
 */
export async function compressProductImage(
  input: Buffer,
  format: CompressFormatOption,
  quality: CompressQualityOption,
): Promise<CompressedImage | { error: string }> {
  if (input.byteLength > MAX_INPUT_BYTES) {
    return { error: `Image exceeds ${MAX_INPUT_BYTES / 1024 / 1024} MB limit.` };
  }

  let pipeline = sharp(input, { failOn: "truncated" });
  const meta = await pipeline.metadata();

  if (meta.format === "gif") {
    return {
      error:
        "GIF compression/replace is not supported here (animated GIFs). Convert manually in Shopify admin if needed.",
    };
  }
  if (meta.format === "svg") {
    return { error: "SVG images are not supported for raster compression." };
  }

  const inputBytes = input.byteLength;

  try {
    if (format === "webp") {
      const buf =
        quality === "lossless"
          ? await pipeline.webp({ lossless: true, effort: 6 }).toBuffer()
          : await pipeline.webp({ quality: 80, effort: 5, smartSubsample: true }).toBuffer();
      return {
        buffer: buf,
        mimeType: "image/webp",
        extension: "webp",
        inputBytes,
        outputBytes: buf.byteLength,
      };
    }

    // Re-compress keeping raster family (JPEG / PNG / WebP input → same family when sensible)
    if (meta.format === "png" || meta.hasAlpha) {
      const buf = await pipeline
        .png({
          compressionLevel: quality === "lossless" ? 9 : 7,
          adaptiveFiltering: true,
          effort: quality === "lossless" ? 10 : 7,
        })
        .toBuffer();
      return {
        buffer: buf,
        mimeType: "image/png",
        extension: "png",
        inputBytes,
        outputBytes: buf.byteLength,
      };
    }

    const buf = await pipeline
      .jpeg({
        quality: quality === "lossless" ? 95 : 82,
        mozjpeg: true,
        chromaSubsampling: quality === "lossless" ? "4:4:4" : "4:2:0",
      })
      .toBuffer();
    return {
      buffer: buf,
      mimeType: "image/jpeg",
      extension: "jpg",
      inputBytes,
      outputBytes: buf.byteLength,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `Compression failed: ${msg}` };
  }
}
