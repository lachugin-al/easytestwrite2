import { AppConfig } from "../../config/app-config";
import { Platform } from "../../core/platform";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Универсальный класс для записи видео во время выполнения мобильных тестов.
 * Android: mobile:start/stopMediaProjectionRecording
 * iOS:     startRecordingScreen / stopRecordingScreen
 */
class _VideoRecorder {
  private currentVideoPath: string | null = null;
  private isRecording = false;

  /**
   * Запускает запись видео для текущего теста.
   * Возвращает true, если запись реально началась.
   */
  async startRecording(driver: WebdriverIO.Browser, testName: string): Promise<boolean> {
    if (!AppConfig.isVideoRecordingEnabled()) {
      const platform = AppConfig.getPlatform();
      console.info(
        `Запись видео отключена для платформы ${platform}. Включите параметр ${String(
          platform
        ).toLowerCase()}.video.recording.enabled=true`
      );
      return false;
    }

    if (this.isRecording) {
      console.warn("[VideoRecorder] Запись уже выполняется — запрос игнорируем.");
      return false;
    }

    try {
      console.info(`[VideoRecorder] Запуск записи видео: ${testName}`);

      const outDir = AppConfig.getVideoRecordingOutputDir();
      await fs.mkdir(outDir, { recursive: true });

      const timestamp = new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\..+$/, "")
        .replace("T", "_");
      const safeTestName = testName.replace(/[^a-zA-Z0-9_-]/g, "_");
      this.currentVideoPath = path.resolve(outDir, `${safeTestName}_${timestamp}.mp4`);

      const platform = AppConfig.getPlatform();
      if (platform === Platform.ANDROID) {
        // Android 10+: системная запись экрана через MediaProjection
        await driver.execute("mobile: startMediaProjectionRecording", {
          videoSize: AppConfig.getVideoRecordingSize(), // "640x360"
          videoQuality: String(AppConfig.getVideoRecordingQuality()), // "70"
          timeLimit: "1800",
          forceRestart: "true",
          bitRate: String(AppConfig.getVideoRecordingBitrate()),
        });
        console.info(
          `[VideoRecorder] Android запись начата (${AppConfig.getVideoRecordingSize()}, q=${AppConfig.getVideoRecordingQuality()}, ` +
          `bitrate=${AppConfig.getVideoRecordingBitrate() / 1000} Kbps)`
        );
      } else if (platform === Platform.IOS) {
        // Appium: startRecordingScreen -> base64 при stop
        // опции можно добавить при необходимости
        // @ts-ignore — команды Appium не всегда декларативно типизированы в WDIO
        await driver.startRecordingScreen?.() ??
        (await driver.execute("mobile: startRecordingScreen")); // fallback
        console.info("[VideoRecorder] iOS запись начата (startRecordingScreen)");
      } else {
        console.error(`[VideoRecorder] Платформа не поддерживается: ${platform}`);
        return false;
      }

      this.isRecording = true;
      return true;
    } catch (e: any) {
      console.error(`[VideoRecorder] Не удалось начать запись видео: ${e?.message || e}`);
      return false;
    }
  }

  /**
   * Останавливает запись, сохраняет MP4 и (опционально) прикрепляет к Allure.
   */
  async stopRecording(
    driver: WebdriverIO.Browser,
    testName: string,
    attachToAllure: boolean = true
  ): Promise<boolean> {
    if (!this.isRecording) {
      console.warn("[VideoRecorder] Запись не активна.");
      return false;
    }

    try {
      console.info(`[VideoRecorder] Остановка записи видео: ${testName}`);

      let base64Video = "";
      const platform = AppConfig.getPlatform();

      if (platform === Platform.ANDROID) {
        base64Video = (await driver.execute("mobile: stopMediaProjectionRecording")) as string;
      } else if (platform === Platform.IOS) {
        // @ts-ignore
        base64Video =
          (await driver.stopRecordingScreen?.()) ??
          ((await driver.execute("mobile: stopRecordingScreen")) as string);
      } else {
        console.error(`[VideoRecorder] Платформа не поддерживается: ${platform}`);
        this.isRecording = false;
        return false;
      }

      this.isRecording = false;

      const buffer = Buffer.from(base64Video, "base64");
      const videoPath = this.currentVideoPath ?? path.resolve(AppConfig.getVideoRecordingOutputDir(), "unknown_test.mp4");
      await fs.writeFile(videoPath, buffer);
      console.info(`[VideoRecorder] Видео сохранено: ${videoPath}`);

      if (attachToAllure) {
        // Пытаемся прикрепить через глобальный allure (если адаптер интегрирован)
        const g = globalThis as any;
        if (g.allure?.attachment) {
          g.allure.attachment("Запись теста", buffer, "video/mp4");
          console.info("[VideoRecorder] Видео прикреплено к отчёту Allure");
        } else {
          // Нет интеграции — просто логируем
          console.info("[VideoRecorder] Allure адаптер не обнаружен, пропускаем attachment");
        }
      }

      return true;
    } catch (e: any) {
      console.error(`[VideoRecorder] Не удалось остановить запись: ${e?.message || e}`);
      this.isRecording = false;
      return false;
    }
  }

  /** Включена ли запись в конфиге. */
  isEnabled(): boolean {
    return AppConfig.isVideoRecordingEnabled();
  }

  /** Отличается ли размер от базового "1280x720". */
  isVideoSizeConfigured(): boolean {
    return AppConfig.getVideoRecordingSize() !== "1280x720";
  }

  /** Отличается ли качество от базового 70. */
  isVideoQualityConfigured(): boolean {
    return AppConfig.getVideoRecordingQuality() !== 70;
  }
}

export const VideoRecorder = new _VideoRecorder();