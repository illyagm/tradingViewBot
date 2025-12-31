import { Router } from "express";
import { normalizeTvPayload } from "../../utils/payloadNormalize.js";
import { sendToClient } from "../../ws/wsServer.js";
import { enqueueForClient } from "../../ws/messageBus.js";

const router = Router();

router.post("/", (req, res) => {
  try {
    const payload = normalizeTvPayload(req);

    // optional clientId for different devices
    const clientId =
      String(req.query.clientId || req.headers["x-client-id"]);

    enqueueForClient(clientId, payload);
    sendToClient(payload);

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[/tv] Bad payload:", error?.message);
    res.status(400).json({ ok: false, error: String(error?.message || error) });
  }
});

export default router;
