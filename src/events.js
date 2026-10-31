export function eventHub(store) {
  const clients = new Set();
  const send = (res, name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify({ data })}\n\n`);
  const valid = client => new Promise(resolve => store.get(client.sid, (error, data) => resolve(!error && data?.userId === client.userId)));
  return {
    connect(req, res) {
      res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
      const client = { res, sid: req.sessionID, userId: req.user.id };
      clients.add(client);
      send(res, 'ready', { connected: true });
      const timer = setInterval(async () => {
        if (!await valid(client)) return res.end();
        res.write(': heartbeat\n\n');
      }, 15_000);
      timer.unref();
      res.on('close', () => { clearInterval(timer); clients.delete(client); });
    },
    async publish(userId, name, data) {
      for (const client of clients) {
        if (client.userId !== userId) continue;
        if (!await valid(client)) { client.res.end(); continue; }
        if (!send(client.res, name, data)) client.res.end();
      }
    },
    logout(sid) { for (const client of clients) if (client.sid === sid) client.res.end(); },
    close() { for (const client of clients) client.res.end(); clients.clear(); },
  };
}
