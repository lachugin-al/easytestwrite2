/**
 * Локальный HTTP-сервер для тестовой инфраструктуры.
 *
 * Функции:
 * - Хостинг локальных файлов (/file/)
 * - Приём событий от клиента (/m/batch) и их сохранение в EventStorage
 *
 * Зависимостей нет — только стандартные модули Node.js.
 */

import { EventStorage } from "../domain/events/storage";
import type { Event, EventData } from "../domain/events/model";
import http, { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import { networkInterfaces } from "node:os";
import { createReadStream, statSync, existsSync } from "node:fs";
import { join, extname, isAbsolute, win32 } from "node:path";

// ------------------------ Вспомогательные утилиты ------------------------

function getLocalAddress(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  // fallback
  return "127.0.0.1";
}

function isWindowsAbsolute(p: string): boolean {
  return !!p && win32.isAbsolute(p);
}

function detectContentType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".html":
    case ".htm":
      return "text/html; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".txt":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ------------------------------- Сервер -------------------------------

export default class WebServer {
  private server?: http.Server;
  private serverUrl?: string;
  private paused = false;

  constructor(
    private readonly port: number = 8000,
    private readonly host: string = getLocalAddress()
  ) {
    // shutdown hook
    const graceful = async (signal: string) => {
      try {
        await this.close();
        console.log(`[WebServer] Остановлен (${signal}) на ${this.serverUrl}`);
      } catch (e) {
        console.error(`[WebServer] Ошибка при остановке:`, e);
      } finally {
        process.exit(0);
      }
    };
    process.once("SIGINT", () => graceful("SIGINT"));
    process.once("SIGTERM", () => graceful("SIGTERM"));
  }

  start(): Promise<void> {
    if (this.server) return Promise.resolve();

    this.server = http.createServer(this.handleRequest);
    return new Promise((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.port, this.host, () => {
        this.serverUrl = `http://${this.host}:${(this.server!.address() as any).port}`;
        console.log(`[WebServer] Запущен на ${this.serverUrl}`);
        resolve();
      });
    });
  }

  getServerUrl(): string | undefined {
    return this.serverUrl;
  }

  getHostingUrl(): string | undefined {
    return this.serverUrl ? `${this.serverUrl}/file/` : undefined;
  }

  async close(): Promise<void> {
    if (!this.server) return;
    const srv = this.server;
    this.server = undefined;
    this.serverUrl = undefined;
    await new Promise<void>((resolve, reject) =>
      srv.close((err) => (err ? reject(err) : resolve()))
    );
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  // -------------------------- Обработчики --------------------------

  private awaitResume = async (): Promise<void> => {
    while (this.paused) {
      await new Promise((r) => setTimeout(r, 5));
    }
  };

  private handleRequest = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      await this.awaitResume();

      const hostHeader = req.headers.host || `${this.host}:${this.port}`;
      const url = new URL(req.url || "/", `http://${hostHeader}`);
      const pathname = url.pathname;

      if (pathname.startsWith("/file/")) {
        return this.handleFile(req, res, url);
      }

      if (pathname === "/m/batch" && req.method === "POST") {
        return this.handleBatch(req, res, url);
      }

      // default 404
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
    } catch (err) {
      console.error("[WebServer] Необработанная ошибка:", err);
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Internal Server Error");
    }
  };

  private handleFile = (_req: IncomingMessage, res: ServerResponse, url: URL) => {
    // Снимаем префикс /file/
    const raw = decodeURIComponent(url.pathname.replace(/^\/file\/+/, ""));
    const path =
      isAbsolute(raw) || isWindowsAbsolute(raw) ? raw : join(process.cwd(), raw);

    console.log(`[WebServer] Отправка файла клиенту: ${path}`);

    if (!existsSync(path)) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("File Not Found");
      return;
    }

    try {
      const stat = statSync(path);
      res.statusCode = 200;
      res.setHeader("Content-Type", detectContentType(path));
      res.setHeader("Content-Length", String(stat.size));
      const stream = createReadStream(path);
      stream.on("error", (e) => {
        console.error(`[WebServer] Ошибка чтения файла:`, e);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
        }
        res.end("Failed to read file");
      });
      stream.pipe(res);
    } catch (e) {
      console.error(`[WebServer] Ошибка при обработке файла:`, e);
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Internal Server Error");
    }
  };

  private handleBatch = async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    const bodyText = await readBody(req);

    let root: any;
    try {
      root = bodyText ? JSON.parse(bodyText) : {};
    } catch (e) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Bad JSON");
      return;
    }

    const metaData = Object.prototype.hasOwnProperty.call(root, "meta")
      ? root.meta
      : null;
    const eventsData: any[] = Array.isArray(root.events) ? root.events : [];

    const baseNum = EventStorage.getLastEvent()?.event_num ?? 0;

    const remoteAddress =
      (req.socket && (req.socket.remoteAddress || null)) || null;

    const query = url.search ? url.search.replace(/^\?/, "") : null;

    const parsedEvents: Event[] = eventsData.map((evJson, idx) => {
      const evObj = typeof evJson === "object" && evJson ? evJson : {};
      const evTime =
        typeof evObj.event_time === "string" && evObj.event_time
          ? evObj.event_time
          : new Date().toISOString();

      const numFromClient =
        typeof evObj.event_num === "number" ? (evObj.event_num as number) : null;
      const evNum = numFromClient ?? baseNum + idx + 1;

      const evName =
        typeof evObj.name === "string" && evObj.name ? evObj.name : "UNKNOWN";

      const singleRecord = {
        meta: metaData,
        event: evJson,
      };

      const data: EventData = {
        uri: url.toString(),
        remoteAddress,
        headers: req.headers as Record<string, string[]>,
        query,
        body: JSON.stringify(singleRecord),
      };

      return {
        event_time: evTime,
        event_num: evNum,
        name: evName,
        data,
      };
    });

    EventStorage.addEvents(parsedEvents);

    const ok = "OK";
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Length", String(Buffer.byteLength(ok, "utf8")));
    res.end(ok);
  };
}

// ---------------------------- Пример запуска ----------------------------

if (require.main === module) {
  const server = new WebServer(8000, getLocalAddress());
  server.start().catch((e) => {
    console.error("[WebServer] Не удалось инициализировать сервер:", e);
    process.exit(1);
  });
}