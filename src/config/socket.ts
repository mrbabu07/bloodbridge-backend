import { Server as SocketIOServer } from "socket.io";
import { Server as HTTPServer } from "http";
import jwt from "jsonwebtoken";
import { JWTPayload } from "../types";

interface AuthenticatedSocket extends Socket {
  userId?: string;
  userEmail?: string;
  userRole?: string;
}

class SocketManager {
  private static instance: SocketManager;
  private io: SocketIOServer | null = null;
  private connectedUsers: Map<string, string> = new Map(); // userId -> socketId

  private constructor() {}

  public static getInstance(): SocketManager {
    if (!SocketManager.instance) {
      SocketManager.instance = new SocketManager();
    }
    return SocketManager.instance;
  }

  public initialize(server: HTTPServer): SocketIOServer {
    this.io = new SocketIOServer(server, {
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:5173",
        methods: ["GET", "POST"],
        credentials: true,
      },
      transports: ["websocket", "polling"],
    });

    // Authentication middleware
    this.io.use(async (socket: any, next) => {
      try {
        const token =
          socket.handshake.auth.token || socket.handshake.headers.authorization;

        if (!token) {
          return next(new Error("Authentication token required"));
        }

        const tokenValue = token.startsWith("Bearer ") ? token.slice(7) : token;
        const JWT_SECRET =
          process.env.JWT_SECRET ||
          "your-super-secret-jwt-key-change-in-production";

        const decoded = jwt.verify(tokenValue, JWT_SECRET) as JWTPayload;

        socket.userId = decoded.userId;
        socket.userEmail = decoded.email;
        socket.userRole = decoded.role;

        next();
      } catch (error) {
        next(new Error("Invalid authentication token"));
      }
    });

    // Connection handling
    this.io.on("connection", (socket: AuthenticatedSocket) => {
      console.log(`✅ User connected: ${socket.userEmail} (${socket.id})`);

      if (socket.userId) {
        this.connectedUsers.set(socket.userId, socket.id);

        // Join user to their personal room
        socket.join(`user:${socket.userId}`);

        // Join role-based rooms
        if (socket.userRole) {
          socket.join(`role:${socket.userRole}`);
        }
      }

      // Handle user-specific events
      socket.on("join-room", (roomId: string) => {
        socket.join(roomId);
        console.log(`User ${socket.userEmail} joined room: ${roomId}`);
      });

      socket.on("leave-room", (roomId: string) => {
        socket.leave(roomId);
        console.log(`User ${socket.userEmail} left room: ${roomId}`);
      });

      // Handle notification acknowledgment
      socket.on("notification-read", (notificationId: string) => {
        console.log(
          `Notification ${notificationId} marked as read by ${socket.userEmail}`
        );
        // This will be handled by the notification service
      });

      // Handle typing indicators for chat features
      socket.on("typing-start", (data: { roomId: string }) => {
        socket.to(data.roomId).emit("user-typing", {
          userId: socket.userId,
          userEmail: socket.userEmail,
        });
      });

      socket.on("typing-stop", (data: { roomId: string }) => {
        socket.to(data.roomId).emit("user-stopped-typing", {
          userId: socket.userId,
          userEmail: socket.userEmail,
        });
      });

      // Handle disconnection
      socket.on("disconnect", (reason) => {
        console.log(`❌ User disconnected: ${socket.userEmail} (${reason})`);
        if (socket.userId) {
          this.connectedUsers.delete(socket.userId);
        }
      });

      // Handle connection errors
      socket.on("error", (error) => {
        console.error(`Socket error for user ${socket.userEmail}:`, error);
      });
    });

    console.log("✅ Socket.IO server initialized");
    return this.io;
  }

  public getIO(): SocketIOServer {
    if (!this.io) {
      throw new Error("Socket.IO not initialized. Call initialize() first.");
    }
    return this.io;
  }

  // Send notification to specific user
  public sendToUser(userId: string, event: string, data: any): boolean {
    if (!this.io) return false;

    this.io.to(`user:${userId}`).emit(event, data);
    return true;
  }

  // Send notification to multiple users
  public sendToUsers(userIds: string[], event: string, data: any): void {
    if (!this.io) return;

    userIds.forEach((userId) => {
      this.io!.to(`user:${userId}`).emit(event, data);
    });
  }

  // Send notification to all users with specific role
  public sendToRole(role: string, event: string, data: any): void {
    if (!this.io) return;

    this.io.to(`role:${role}`).emit(event, data);
  }

  // Send notification to all connected users
  public broadcast(event: string, data: any): void {
    if (!this.io) return;

    this.io.emit(event, data);
  }

  // Send notification to specific room
  public sendToRoom(roomId: string, event: string, data: any): void {
    if (!this.io) return;

    this.io.to(roomId).emit(event, data);
  }

  // Check if user is online
  public isUserOnline(userId: string): boolean {
    return this.connectedUsers.has(userId);
  }

  // Get online users count
  public getOnlineUsersCount(): number {
    return this.connectedUsers.size;
  }

  // Get all online user IDs
  public getOnlineUserIds(): string[] {
    return Array.from(this.connectedUsers.keys());
  }
}

export default SocketManager;
