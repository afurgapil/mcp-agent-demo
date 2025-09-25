import express from "express";
import cors from "cors";
import morgan from "morgan";
import routes from "../routes/index.js";
import { handleOptions } from "../utils/response.js";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));
  app.use(morgan("dev"));

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
