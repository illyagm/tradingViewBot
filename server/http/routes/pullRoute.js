import { Router } from "express";
import { dequeueForClient } from "../../ws/messageBus.js";

const router = Router();

// GET /pull?clientId=1
router.get("/", (req, res) => {
  const clientId = String(req.query.clientId);
  const msg = dequeueForClient(clientId); // consume 1 msg
  res.status(200).json({ ok: true, msg: msg ?? null });
});

export default router;
