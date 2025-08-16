import { AppConfig } from "../../config/app-config";
import { Platform } from "../../core/platform";
import { spawn } from "node:child_process";
import * as os from "node:os";
import * as readline from "node:readline";

type ExecResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean };

// ===== helpers =====
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isWindows = os.platform() === "win32";

/** spawn с ожиданием, сбором stdout/stderr и таймаутом */
function execWithTimeout(cmd: string, args: string[], timeoutSec: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let finished = false;

    const to1 = setTimeout(() => {
      if (!finished) {
        finished = true;
        child.kill("SIGKILL");
        resolve({ code: null, stdout, stderr, timedOut: true });
      }
    }, timeoutSec * 1000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));

    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(to1);
      resolve({ code, stdout, stderr, timedOut: false });
    });
    child.on("error", (e) => {
      if (finished) return;
      finished = true;
      clearTimeout(to1);
      resolve({ code: null, stdout, stderr: String(e), timedOut: false });
    });
  });
}

/** бесконечное чтение stdout процесса (для эмулятора), чтобы не забился буфер */
function pipeProcessStdout(proc: ReturnType<typeof spawn>, _prefix: string) {
  const rl = readline.createInterface({ input: proc.stdout! });
  rl.on("line", (_line) => {
    // можно опустить до debug-логов
    // console.debug(`[${prefix}] ${line}`);
  });
  proc.stderr?.on("data", (_d) => {
    // console.debug(`[${prefix}-ERR] ${String(d)}`);
  });
}

// ==========================================

class EmulatorManagerClass {
  // таймауты (сек)
  private readonly EMULATOR_BOOT_TIMEOUT_SECONDS = 120;
  private readonly EMULATOR_STARTUP_TIMEOUT_SECONDS = 60;
  private readonly COMMAND_TIMEOUT_SECONDS = 30;

  // простой mutex
  private locked = false;

  private tryLock(): boolean {
    if (this.locked) return false;
    this.locked = true;
    return true;
  }

  private unlock() {
    this.locked = false;
  }

  async startEmulator(): Promise<boolean> {
    try {
      if (!this.tryLock()) {
        console.warn("Другой поток уже выполняет операции с эмулятором, ожидаем…");
        await sleep(1000);
        if (!this.tryLock()) {
          console.error("Не удалось получить блокировку для запуска эмулятора");
          return false;
        }
      }

      const platform = AppConfig.getPlatform();
      switch (platform) {
        case Platform.ANDROID:
          return await this.startAndroidEmulator();
        case Platform.IOS:
          return await this.startIosSimulator();
        default:
          console.info(`Запуск эмулятора не требуется для платформы ${platform}`);
          return true;
      }
    } catch (e: any) {
      console.error(`Непредвиденная ошибка при запуске эмулятора: ${e?.message || e}`);
      return false;
    } finally {
      this.unlock();
    }
  }

  async stopEmulator(): Promise<boolean> {
    try {
      if (!this.tryLock()) {
        console.warn("Другой поток уже выполняет операции с эмулятором, ожидаем…");
        await sleep(1000);
        if (!this.tryLock()) {
          console.error("Не удалось получить блокировку для остановки эмулятора");
          return false;
        }
      }

      const platform = AppConfig.getPlatform();
      switch (platform) {
        case Platform.ANDROID:
          return await this.stopAndroidEmulator();
        case Platform.IOS:
          return await this.stopIosSimulator();
        default:
          console.info(`Остановка эмулятора не требуется для платформы ${platform}`);
          return true;
      }
    } catch (e: any) {
      console.error(`Непредвиденная ошибка при остановке эмулятора: ${e?.message || e}`);
      return false;
    } finally {
      this.unlock();
    }
  }

  // ---------- общие утилиты ----------

  private async checkRequiredTools(commands: string[]): Promise<boolean> {
    for (const command of commands) {
      try {
        if (command === "simctl") {
          // На macOS simctl часто ищется через xcrun
          const r = await execWithTimeout("xcrun", ["-f", "simctl"], this.COMMAND_TIMEOUT_SECONDS);
          if (r.code !== 0) {
            console.error("Утилита 'simctl' не найдена (xcrun -f simctl)");
            return false;
          }
          continue;
        }
        const checker = isWindows ? "where" : "which";
        const r = await execWithTimeout(checker, [command], this.COMMAND_TIMEOUT_SECONDS);
        if (r.code !== 0) {
          console.error(`Утилита '${command}' не найдена в системе`);
          return false;
        }
      } catch (e: any) {
        console.error(`Ошибка при проверке утилиты '${command}': ${e?.message || e}`);
        return false;
      }
    }
    return true;
  }

  // ---------- Android ----------

  private async waitForEmulatorBoot(deviceId: string): Promise<boolean> {
    if (!deviceId) {
      console.error("Невозможно дождаться загрузки эмулятора: пустой ID устройства");
      return false;
    }
    const maxAttempts = Math.floor(this.EMULATOR_BOOT_TIMEOUT_SECONDS / 2);

    for (let i = 1; i <= maxAttempts; i++) {
      const r = await execWithTimeout(
        "adb",
        ["-s", deviceId, "shell", "getprop", "sys.boot_completed"],
        this.COMMAND_TIMEOUT_SECONDS
      );
      if (r.timedOut) {
        console.warn(`Таймаут при проверке загрузки эмулятора ${deviceId}, попытка ${i}/${maxAttempts}`);
      } else {
        const bootCompleted = r.stdout.trim();
        if (bootCompleted === "1") {
          if (await this.isEmulatorResponsive(deviceId)) {
            console.info(`Эмулятор ${deviceId} полностью загружен и готов к работе.`);
            return true;
          } else {
            console.warn(`Эмулятор ${deviceId} загружен, но не отвечает на команды`);
          }
        } else {
          console.info(
            `Эмулятор ${deviceId} ещё не готов (sys.boot_completed=${bootCompleted}), попытка ${i}/${maxAttempts}`
          );
        }
      }
      await sleep(2000);
    }
    console.error(`Эмулятор ${deviceId} так и не загрузился за ${this.EMULATOR_BOOT_TIMEOUT_SECONDS} сек.`);
    return false;
  }

  private async isEmulatorResponsive(deviceId: string): Promise<boolean> {
    const r = await execWithTimeout(
      "adb",
      ["-s", deviceId, "shell", "pm", "list", "packages"],
      this.COMMAND_TIMEOUT_SECONDS
    );
    if (r.timedOut) {
      console.warn(`Таймаут при проверке работоспособности эмулятора ${deviceId}`);
      return false;
    }
    return r.code === 0 && r.stdout.includes("package:");
  }

  private async checkEmulatorExists(deviceName: string): Promise<boolean> {
    const r = await execWithTimeout("emulator", ["-list-avds"], this.COMMAND_TIMEOUT_SECONDS);
    if (r.timedOut) {
      console.warn("Таймаут при получении списка эмуляторов");
      return false;
    }
    return r.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .some((n) => n === deviceName);
  }

  private async getEmulatorId(): Promise<string | null> {
    const r = await execWithTimeout("adb", ["devices"], this.COMMAND_TIMEOUT_SECONDS);
    if (r.timedOut) {
      console.warn("Таймаут при получении списка устройств");
      return null;
    }
    const line = r.stdout
      .split(/\r?\n/)
      .find((l) => l.includes("emulator-") && /\sdevice\b/.test(l));
    return line ? line.split(/\s+/)[0] : null;
  }

  private async forceStopAndroidEmulator(emulatorId: string): Promise<void> {
    // adb emu kill
    await execWithTimeout("adb", ["-s", emulatorId, "emu", "kill"], this.COMMAND_TIMEOUT_SECONDS);
    await sleep(2000);

    if ((await this.getEmulatorId()) !== null) {
      console.warn("Эмулятор не остановился через 'adb emu kill', пробуем принудительно");
      if (isWindows) {
        await execWithTimeout("taskkill", ["/F", "/IM", "qemu-system-x86_64.exe"], this.COMMAND_TIMEOUT_SECONDS);
      } else {
        await execWithTimeout("killall", ["-9", "qemu-system-x86_64"], this.COMMAND_TIMEOUT_SECONDS);
      }
    }
  }

  private async startAndroidEmulator(): Promise<boolean> {
    // утилиты
    if (!(await this.checkRequiredTools(["adb", "emulator"]))) {
      console.error("Отсутствуют необходимые утилиты для запуска Android эмулятора");
      return false;
    }

    const deviceName = AppConfig.getAndroidDeviceName();
    if (!deviceName) {
      console.error("Не указано имя устройства Android для запуска");
      return false;
    }

    console.info(`Запуск Android эмулятора: ${deviceName}`);

    if (!(await this.checkEmulatorExists(deviceName))) {
      console.error(`Эмулятор с именем '${deviceName}' не найден в системе`);
      return false;
    }

    const existing = await this.getEmulatorId();
    if (existing) {
      console.info(`Эмулятор уже запущен: ${existing}`);
      if (await this.isEmulatorResponsive(existing)) {
        console.info(`Эмулятор ${existing} работоспособен`);
        return true;
      } else {
        console.warn(`Эмулятор ${existing} не отвечает — перезапускаем`);
        await this.forceStopAndroidEmulator(existing);
      }
    }

    const args = [
      "-avd",
      deviceName,
      "-no-snapshot-load",
      "-no-boot-anim",
      "-gpu",
      "swiftshader_indirect",
      "-no-audio",
    ];
    if (AppConfig.isAndroidHeadlessMode()) {
      args.push("-no-window");
    }

    console.info(`Запуск команды: emulator ${args.join(" ")}`);
    const proc = spawn("emulator", args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    pipeProcessStdout(proc, "emulator");

    // ждём появления в adb devices
    const maxAttempts = Math.floor(this.EMULATOR_STARTUP_TIMEOUT_SECONDS / 2);
    let newId: string | null = null;

    for (let i = 1; i <= maxAttempts; i++) {
      // если процесс уже упал с ошибкой
      // @ts-ignore
      if (proc.exitCode !== null && proc.exitCode !== 0) {
        console.error(`Процесс эмулятора завершился с кодом ${proc.exitCode}`);
        return false;
      }

      newId = await this.getEmulatorId();
      if (newId) {
        console.info(`Эмулятор запущен с ID: ${newId} (попытка ${i})`);
        break;
      } else {
        console.info(`Ожидание запуска эмулятора… попытка ${i}/${maxAttempts}`);
        await sleep(2000);
      }
    }

    if (!newId) {
      console.error(
        `Не удалось запустить эмулятор Android за ${this.EMULATOR_STARTUP_TIMEOUT_SECONDS} сек. Прерываем.`
      );
      try {
        // если ещё жив — убьём
        proc.kill("SIGKILL");
      } catch {
      }
      return false;
    }

    // дождаться полной загрузки
    const ok = await this.waitForEmulatorBoot(newId);
    if (!ok) {
      console.warn("Эмулятор не загрузился полностью — останавливаем");
      await this.forceStopAndroidEmulator(newId);
      return false;
    }

    return true;
  }

  private async stopAndroidEmulator(): Promise<boolean> {
    if (!(await this.checkRequiredTools(["adb"]))) {
      console.error("Отсутствуют необходимые утилиты для остановки Android эмулятора");
      return false;
    }

    const emulatorId = await this.getEmulatorId();
    if (!emulatorId) {
      console.info("Эмулятор Android не запущен — ничего останавливать");
      return true;
    }

    console.info(`Остановка эмулятора Android: ${emulatorId}`);
    await execWithTimeout("adb", ["-s", emulatorId, "emu", "kill"], this.COMMAND_TIMEOUT_SECONDS);
    await sleep(2000);

    if ((await this.getEmulatorId()) !== null) {
      console.warn("Эмулятор не остановился стандартным способом — применяем принудительную остановку");
      await this.forceStopAndroidEmulator(emulatorId);
      await sleep(2000);
      if ((await this.getEmulatorId()) !== null) {
        console.error("Не удалось остановить эмулятор Android даже принудительно");
        return false;
      }
    }

    console.info("Эмулятор Android успешно остановлен");
    return true;
  }

  // ---------- iOS ----------

  private isMac(): boolean {
    return os.platform() === "darwin";
  }

  private async getSimulatorsList(): Promise<string> {
    const r = await execWithTimeout("xcrun", ["simctl", "list", "--json"], this.COMMAND_TIMEOUT_SECONDS);
    if (r.timedOut) {
      console.warn("Таймаут при получении списка iOS симуляторов");
      return "";
    }
    return r.stdout || "";
  }

  private async getSimulatorId(simulatorName: string): Promise<string | null> {
    const json = await this.getSimulatorsList();
    if (!json) return null;
    try {
      const parsed = JSON.parse(json) as {
        devices: Record<string, Array<{ udid: string; name: string; state: string }>>;
      };
      for (const arr of Object.values(parsed.devices ?? {})) {
        const sim = arr.find((d) => d.name === simulatorName && d.state === "Booted");
        if (sim) return sim.udid;
      }
    } catch {
      // ignore
    }
    return null;
  }

  private async isSimulatorResponsive(simulatorId: string): Promise<boolean> {
    const r = await execWithTimeout("xcrun", ["simctl", "list", "apps", simulatorId], this.COMMAND_TIMEOUT_SECONDS);
    if (r.timedOut) {
      console.warn("Таймаут при проверке работоспособности симулятора iOS");
      return false;
    }
    return r.code === 0;
  }

  private async forceStopIosSimulator(simulatorId: string): Promise<void> {
    await execWithTimeout("xcrun", ["simctl", "shutdown", simulatorId], this.COMMAND_TIMEOUT_SECONDS);
    await sleep(2000);
    await execWithTimeout("xcrun", ["simctl", "shutdown", "all"], this.COMMAND_TIMEOUT_SECONDS);
    await execWithTimeout("killall", ["Simulator"], this.COMMAND_TIMEOUT_SECONDS);
  }

  private async startIosSimulator(): Promise<boolean> {
    if (!this.isMac()) {
      console.error("iOS симуляторы поддерживаются только на macOS");
      return false;
    }
    if (!(await this.checkRequiredTools(["xcrun", "simctl"]))) {
      console.error("Отсутствуют необходимые утилиты для запуска iOS симулятора");
      return false;
    }

    const deviceName = AppConfig.getIosDeviceName();
    if (!deviceName) {
      console.error("Не указано имя устройства iOS для запуска");
      return false;
    }
    console.info(`Запуск iOS симулятора: ${deviceName}`);

    const existing = await this.getSimulatorId(deviceName);
    if (existing) {
      console.info(`Симулятор уже запущен: ${existing}`);
      if (await this.isSimulatorResponsive(existing)) {
        console.info("Симулятор работоспособен");
        return true;
      }
      console.warn("Симулятор не отвечает — перезапускаем");
      await this.forceStopIosSimulator(existing);
    }

    // найдём UDID по имени
    const listJson = await this.getSimulatorsList();
    if (!listJson) {
      console.error("Не удалось получить список iOS симуляторов");
      return false;
    }

    let targetUdid: string | null = null;
    try {
      const parsed = JSON.parse(listJson) as {
        devices: Record<string, Array<{ udid: string; name: string; state: string }>>;
      };
      outer: for (const arr of Object.values(parsed.devices ?? {})) {
        for (const sim of arr) {
          if (sim.name === deviceName) {
            targetUdid = sim.udid;
            break outer;
          }
        }
      }
    } catch (e: any) {
      console.error(`Ошибка парсинга JSON списка симуляторов: ${e?.message || e}`);
      return false;
    }

    if (!targetUdid) {
      console.error(`Не найден симулятор с именем: ${deviceName}`);
      return false;
    }

    const boot = await execWithTimeout("xcrun", ["simctl", "boot", targetUdid], this.COMMAND_TIMEOUT_SECONDS);
    if (boot.timedOut || boot.code !== 0) {
      console.error(`Ошибка при запуске симулятора iOS: ${boot.stderr || boot.stdout}`);
      return false;
    }

    // ждём готовности
    const maxAttempts = Math.floor(this.EMULATOR_BOOT_TIMEOUT_SECONDS / 2);
    for (let i = 1; i <= maxAttempts; i++) {
      if (await this.isSimulatorResponsive(targetUdid)) {
        console.info("Симулятор iOS успешно запущен и готов к работе");
        return true;
      }
      console.info(`Ожидание загрузки iOS симулятора… попытка ${i}/${maxAttempts}`);
      await sleep(2000);
    }

    console.error("Симулятор iOS не стал работоспособным за отведённое время");
    return false;
  }

  private async stopIosSimulator(): Promise<boolean> {
    if (!this.isMac()) {
      console.error("iOS симуляторы поддерживаются только на macOS");
      return false;
    }
    if (!(await this.checkRequiredTools(["xcrun", "simctl"]))) {
      console.error("Отсутствуют необходимые утилиты для остановки iOS симулятора");
      return false;
    }

    const deviceName = AppConfig.getIosDeviceName();
    if (!deviceName) {
      console.error("Не указано имя устройства iOS для остановки");
      return false;
    }

    const simId = await this.getSimulatorId(deviceName);
    if (!simId) {
      console.info("Симулятор iOS не запущен — ничего останавливать");
      return true;
    }

    console.info(`Остановка симулятора iOS: ${simId}`);
    await execWithTimeout("xcrun", ["simctl", "shutdown", simId], this.COMMAND_TIMEOUT_SECONDS);
    await sleep(2000);

    const still = await this.getSimulatorId(deviceName);
    if (still) {
      console.warn("Симулятор iOS не остановился стандартным способом — принудительная остановка");
      await this.forceStopIosSimulator(simId);
      await sleep(2000);
      if (await this.getSimulatorId(deviceName)) {
        console.error("Не удалось остановить симулятор iOS даже принудительно");
        return false;
      }
    }

    console.info("Симулятор iOS успешно остановлен");
    return true;
  }
}

export const EmulatorManager = new EmulatorManagerClass();