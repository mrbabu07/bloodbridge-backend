import { MongoClient, ServerApiVersion, Db } from "mongodb";
import { createClient, RedisClientType } from "redis";

class DatabaseManager {
  private static instance: DatabaseManager;
  private mongoClient: MongoClient | null = null;
  private redisClient: RedisClientType | null = null;
  private database: Db | null = null;

  private constructor() {}

  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  public async connectMongoDB(): Promise<Db> {
    if (this.database) {
      return this.database;
    }

    const uri = process.env.MONGODB_URI;
    if (!uri || uri.includes("your_")) {
      throw new Error("MONGODB_URI is not defined or is a placeholder!");
    }

    this.mongoClient = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });

    try {
      await this.mongoClient.connect();
      await this.mongoClient.db("admin").command({ ping: 1 });
      console.log("✅ Successfully connected to MongoDB!");

      this.database = this.mongoClient.db(
        process.env.DB_NAME || "bloodBridgeDB"
      );

      // Create indexes for better performance
      await this.createIndexes();

      return this.database;
    } catch (error) {
      console.error("❌ MongoDB connection failed:", error);
      throw error;
    }
  }

  public async connectRedis(): Promise<RedisClientType> {
    if (this.redisClient) {
      return this.redisClient;
    }

    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

    this.redisClient = createClient({
      url: redisUrl,
    });

    this.redisClient.on("error", (err) => {
      console.error("❌ Redis Client Error:", err);
    });

    this.redisClient.on("connect", () => {
      console.log("✅ Successfully connected to Redis!");
    });

    await this.redisClient.connect();
    return this.redisClient;
  }

  private async createIndexes(): Promise<void> {
    if (!this.database) return;

    try {
      // User collection indexes
      const userCollection = this.database.collection("user");
      await userCollection.createIndex({ email: 1 }, { unique: true });
      await userCollection.createIndex({ "location.coordinates": "2dsphere" });
      await userCollection.createIndex({ bloodGroup: 1 });
      await userCollection.createIndex({ role: 1 });
      await userCollection.createIndex({ status: 1 });
      await userCollection.createIndex({ lastDonationDate: 1 });
      await userCollection.createIndex({ createdAt: 1 });

      // Blood request collection indexes
      const requestCollection = this.database.collection("request");
      await requestCollection.createIndex({
        "location.coordinates": "2dsphere",
      });
      await requestCollection.createIndex({ bloodGroup: 1 });
      await requestCollection.createIndex({ status: 1 });
      await requestCollection.createIndex({ urgencyLevel: 1 });
      await requestCollection.createIndex({ requiredBy: 1 });
      await requestCollection.createIndex({ createdAt: 1 });
      await requestCollection.createIndex({ requesterId: 1 });

      // Notification collection indexes
      const notificationCollection = this.database.collection("notification");
      await notificationCollection.createIndex({ userId: 1 });
      await notificationCollection.createIndex({ type: 1 });
      await notificationCollection.createIndex({ status: 1 });
      await notificationCollection.createIndex({ createdAt: 1 });
      await notificationCollection.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0 }
      );

      // Analytics collection indexes
      const analyticsCollection = this.database.collection("analytics");
      await analyticsCollection.createIndex(
        { date: 1, type: 1 },
        { unique: true }
      );
      await analyticsCollection.createIndex({ generatedAt: 1 });

      // Content collection indexes
      const contentCollection = this.database.collection("content");
      await contentCollection.createIndex({ type: 1 });
      await contentCollection.createIndex({ status: 1 });
      await contentCollection.createIndex({ authorId: 1 });
      await contentCollection.createIndex({ publishedAt: 1 });
      await contentCollection.createIndex({ scheduledFor: 1 });
      await contentCollection.createIndex({ tags: 1 });

      // Activity log collection indexes
      const activityLogCollection = this.database.collection("activityLog");
      await activityLogCollection.createIndex({ userId: 1 });
      await activityLogCollection.createIndex({ action: 1 });
      await activityLogCollection.createIndex({ timestamp: 1 });

      console.log("✅ Database indexes created successfully");
    } catch (error) {
      console.error("❌ Error creating indexes:", error);
    }
  }

  public getDatabase(): Db {
    if (!this.database) {
      throw new Error("Database not connected. Call connectMongoDB() first.");
    }
    return this.database;
  }

  public getRedisClient(): RedisClientType {
    if (!this.redisClient) {
      throw new Error("Redis not connected. Call connectRedis() first.");
    }
    return this.redisClient;
  }

  public async disconnect(): Promise<void> {
    if (this.mongoClient) {
      await this.mongoClient.close();
      this.mongoClient = null;
      this.database = null;
      console.log("✅ MongoDB disconnected");
    }

    if (this.redisClient) {
      await this.redisClient.quit();
      this.redisClient = null;
      console.log("✅ Redis disconnected");
    }
  }
}

export default DatabaseManager;
