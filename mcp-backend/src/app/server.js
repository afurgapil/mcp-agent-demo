import express from "express";
import cors from "cors";
import { env } from "../utils/env.js";
import morgan from "morgan";
import routes from "../routes/index.js";

export function createApp() {
  const app = express();
  app.set("etag", false);
  app.use(
    cors(
      env.CORS_ORIGIN
        ? {
            origin: env.CORS_ORIGIN.split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            credentials: true,
          }
        : { origin: true, credentials: true }
    )
  );
  app.use(express.json({ limit: "2mb" }));
  // Remove request logging in production
  // app.use(morgan("dev"));

  // Express 5 + cors middleware handle preflight; no need for a wildcard OPTIONS route

  app.use(routes);

  app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  });

  return app;
}
