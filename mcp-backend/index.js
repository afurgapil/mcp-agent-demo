import "dotenv/config";
import { createServer } from "http";
import { createApp } from "./src/app/server.js";
import { connectMongo } from "./src/db/mongoose.js";

const PORT = Number(process.env.PORT || 3001);

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
