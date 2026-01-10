import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";

let mongod: MongoMemoryServer;
let mongoClient: MongoClient;

beforeAll(async () => {
  // Start in-memory MongoDB instance
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();

  // Connect to the in-memory database
  mongoClient = new MongoClient(uri);
  await mongoClient.connect();

  // Set environment variables for testing
  process.env.MONGODB_URI = uri;
  process.env.DB_NAME = "testDB";
  process.env.JWT_SECRET = "test-jwt-secret";
  process.env.NODE_ENV = "test";
});

afterAll(async () => {
  // Clean up
  if (mongoClient) {
    await mongoClient.close();
  }
  if (mongod) {
    await mongod.stop();
  }
});

beforeEach(async () => {
  // Clear all collections before each test
  if (mongoClient) {
    const db = mongoClient.db("testDB");
    const collections = await db.listCollections().toArray();

    for (const collection of collections) {
      await db.collection(collection.name).deleteMany({});
    }
  }
});

// Mock Redis for testing
jest.mock("redis", () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    setex: jest.fn(),
    incr: jest.fn(),
    decr: jest.fn(),
    decrby: jest.fn(),
    lpush: jest.fn(),
    lrange: jest.fn(),
    del: jest.fn(),
    expire: jest.fn(),
    quit: jest.fn(),
    on: jest.fn(),
  })),
}));
