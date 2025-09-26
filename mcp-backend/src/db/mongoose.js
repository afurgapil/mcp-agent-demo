import mongoose from "mongoose";

let connectionPromise = null;
let didWarnMissingUri = false;

function resolveMongoUri() {
  return process.env.MONGO_URI || process.env.MONGODB_URI || null;
}

export async function connectMongo() {
  const uri = resolveMongoUri();
  if (!uri) {
    if (!didWarnMissingUri) {
      console.warn(
        "Mongo connection URI not provided (set MONGO_URI); training logs are disabled."
      );
      didWarnMissingUri = true;
    }
    return null;
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!connectionPromise) {
    mongoose.set("strictQuery", true);
    const poolSize = Number(process.env.MONGO_POOL_SIZE || 5);
    const dbName =
      process.env.MONGO_DB_NAME || process.env.MONGO_DATABASE || "mcp";
    const connectOptions = {
      maxPoolSize: Number.isNaN(poolSize) ? 5 : poolSize,
    };
    if (dbName) {
      connectOptions.dbName = dbName;
    }
    connectionPromise = mongoose
      .connect(uri, connectOptions)
      .then((conn) => {
        console.log("MongoDB connected for training logs.");
        return conn;
      })
      .catch((err) => {
        connectionPromise = null;
        console.error("MongoDB connection failed:", err.message);
        throw err;
      });
  }

  try {
    return await connectionPromise;
  } catch (err) {
    return null;
  }
}

export function isMongoReady() {
  return mongoose.connection.readyState === 1;
}
