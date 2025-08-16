import { execFileSync, spawnSync } from "node:child_process";

type SimulatorsResponse = {
  devices: Record<string, Array<{ udid: string; name: string; state: string }>>;
};

// --- перегрузки функции ---
export function runCommand(command: string[], errorMessage: string): boolean;
export function runCommand(command: string[]): string;
export function runCommand(command: string[], errorMessage?: string): boolean | string {
  try {
    const [file, ...args] = command;
    const res = spawnSync(file, args, { encoding: "utf8" });

    if (errorMessage !== undefined) {
      if (res.status === 0) {
        console.log(`Команда выполнена успешно: ${command.join(" ")}`);
        return true;
      }
      console.log(`${errorMessage}: ${res.stdout || res.stderr}`);
      return false;
    }
    return res.stdout?.toString() ?? "";
  } catch (e: any) {
    if (errorMessage !== undefined) {
      console.log(`${errorMessage}: ${e?.message}`);
      return false;
    }
    return "";
  }
}

export const Terminal = {
  runCommand, // ← используем перегруженную функцию

  /**
   * UDID симулятора iOS по имени (ищет Booted).
   */
  getSimulatorId(simulatorName: string): string | null {
    try {
      const out = execFileSync("xcrun", ["simctl", "list", "--json"], { encoding: "utf8" });
      const json = JSON.parse(out) as SimulatorsResponse;

      for (const devices of Object.values(json.devices ?? {})) {
        const found = devices.find((d) => d.name === simulatorName && d.state === "Booted");
        if (found) return found.udid;
      }
    } catch {
      // ignore
    }
    return null;
  },

  /**
   * ID эмулятора Android по имени. По умолчанию "emulator-5554".
   */
  getEmulatorId(emulatorName: string = "emulator-5554"): string | null {
    const ok = runCommand(["adb", "devices"], "Не удалось получить ID эмулятора");
    if (ok !== true) return null;

    try {
      const out = execFileSync("adb", ["devices"], { encoding: "utf8" });
      const line = out
        .split(/\r?\n/)
        .find((l) => l.includes(emulatorName) && l.includes("device"));
      return line ? line.split("\t")[0] : null;
    } catch {
      return null;
    }
  },
};