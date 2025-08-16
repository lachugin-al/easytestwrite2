import { Platform } from "../core/platform";
import * as fs from "node:fs";
import * as path from "node:path";

type Props = Record<string, string>;

/**
 * Простой .properties парсер:
 * - поддержка комментариев (# или ;) и пустых строк
 * - пары key=value / key: value / key value
 * - значения и ключи триммируются
 */
function parseProperties(text: string): Props {
  const out: Props = {};
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;

    // разделители: =, :, пробел(ы)
    const m = line.match(/^([^=:\s]+)\s*(?:=|:|\s)\s*(.*)$/);
    if (m) {
      const key = m[1].trim();
      const val = m[2].trim();
      out[key] = val;
    }
  }
  return out;
}

/**
 * Поиск tests.properties в ожидаемых местах.
 * Приоритет:
 * 1) process.env.CONFIG_PATH (если задан)
 * 2) ./tests/config/tests.properties
 */
function resolveConfigPath(): string {
  const cwd = process.cwd();

  // Переменные окружения
  const envPath = process.env.CONFIG_PATH?.trim();
  const profile =
    process.env.TEST_PROFILE?.trim() || (process.env.CI ? "ci" : "");
  const runner = process.env.TEST_RUNNER?.trim(); // appium|playwright и т.п.

  // Хелпер проверки
  const isFile = (p: string | undefined) => {
    if (!p) return false;
    try {
      return fs.existsSync(p) && fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };

  // Кандидаты в порядке убывания специфичности
  const candidates = [
    // 1) Абсолютный приоритет: явный путь из ENV
    envPath,

    // 2) tests/config — «островок» конфигов для тестов
    path.resolve(cwd, "tests", "config", "tests.local.properties"),
    profile && path.resolve(cwd, "tests", "config", `tests.${profile}.properties`),
    runner && path.resolve(cwd, "tests", "config", `runner.${runner}.properties`),
    path.resolve(cwd, "tests", "config", "tests.properties"),

    // 3) tests/ (если кто-то хранит без подкаталога config)
    path.resolve(cwd, "tests", "tests.local.properties"),
    profile && path.resolve(cwd, "tests", `tests.${profile}.properties`),
    path.resolve(cwd, "tests", "tests.properties"),

    // 4) Корень репо — легаси-варианты
    path.resolve(cwd, "tests.local.properties"),
    profile && path.resolve(cwd, `tests.${profile}.properties`),
    path.resolve(cwd, "tests.properties"),
    path.resolve(cwd, "config.properties"), // совсем легаси

    // 5) Kotlin/Java-совместимость
    path.resolve(cwd, "test", "resources", "tests.properties"),
    path.resolve(cwd, "src", "test", "resources", "tests.properties"),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (isFile(p)) return p;
  }

  // Полезная ошибка с перечислением, где искали
  const tried = candidates.map((p) => ` - ${p}`).join("\n");
  throw new Error(
    `Не удалось найти файл конфигурации тестов.\nИскал в:\n${tried}\n` +
    `Подсказки:\n` +
    ` • Укажи явный путь через переменную CONFIG_PATH\n` +
    ` • Либо создай tests/config/tests.properties (или tests.<profile>.properties)\n`
  );
}

/** Достаём строку из env (включая ВАРИАНТЫ имени) */
function envProp(name: string): string | undefined {
  // точное имя
  if (process.env[name] !== undefined) return process.env[name];

  // canonical UPPER_SNAKE
  const upperSnake = name.replace(/[.\s-]+/g, "_").toUpperCase();
  if (process.env[upperSnake] !== undefined) return process.env[upperSnake];

  // lower snake
  const lowerSnake = name.replace(/[.\s-]+/g, "_").toLowerCase();
  if (process.env[lowerSnake] !== undefined) return process.env[lowerSnake];

  return undefined;
}

/** Универсальный парсер boolean: true/1/yes/on → true; false/0/no/off → false */
function parseBool(v: unknown, def: boolean): boolean {
  if (v === undefined || v === null) return def;
  const s = String(v).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(s)) return true;
  if (["false", "0", "no", "n", "off"].includes(s)) return false;
  return def;
}

class _AppConfig {
  private readonly properties: Props;
  private readonly appiumUrl: URL;

  // Платформа и все остальные значения кешируем как в Kotlin object
  private readonly platform: Platform;

  private readonly androidVersion: string;
  private readonly iosVersion: string;

  private readonly androidDeviceName: string;
  private readonly iosDeviceName: string;

  private readonly androidAppName: string;
  private readonly iosAppName: string;

  private readonly appActivity: string;
  private readonly appPackage: string;
  private readonly bundleId: string;

  private readonly iosAutoAcceptAlerts: boolean;
  private readonly iosAutoDismissAlerts: boolean;

  private readonly androidHeadlessMode: boolean;

  private readonly androidVideoRecordingEnabled: boolean;
  private readonly iosVideoRecordingEnabled: boolean;
  private readonly videoRecordingSize: string;
  private readonly videoRecordingQuality: number;
  private readonly videoRecordingBitrate: number;
  private readonly videoRecordingOutputDir: string;

  private readonly emulatorAutoStart: boolean;
  private readonly emulatorAutoShutdown: boolean;

  // ---- Новые опции управления Appium-сервером ----
  private readonly appiumAutoStart: boolean;
  private readonly appiumAutoShutdown: boolean;
  private readonly appiumStartTimeoutMs: number;
  private readonly appiumKillGraceMs: number;

  constructor() {
    // грузим properties из файла (как Kotlin — если не вышло, бросаем ошибку)
    const cfgPath = resolveConfigPath();
    try {
      const text = fs.readFileSync(cfgPath, "utf8");
      this.properties = parseProperties(text);
      console.info(`[AppConfig] Конфигурация загружена из ${cfgPath}`);
    } catch (e: any) {
      console.error(`[AppConfig] Ошибка загрузки test.properties: ${e?.message}`);
      throw e;
    }

    // helpers
    const prop = (name: string, def: string): string =>
      envProp(name) ?? this.properties[name] ?? def;

    const propBoolean = (name: string, def: boolean): boolean =>
      parseBool(envProp(name) ?? this.properties[name], def);

    const propInt = (name: string, def: number): number => {
      const raw = envProp(name) ?? this.properties[name];
      if (raw === undefined) return def;
      const num = parseInt(String(raw), 10);
      return Number.isFinite(num) ? num : def;
    };

    // URL Appium
    this.appiumUrl = new URL(prop("appium.url", "http://localhost:4723/"));

    // Платформа
    const pf = (prop("platform", "ANDROID") || "ANDROID").toUpperCase();
    this.platform = (Platform as any)[pf] ?? Platform.ANDROID;

    // Версии ОС
    this.androidVersion = prop("android.version", "16");
    this.iosVersion = prop("ios.version", "18.4");

    // Имена устройств
    this.androidDeviceName = prop("android.device.name", "WBA16");
    this.iosDeviceName = prop("ios.device.name", "iPhone 16 Plus");

    // Пути к приложениям
    this.androidAppName = prop("android.app.name", "android.apk");
    this.iosAppName = prop("ios.app.name", "ios.app");

    // Android пакет/активити и iOS bundleId
    this.appActivity = prop("app.activity", "MainActivity");
    this.appPackage = prop("app.package", "com.dev");
    this.bundleId = prop("bundle.id", "MOBILEAPP.DEV");

    // iOS alerts
    this.iosAutoAcceptAlerts = propBoolean("ios.auto_accept_alerts", false);
    this.iosAutoDismissAlerts = propBoolean("ios.auto_dismiss_alerts", false);

    // Android headless
    this.androidHeadlessMode = propBoolean("android.headless.mode", true);

    // Видео
    this.androidVideoRecordingEnabled = propBoolean("android.video.recording.enabled", false);
    this.iosVideoRecordingEnabled = propBoolean("ios.video.recording.enabled", false);
    this.videoRecordingSize = prop("video.recording.size", "640x360");
    this.videoRecordingQuality = parseInt(prop("video.recording.quality", "70"), 10);
    this.videoRecordingBitrate = parseInt(prop("video.recording.bitrate", "100000"), 10);
    this.videoRecordingOutputDir = prop("video.recording.output.dir", "build/videos");

    // Эмулятор
    this.emulatorAutoStart = propBoolean("emulator.auto.start", true);
    this.emulatorAutoShutdown = propBoolean("emulator.auto.shutdown", true);

    // ---- Appium-сервер ----
    // поддерживаются и ключи в файле (appium.autostart=...) и ENV (APPIUM_AUTOSTART=0/1)
    this.appiumAutoStart = propBoolean("appium.autostart", true);
    this.appiumAutoShutdown = propBoolean("appium.autoshutdown", true);
    this.appiumStartTimeoutMs = propInt("appium.start.timeout", 45_000);
    this.appiumKillGraceMs = propInt("appium.kill.grace", 8_000);
  }

  // -------- API (имена и сигнатуры как в Kotlin) --------

  isAndroid(): boolean {
    return this.platform === Platform.ANDROID;
  }

  isiOS(): boolean {
    return this.platform === Platform.IOS;
  }

  getPlatform(): Platform {
    return this.platform;
  }

  getAppiumUrl(): URL {
    return this.appiumUrl;
  }

  // ---- Новые геттеры по Appium-серверу ----
  isAppiumAutoStartEnabled(): boolean {
    return this.appiumAutoStart;
  }

  isAppiumAutoShutdownEnabled(): boolean {
    return this.appiumAutoShutdown;
  }

  /** Таймаут ожидания старта внешнего/авто-запускаемого Appium (мс). */
  getAppiumStartTimeoutMs(): number {
    return this.appiumStartTimeoutMs;
  }

  /** Время «грейс» перед форс-киллом Appium-процесса (мс). */
  getAppiumKillGraceMs(): number {
    return this.appiumKillGraceMs;
  }

  getAndroidVersion(): string {
    return this.androidVersion;
  }

  getIosVersion(): string {
    return this.iosVersion;
  }

  getAndroidDeviceName(): string {
    return this.androidDeviceName;
  }

  getIosDeviceName(): string {
    return this.iosDeviceName;
  }

  getAppActivity(): string {
    return this.appActivity;
  }

  getAppPackage(): string {
    return this.appPackage;
  }

  getBundleId(): string {
    return this.bundleId;
  }

  // Удобные алиасы под уже написанный MobileActions
  getIosBundleId(): string {
    return this.getBundleId();
  }

  getAppBundleId(): string {
    return this.getBundleId();
  }

  getIosAutoAcceptAlerts(): boolean {
    return this.iosAutoAcceptAlerts;
  }

  getIosAutoDismissAlerts(): boolean {
    return this.iosAutoDismissAlerts;
  }

  getAppName(): string {
    switch (this.platform) {
      case Platform.ANDROID:
        return this.androidAppName;
      case Platform.IOS:
        return this.iosAppName;
      default:
        return "";
    }
  }

  isAndroidHeadlessMode(): boolean {
    return this.androidHeadlessMode;
  }

  isVideoRecordingEnabled(): boolean {
    switch (this.platform) {
      case Platform.ANDROID:
        return this.androidVideoRecordingEnabled;
      case Platform.IOS:
        return this.iosVideoRecordingEnabled;
      default:
        return false;
    }
  }

  getVideoRecordingSize(): string {
    return this.videoRecordingSize;
  }

  getVideoRecordingQuality(): number {
    return this.videoRecordingQuality;
  }

  getVideoRecordingOutputDir(): string {
    return this.videoRecordingOutputDir;
  }

  getVideoRecordingBitrate(): number {
    return this.videoRecordingBitrate;
  }

  isEmulatorAutoStartEnabled(): boolean {
    return this.emulatorAutoStart;
  }

  isEmulatorAutoShutdownEnabled(): boolean {
    return this.emulatorAutoShutdown;
  }
}

// Синглтон, как Kotlin object
export const AppConfig = new _AppConfig();