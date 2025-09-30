import "dotenv/config";
import { createServer } from "http";
import dns from "node:dns";
import { createApp } from "./src/app/server.js";
import { connectMongo } from "./src/db/mongoose.js";

const PORT = Number(process.env.PORT || 3001);

// Prefer IPv4 when both A/AAAA exist to avoid IPv6-only paths failing on LAN
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {}

const app = createApp();

try {
  await connectMongo();
} catch (err) {
  console.warn(
    "MongoDB connection unavailable; training logs disabled.",
    err?.message || err
  );
}

const server = createServer(app);

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
