import "dotenv/config";
import { createServer } from "http";
import { createApp } from "./src/app/server.js";

const PORT = Number(process.env.PORT || 3001);

const app = createApp();
const server = createServer(app);

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
