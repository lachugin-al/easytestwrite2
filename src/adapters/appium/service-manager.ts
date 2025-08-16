// src/utils/AppiumServerManager.ts
import { spawn, ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import * as https from "node:https";
import { AppConfig } from "../../config/app-config";

function wait(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function pingStatus(url: URL, timeoutMs = 1000): Promise<boolean> {
  const isHttps = url.protocol === "https:";
  const mod = isHttps ? https : http;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const opts: http.RequestOptions = {
    method: "GET",
    hostname: url.hostname,
    port: url.port ? Number(url.port) : isHttps ? 443 : 80,
    path: (url.pathname && url.pathname !== "/" ? url.pathname.replace(/\/$/, "") : "") + "/status",
    signal: ctrl.signal as any,
  };
  return new Promise<boolean>((resolve) => {
    const req = mod.request(opts, (res) => {
      res.resume();
      clearTimeout(t);
      resolve(res.statusCode === 200);
    });
    req.on("error", () => {
      clearTimeout(t);
      resolve(false);
    });
    req.end();
  });
}

function resolveAppiumBinary(): string {
  const binName = process.platform === "win32" ? "appium.cmd" : "appium";
  const localBin = path.resolve(process.cwd(), "node_modules", ".bin", binName);
  if (fs.existsSync(localBin)) return localBin;
  return binName; // из PATH
}

export class AppiumServerManager {
  private static child: ChildProcess | null = null;
  private static startedByUs = false;

  static async startIfNeeded(): Promise<void> {
    // Можно выключить автозапуск через env
    if (process.env.APPIUM_AUTOSTART === "0") {
      console.info("[AppiumServer] Автозапуск отключён (APPIUM_AUTOSTART=0)");
      return;
    }

    const url = AppConfig.getAppiumUrl();

    // Уже поднят?
    if (await pingStatus(url, 800)) {
      console.info("[AppiumServer] Уже запущен, пропускаем старт");
      this.startedByUs = false;
      return;
    }

    const bin = resolveAppiumBinary();
    const args: string[] = [];

    // адрес/порт
    args.push("-a", url.hostname || "0.0.0.0");
    args.push("-p", (url.port ? Number(url.port) : (url.protocol === "https:" ? 443 : 4723)).toString());

    // base-path если задан (например, http://localhost:4723/wd/hub)
    const base = url.pathname && url.pathname !== "/" ? url.pathname : "";
    if (base) args.push("--base-path", base);

    console.info(`[AppiumServer] Старт: ${bin} ${args.join(" ")}`);
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    this.child = child;
    this.startedByUs = true;

    child.stdout?.on("data", (d) => process.stdout.write(`[Appium] ${d}`));
    child.stderr?.on("data", (d) => process.stderr.write(`[Appium] ${d}`));

    // ждём готовности
    const timeoutMs = Number(process.env.APPIUM_START_TIMEOUT ?? 30000);
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (child.exitCode !== null) {
        throw new Error(`[AppiumServer] Процесс завершился с кодом ${child.exitCode} при старте`);
      }
      if (await pingStatus(url, 1000)) {
        console.info("[AppiumServer] Готов");
        return;
      }
      await wait(500);
    }
    throw new Error("[AppiumServer] Не дождались готовности за " + timeoutMs + " мс");
  }

  static async stopIfStarted(): Promise<void> {
    if (!this.startedByUs || !this.child) return;
    if (process.env.APPIUM_AUTOSHUTDOWN === "0") {
      console.info("[AppiumServer] Автоостановка отключена (APPIUM_AUTOSHUTDOWN=0)");
      return;
    }

    const child = this.child;
    this.child = null;
    this.startedByUs = false;

    console.info("[AppiumServer] Остановка…");
    try {
      const killGraceMs = Number(process.env.APPIUM_KILL_GRACE ?? 5000);
      child.kill("SIGTERM");
      const t0 = Date.now();
      while (child.exitCode === null && Date.now() - t0 < killGraceMs) {
        await wait(200);
      }
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    } catch {
    }
  }
}