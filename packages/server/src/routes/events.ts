import { Router, Request, Response } from "express";
const router: Router = Router();
const clients = new Set<Response>();

router.get("/", (req: Request, res: Response) => {
  // CORS is handled by the cors(corsOptions(config)) middleware in server.ts
  // — never set Access-Control-Allow-Origin here. A wildcard on the event
  // stream would let any website read prompts, agent activity and secrets.
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write('data: {"type":"connected"}\n\n');
  clients.add(res);

  // Without a heartbeat, proxies and idle timeouts silently drop the connection.
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

export function broadcast(event: string, data: any) {
  for (const c of clients)
    c.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export default router;
