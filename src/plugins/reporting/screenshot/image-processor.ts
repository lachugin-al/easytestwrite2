/**
 * Масштабирует изображение и сжимает PNG.
 * Использует sharp; quality (0..100) маппится на zlib compressionLevel (0..9).
 */
import sharp from "sharp";

export class ImageProcessor {
  /**
   * @param bytes   исходное изображение (любой формат), на выходе — PNG
   * @param scale   коэффициент масштабирования (>0), например 0.5
   * @param quality 0..100 — выше quality → ниже compressionLevel
   */
  static async processImage(
    bytes: Buffer,
    scale: number,
    quality: number
  ): Promise<Buffer> {
    try {
      // failOn: "warning" — корректный тип; rotate() — авто-ориентация по EXIF
      const img = sharp(bytes, { failOn: "warning" }).rotate();

      const meta = await img.metadata();
      const srcW = meta.width ?? 0;
      const srcH = meta.height ?? 0;
      if (!srcW || !srcH) return bytes;

      // вменяемые значения
      const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
      const width = Math.max(1, Math.round(srcW * s));
      const height = Math.max(1, Math.round(srcH * s));

      // 0..100 -> 0..9 (инверсия)
      const q = Math.max(0, Math.min(100, Math.trunc(quality)));
      const compressionLevel = Math.max(0, Math.min(9, Math.round((9 * (100 - q)) / 100)));

      return await img
        .resize(width, height, { kernel: sharp.kernel.lanczos3 })
        .png({
          compressionLevel, // 0..9
          effort: 6,        // 0..9 — баланс скорость/размер
        })
        .toBuffer();
    } catch {
      // поведение как в Kotlin-версии — отдать оригинал при ошибке
      return bytes;
    }
  }
}