/**
 * Захват консольных логов из Node.js и (опционально) attachment в Allure, если адаптер подключён.
 * Это функциональный аналог JVM Logback+Allure.
 */
class _LogCapture {
  private logs: string[] = [];
  private initialized = false;
  private original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  initialize() {
    if (this.initialized) return;
    this.initialized = true;

    const push = (level: string, args: any[]) => {
      const ts = Date.now();
      const thread = "main"; // нет потоков как в JVM
      const msg = args
        .map((a) => (typeof a === "string" ? a : (() => {
          try {
            return JSON.stringify(a);
          } catch {
            return String(a);
          }
        })()))
        .join(" ");
      this.logs.push(`${ts} [${thread}] ${level} - ${msg}`);
    };

    console.log = (...args: any[]) => {
      push("INFO", args);
      this.original.log(...args);
    };
    console.info = (...args: any[]) => {
      push("INFO", args);
      this.original.info(...args);
    };
    console.warn = (...args: any[]) => {
      push("WARN", args);
      this.original.warn(...args);
    };
    console.error = (...args: any[]) => {
      push("ERROR", args);
      this.original.error(...args);
    };
  }

  getLogs(): string {
    return this.logs.join("\n");
  }

  clearLogs() {
    this.logs = [];
  }

  /**
   * Пишет attachment в Allure, если доступен глобальный `allure`.
   */
  attachLogsToAllureReport() {
    const txt = this.getLogs();
    if (!txt) return;

    const g = globalThis as any;
    if (g.allure?.attachment) {
      g.allure.attachment("Console Logs", Buffer.from(txt, "utf8"), "text/plain");
    }
    this.clearLogs();
  }
}

export const LogCapture = new _LogCapture();