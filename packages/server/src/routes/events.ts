import { Router, Request, Response } from "express";
const router = Router();
const clients = new Set<Response>();

router.get("/", (req: Request, res: Response) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  res.write('data: {"type":"connected"}\n\n');
  clients.add(res);
  req.on("close", () => clients.delete(res));
});

export function broadcast(event: string, data: any) {
  for (const c of clients)
    c.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export default router;
