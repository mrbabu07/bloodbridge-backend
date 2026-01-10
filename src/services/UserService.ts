import { ObjectId, Collection } from "mongodb";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import DatabaseManager from "../config/database";
import NotificationService from "./NotificationService";
import {
  User,
  UserRole,
  UserStatus,
  ActivityLogEntry,
  DonationRecord,
  JWTPayload,
  ApiResponse,
  PaginatedResponse,
} from "../types";

interface UserRegistrationData {
  name: string;
  email: string;
  password: string;
  bloodGroup: string;
  dateOfBirth?: Date;
  gender?: string;
  phone?: string;
  location: {
    address: string;
    district: string;
    upazila: string;
    coordinates?: [number, number];
  };
  profileImage?: string;
}

interface UserProfile extends Omit<User, "password"> {
  donationSummary: {
    totalDonations: number;
    lastDonationDate?: Date;
    nextEligibleDate?: Date;
    impactScore: number;
  };
  activityMetrics: {
    loginCount: number;
    lastLoginAt?: Date;
    requestsCreated: number;
    donationsCompleted: number;
    responseRate: number;
  };
}

interface BulkOperation {
  type: "role_change" | "status_change";
  userIds: string[];
  newValue: string;
  reason?: string;
}

interface BulkResult {
  successful: number;
  failed: number;
  errors: Array<{ userId: string; error: string }>;
}

class UserService {
  private static instance: UserService;
  private userCollection: Collection<User>;
  private activityLogCollection: Collection<ActivityLogEntry>;
  private notificationService: NotificationService;

  private constructor() {
    const db = DatabaseManager.getInstance().getDatabase();
    this.userCollection = db.collection<User>("user");
    this.activityLogCollection = db.collection<ActivityLogEntry>("activityLog");
    this.notificationService = NotificationService.getInstance();
  }

  public static getInstance(): UserService {
    if (!UserService.instance) {
      UserService.instance = new UserService();
    }
    return UserService.instance;
  }

  // Create new user with enhanced profile
  public async createUser(
    userData: UserRegistrationData
  ): Promise<ApiResponse<{ user: Omit<User, "password">; token: string }>> {
    try {
      // Check if user already exists
      const existingUser = await this.userCollection.findOne({
        email: userData.email.toLowerCase(),
      });

      if (existingUser) {
        return {
          success: false,
          error: "User already exists with this email",
        };
      }

      // Hash password
      const saltRounds = parseInt(process.env.BCRYPT_ROUNDS || "12");
      const hashedPassword = await bcrypt.hash(userData.password, saltRounds);

      // Create user with enhanced profile
      const newUser: User = {
        name: userData.name,
        email: userData.email.toLowerCase(),
        password: hashedPassword,
        bloodGroup: userData.bloodGroup as any,
        dateOfBirth: userData.dateOfBirth,
        gender: userData.gender as any,
        phone: userData.phone,
        location: {
          address: userData.location.address,
          district: userData.location.district,
          upazila: userData.location.upazila,
          coordinates: userData.location.coordinates || [90.4125, 23.8103], // Default to Dhaka
        },
        role: UserRole.DONOR, // Default role
        status: UserStatus.ACTIVE, // Default status
        profileImage: userData.profileImage,
        donationHistory: [],
        activityLog: [],
        notificationPreferences: {
          email: true,
          sms: false,
          push: true,
          urgentOnly: false,
          categories: [],
        },
        eligibilityStatus: "eligible" as any,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Insert user
      const result = await this.userCollection.insertOne(newUser);
      const userId = result.insertedId.toString();

      // Log registration activity
      await this.logActivity(userId, "user_registered", {
        email: userData.email,
        role: UserRole.DONOR,
        registrationMethod: "email",
      });

      // Send welcome notification
      await this.notificationService.sendWelcomeNotification(
        userId,
        userData.name
      );

      // Generate JWT token
      const token = this.generateToken({
        userId,
        email: newUser.email,
        role: newUser.role,
      });

      // Return user without password
      const { password: _, ...userWithoutPassword } = newUser;

      return {
        success: true,
        data: {
          user: { ...userWithoutPassword, _id: result.insertedId },
          token,
        },
        message: "User registered successfully",
      };
    } catch (error) {
      console.error("User creation error:", error);
      return {
        success: false,
        error: "Failed to create user",
      };
    }
  }

  // Update user role with audit trail
  public async updateUserRole(
    userId: string,
    newRole: UserRole,
    adminId: string,
    reason?: string
  ): Promise<ApiResponse<void>> {
    try {
      // Verify admin permissions
      const admin = await this.userCollection.findOne({
        _id: new ObjectId(adminId),
      });
      if (!admin || admin.role !== UserRole.ADMIN) {
        return {
          success: false,
          error: "Only admins can change user roles",
        };
      }

      // Get current user
      const user = await this.userCollection.findOne({
        _id: new ObjectId(userId),
      });
      if (!user) {
        return {
          success: false,
          error: "User not found",
        };
      }

      // Prevent admin from demoting themselves
      if (adminId === userId && newRole !== UserRole.ADMIN) {
        return {
          success: false,
          error: "You cannot change your own admin role",
        };
      }

      const oldRole = user.role;

      // Update user role
      await this.userCollection.updateOne(
        { _id: new ObjectId(userId) },
        {
          $set: {
            role: newRole,
            updatedAt: new Date(),
          },
        }
      );

      // Log role change activity
      await this.logActivity(userId, "role_changed", {
        oldRole,
        newRole,
        changedBy: adminId,
        changedByEmail: admin.email,
        reason: reason || "No reason provided",
      });

      // Log admin activity
      await this.logActivity(adminId, "role_change_performed", {
        targetUserId: userId,
        targetUserEmail: user.email,
        oldRole,
        newRole,
        reason: reason || "No reason provided",
      });

      return {
        success: true,
        message: `User role updated to ${newRole} successfully`,
      };
    } catch (error) {
      console.error("Role update error:", error);
      return {
        success: false,
        error: "Failed to update user role",
      };
    }
  }

  // Get enhanced user profile
  public async getUserProfile(
    userId: string
  ): Promise<ApiResponse<UserProfile>> {
    try {
      const user = await this.userCollection.findOne(
        { _id: new ObjectId(userId) },
        { projection: { password: 0 } }
      );

      if (!user) {
        return {
          success: false,
          error: "User not found",
        };
      }

      // Calculate donation summary
      const donationSummary = {
        totalDonations: user.donationHistory.length,
        lastDonationDate: user.lastDonationDate,
        nextEligibleDate: user.lastDonationDate
          ? new Date(user.lastDonationDate.getTime() + 90 * 24 * 60 * 60 * 1000) // 90 days later
          : undefined,
        impactScore: this.calculateImpactScore(user.donationHistory),
      };

      // Calculate activity metrics
      const activityMetrics = await this.calculateActivityMetrics(userId);

      const userProfile: UserProfile = {
        ...user,
        donationSummary,
        activityMetrics,
      };

      return {
        success: true,
        data: userProfile,
      };
    } catch (error) {
      console.error("Get profile error:", error);
      return {
        success: false,
        error: "Failed to get user profile",
      };
    }
  }

  // Get user activity log with pagination
  public async getUserActivityLog(
    userId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<ApiResponse<PaginatedResponse<ActivityLogEntry>>> {
    try {
      const skip = (page - 1) * limit;

      const [activities, total] = await Promise.all([
        this.activityLogCollection
          .find({ userId })
          .sort({ timestamp: -1 })
          .skip(skip)
          .limit(limit)
          .toArray(),
        this.activityLogCollection.countDocuments({ userId }),
      ]);

      return {
        success: true,
        data: {
          data: activities,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
          },
        },
      };
    } catch (error) {
      console.error("Get activity log error:", error);
      return {
        success: false,
        error: "Failed to get activity log",
      };
    }
  }

  // Get user donation history
  public async getDonationHistory(
    userId: string
  ): Promise<ApiResponse<DonationRecord[]>> {
    try {
      const user = await this.userCollection.findOne(
        { _id: new ObjectId(userId) },
        { projection: { donationHistory: 1 } }
      );

      if (!user) {
        return {
          success: false,
          error: "User not found",
        };
      }

      return {
        success: true,
        data: user.donationHistory || [],
      };
    } catch (error) {
      console.error("Get donation history error:", error);
      return {
        success: false,
        error: "Failed to get donation history",
      };
    }
  }

  // Update user status
  public async updateUserStatus(
    userId: string,
    status: UserStatus,
    adminId: string,
    reason?: string
  ): Promise<ApiResponse<void>> {
    try {
      // Verify admin permissions
      const admin = await this.userCollection.findOne({
        _id: new ObjectId(adminId),
      });
      if (!admin || admin.role !== UserRole.ADMIN) {
        return {
          success: false,
          error: "Only admins can change user status",
        };
      }

      // Get current user
      const user = await this.userCollection.findOne({
        _id: new ObjectId(userId),
      });
      if (!user) {
        return {
          success: false,
          error: "User not found",
        };
      }

      // Prevent admin from blocking themselves
      if (adminId === userId && status === UserStatus.BLOCKED) {
        return {
          success: false,
          error: "You cannot block yourself",
        };
      }

      const oldStatus = user.status;

      // Update user status
      await this.userCollection.updateOne(
        { _id: new ObjectId(userId) },
        {
          $set: {
            status,
            updatedAt: new Date(),
          },
        }
      );

      // Log status change activity
      await this.logActivity(userId, "status_changed", {
        oldStatus,
        newStatus: status,
        changedBy: adminId,
        changedByEmail: admin.email,
        reason: reason || "No reason provided",
      });

      return {
        success: true,
        message: `User status updated to ${status} successfully`,
      };
    } catch (error) {
      console.error("Status update error:", error);
      return {
        success: false,
        error: "Failed to update user status",
      };
    }
  }

  // Bulk user operations
  public async bulkUserOperations(
    operations: BulkOperation[]
  ): Promise<ApiResponse<BulkResult[]>> {
    try {
      const results: BulkResult[] = [];

      for (const operation of operations) {
        const result: BulkResult = {
          successful: 0,
          failed: 0,
          errors: [],
        };

        for (const userId of operation.userIds) {
          try {
            if (operation.type === "role_change") {
              const response = await this.updateUserRole(
                userId,
                operation.newValue as UserRole,
                "admin", // This should be passed from the calling context
                operation.reason
              );

              if (response.success) {
                result.successful++;
              } else {
                result.failed++;
                result.errors.push({
                  userId,
                  error: response.error || "Unknown error",
                });
              }
            } else if (operation.type === "status_change") {
              const response = await this.updateUserStatus(
                userId,
                operation.newValue as UserStatus,
                "admin", // This should be passed from the calling context
                operation.reason
              );

              if (response.success) {
                result.successful++;
              } else {
                result.failed++;
                result.errors.push({
                  userId,
                  error: response.error || "Unknown error",
                });
              }
            }
          } catch (error) {
            result.failed++;
            result.errors.push({ userId, error: "Operation failed" });
          }
        }

        results.push(result);
      }

      return {
        success: true,
        data: results,
      };
    } catch (error) {
      console.error("Bulk operations error:", error);
      return {
        success: false,
        error: "Failed to perform bulk operations",
      };
    }
  }

  // Log user activity
  public async logActivity(
    userId: string,
    action: string,
    details: Record<string, any>,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    try {
      const activityLog: ActivityLogEntry = {
        id: new ObjectId().toString(),
        userId,
        action,
        timestamp: new Date(),
        details,
        ipAddress: ipAddress || "unknown",
        userAgent: userAgent || "unknown",
      };

      await this.activityLogCollection.insertOne(activityLog);

      // Also add to user's activity log array (for quick access)
      await this.userCollection.updateOne(
        { _id: new ObjectId(userId) },
        {
          $push: {
            activityLog: {
              $each: [activityLog],
              $slice: -100, // Keep only last 100 activities in user document
            },
          },
          $set: { updatedAt: new Date() },
        }
      );
    } catch (error) {
      console.error("Activity logging error:", error);
    }
  }

  // Add donation record to user history
  public async addDonationRecord(
    userId: string,
    donationRecord: DonationRecord
  ): Promise<void> {
    try {
      await this.userCollection.updateOne(
        { _id: new ObjectId(userId) },
        {
          $push: { donationHistory: donationRecord },
          $set: {
            lastDonationDate: donationRecord.donatedAt,
            updatedAt: new Date(),
          },
        }
      );

      // Log donation activity
      await this.logActivity(userId, "donation_completed", {
        requestId: donationRecord.requestId.toString(),
        recipientName: donationRecord.recipientName,
        hospitalName: donationRecord.hospitalName,
        bloodGroup: donationRecord.bloodGroup,
      });
    } catch (error) {
      console.error("Add donation record error:", error);
    }
  }

  // Private helper methods
  private generateToken(payload: Omit<JWTPayload, "iat" | "exp">): string {
    const JWT_SECRET =
      process.env.JWT_SECRET ||
      "your-super-secret-jwt-key-change-in-production";
    return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
  }

  private calculateImpactScore(donationHistory: DonationRecord[]): number {
    // Simple impact score calculation
    let score = 0;

    donationHistory.forEach((donation) => {
      if (donation.status === "completed") {
        score += 10; // Base score for completed donation

        // Bonus for recent donations
        const daysSinceDonation = Math.floor(
          (Date.now() - donation.donatedAt.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysSinceDonation <= 30) score += 5; // Recent donation bonus
        if (donation.verificationStatus === "verified") score += 3; // Verification bonus
      }
    });

    return score;
  }

  private async calculateActivityMetrics(
    userId: string
  ): Promise<UserProfile["activityMetrics"]> {
    try {
      const loginActivities = await this.activityLogCollection
        .find({ userId, action: "user_login" })
        .toArray();

      const requestActivities = await this.activityLogCollection
        .find({ userId, action: "request_created" })
        .toArray();

      const donationActivities = await this.activityLogCollection
        .find({ userId, action: "donation_completed" })
        .toArray();

      const lastLogin =
        loginActivities.length > 0
          ? loginActivities[loginActivities.length - 1].timestamp
          : undefined;

      return {
        loginCount: loginActivities.length,
        lastLoginAt: lastLogin,
        requestsCreated: requestActivities.length,
        donationsCompleted: donationActivities.length,
        responseRate: this.calculateResponseRate(userId), // This would need more complex logic
      };
    } catch (error) {
      console.error("Calculate activity metrics error:", error);
      return {
        loginCount: 0,
        requestsCreated: 0,
        donationsCompleted: 0,
        responseRate: 0,
      };
    }
  }

  private calculateResponseRate(userId: string): number {
    // Placeholder for response rate calculation
    // This would require tracking notification responses
    return 0.85; // 85% default response rate
  }
}

export default UserService;
