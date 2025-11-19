import { Router } from "express";
import { normalizeNotifyPayload } from "../../utils/payloadNormalize.js";
import { handleNotification } from "../../services/notificationService.js";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const payload = normalizeNotifyPayload(req);
    await handleNotification(payload);
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[/notify] Bad payload:", error?.message);
    res.status(400).json({ ok: false, error: String(error?.message || error) });
  }
});

export default router;
