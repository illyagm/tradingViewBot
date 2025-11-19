import express from "express";
import helmet from "helmet";
import morgan from "morgan";

import tvRoute from "./routes/tvRoute.js";
import notifyRoute from "./routes/notifyRoute.js";
import healthRoute from "./routes/healthRoute.js";

export function createHttpApp() {
  const app = express();

  app.use(helmet());
  app.use(morgan("dev"));

  app.use(express.text({ type: "text/*", limit: "256kb" }));
  app.use(express.json({ type: "application/json", limit: "256kb" }));

  app.use("/tv", tvRoute);
  app.use("/notify", notifyRoute);
  app.use("/health", healthRoute);

  return app;
}
