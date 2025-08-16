import * as os from "node:os";
import * as net from "node:net";

/**
 * Сетевые утилиты для Node.js
 */
export const Network = {
  /**
   * Локальный site-local IPv4 адрес (напр., 192.168.x.x / 10.x.x.x).
   */
  getLocalAddress(): string | null {
    const ifaces = os.networkInterfaces();
    for (const [_name, addrs] of Object.entries(ifaces)) {
      if (!addrs) continue;
      for (const a of addrs) {
        if (a.family !== "IPv4" || a.internal) continue;
        // простая эвристика "site-local"
        if (
          a.address.startsWith("10.") ||
          a.address.startsWith("192.168.") ||
          a.address.startsWith("172.16.") ||
          a.address.startsWith("172.17.") ||
          a.address.startsWith("172.18.") ||
          a.address.startsWith("172.19.") ||
          a.address.startsWith("172.20.") ||
          a.address.startsWith("172.21.") ||
          a.address.startsWith("172.22.") ||
          a.address.startsWith("172.23.") ||
          a.address.startsWith("172.24.") ||
          a.address.startsWith("172.25.") ||
          a.address.startsWith("172.26.") ||
          a.address.startsWith("172.27.") ||
          a.address.startsWith("172.28.") ||
          a.address.startsWith("172.29.") ||
          a.address.startsWith("172.30.") ||
          a.address.startsWith("172.31.")
        ) {
          return a.address;
        }
      }
    }
    return null;
  },

  /**
   * Эвристика активного физического интерфейса.
   * Для macOS часто en0/en1, VPN — utun*. Возвращаем "Wi-Fi" если находим такие интерфейсы.
   */
  getActiveNetworkInterface(): string {
    const ifaces = Object.keys(os.networkInterfaces());
    if (ifaces.some((n) => n.startsWith("en") || n.startsWith("utun"))) {
      return "Wi-Fi";
    }
    throw new Error("Активный физический сетевой интерфейс не найден");
  },

  /**
   * Поиск свободного порта (асинхронно).
   * Аналог ServerSocket(0).
   */
  async getFreePort(defaultPort = 8000): Promise<number> {
    return new Promise<number>((resolve) => {
      const srv = net.createServer();
      srv.unref();
      srv.on("error", () => resolve(defaultPort));
      srv.listen(0, () => {
        const addr = srv.address();
        srv.close();
        if (typeof addr === "object" && addr && "port" in addr) resolve(addr.port);
        else resolve(defaultPort);
      });
    });
  },
};