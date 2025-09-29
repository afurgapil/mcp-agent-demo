import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { connectMongo } from "../src/db/mongoose.js";
import fs from "fs/promises";

// ensure we load env from mcp-backend/.env regardless of cwd
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const filter = {};

const connection = await connectMongo();
if (!connection) {
  console.log("No Mongo URI configured; skipping query.");
  process.exit(0);
}

const coll = mongoose.connection.db.collection("training_logs");
const cursor = coll.find(filter);
const result = await cursor.toArray();
console.log("documents:", result.length);

// write results to reports as JSON
const reportsDir = path.resolve(__dirname, "..", "reports");
await fs.mkdir(reportsDir, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = path.join(reportsDir, `training_logs.${ts}.json`);
await fs.writeFile(outFile, JSON.stringify(result, null, 2), "utf8");
console.log("saved:", outFile);

await mongoose.disconnect();
