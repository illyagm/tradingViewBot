import { Router } from "express";
import { normalizeTvPayload } from "../../utils/payloadNormalize.js";
import { sendToClient } from "../../ws/wsServer.js";

const router = Router();

router.post("/", (req, res) => {
  try {
    const payload = normalizeTvPayload(req);
    sendToClient(payload);
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[/tv] Bad payload:", error?.message);
    res.status(400).json({ ok: false, error: String(error?.message || error) });
  }
});

export default router;
