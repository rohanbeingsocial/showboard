import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";

type Handle = (req: Request) => Promise<Response>;

/** Adapts the fetch-style handler to node:http (and Express/Connect, which use the same signature). */
export function toNodeListener(handle: Handle) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
      else if (value !== undefined) headers.set(key, value);
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const request = new Request(`http://${req.headers.host ?? "localhost"}${req.originalUrl ?? req.url}`, {
      method: req.method,
      headers,
      body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
      duplex: "half",
    } as RequestInit);

    const response = await handle(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.flushHeaders();
    if (!response.body) {
      res.end();
      return;
    }
    const reader = response.body.getReader();
    res.on("close", () => void reader.cancel());
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  };
}

declare module "node:http" {
  interface IncomingMessage {
    /** Set by Express when the handler is mounted under a path. */
    originalUrl?: string;
  }
}

/** Serves the handler on 127.0.0.1 (the handler itself refuses non-local Host headers). */
export function serve(handle: Handle, options: { port: number; host?: string }): Promise<Server> {
  const listener = toNodeListener(handle);
  const server = createServer((req, res) => {
    listener(req, res).catch((err: Error) => {
      console.error("showboard:", err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host ?? "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}
