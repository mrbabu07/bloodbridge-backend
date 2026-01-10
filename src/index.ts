import express from "express";
import { createServer } from "http";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import dotenv from "dotenv";

// Import configurations and services
import DatabaseManager from "./config/database";
import SocketManager from "./config/socket";
import NotificationService from "./services/NotificationService";

// Import types
import { JWTPayload } from "./types";

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);
const port = process.env.PORT || 3000;

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000"), // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100"), // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// Compression middleware
app.use(compression());

// Logging middleware
app.use(morgan("combined"));

// CORS configuration
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Initialize services
async function initializeServices() {
  try {
    // Initialize database connections
    const dbManager = DatabaseManager.getInstance();
    await dbManager.connectMongoDB();
    await dbManager.connectRedis();

    // Initialize Socket.IO
    const socketManager = SocketManager.getInstance();
    socketManager.initialize(server);

    // Initialize notification service
    NotificationService.getInstance();

    console.log("✅ All services initialized successfully");
  } catch (error) {
    console.error("❌ Failed to initialize services:", error);
    process.exit(1);
  }
}

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
  });
});

// API routes will be added here
app.get("/", (req, res) => {
  res.json({
    message: "BloodBridge Comprehensive Platform API",
    version: "2.0.0",
    status: "running",
    features: [
      "Real-time notifications",
      "AI-powered matching",
      "Advanced analytics",
      "Content management",
      "Automated processes",
    ],
  });
});

// Error handling middleware
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error("Error:", err);

    // Don't leak error details in production
    const isDevelopment = process.env.NODE_ENV === "development";

    res.status(err.status || 500).json({
      success: false,
      message: err.message || "Internal server error",
      ...(isDevelopment && { stack: err.stack }),
    });
  }
);

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
    path: req.originalUrl,
  });
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down gracefully");

  server.close(async () => {
    try {
      await DatabaseManager.getInstance().disconnect();
      console.log("✅ Server shut down gracefully");
      process.exit(0);
    } catch (error) {
      console.error("❌ Error during shutdown:", error);
      process.exit(1);
    }
  });
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, shutting down gracefully");

  server.close(async () => {
    try {
      await DatabaseManager.getInstance().disconnect();
      console.log("✅ Server shut down gracefully");
      process.exit(0);
    } catch (error) {
      console.error("❌ Error during shutdown:", error);
      process.exit(1);
    }
  });
});

// Start server
async function startServer() {
  try {
    await initializeServices();

    server.listen(port, () => {
      console.log(`
🚀 BloodBridge Comprehensive Platform Server Started
📍 Port: ${port}
🌍 Environment: ${process.env.NODE_ENV || "development"}
🔗 Frontend URL: ${process.env.FRONTEND_URL || "http://localhost:5173"}
⚡ Real-time: Socket.IO enabled
🗄️  Database: MongoDB connected
🔄 Cache: Redis connected
📊 Analytics: Enabled
🤖 AI Features: Ready
🔔 Notifications: Real-time enabled
      `);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
