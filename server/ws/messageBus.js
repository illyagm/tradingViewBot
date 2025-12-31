const queues = new Map();

function getQueue(clientId = "1") {
  const id = String(clientId || "1");
  let q = queues.get(id);
  if (!q) {
    q = [];
    queues.set(id, q);
  }
  return q;
}

export function enqueueForClient(clientId, msg) {
  const q = getQueue(clientId);
  q.push(msg);

  // evita memory leak si algo se rompe
  const MAX = 200;
  if (q.length > MAX) q.splice(0, q.length - MAX);
}

export function dequeueForClient(clientId) {
  const q = getQueue(clientId);
  return q.length ? q.shift() : null;
}

export function peekForClient(clientId) {
  const q = getQueue(clientId);
  return q.length ? q[0] : null;
}

export function clearClient(clientId) {
  queues.delete(String(clientId || "1"));
}
