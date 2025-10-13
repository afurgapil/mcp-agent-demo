import { createServer } from "http";
import dns from "node:dns";
import { createApp } from "./server.js";
import { connectMongo } from "../db/mongoose.js";
import { env, loadEnv } from "../utils/env.js";

let server = null;

try {
  loadEnv();
} catch (err) {
  console.error("Failed to load environment:", err?.message || err);
  process.exit(1);
}

try {
  dns.setDefaultResultOrder("ipv4first");
} catch {}

const app = createApp();

(async () => {
  try {
    await connectMongo();
  } catch (err) {
    console.warn(
      "MongoDB connection unavailable; training logs disabled.",
      err?.message || err
    );
  }

  server = createServer(app);

  server.listen(env.PORT, () => {
    console.log(`Server listening on http://localhost:${env.PORT}`);
  });
})();

process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down gracefully");
  if (server) {
    server.close(() => process.exit(0));
  } else {
    process.exit(0);
  }
});

process.on("SIGINT", () => {
  console.log("Received SIGINT, shutting down gracefully");
  if (server) {
    server.close(() => process.exit(0));
  } else {
    process.exit(0);
  }
});
