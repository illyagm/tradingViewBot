import { Router } from "express";
import { HTTP_PORT } from "../../config/env.js";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    ok: true,
    http: `http://localhost:${HTTP_PORT}/tv`,
  });
});

export default router;
