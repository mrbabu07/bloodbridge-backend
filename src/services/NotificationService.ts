import { ObjectId, Collection } from "mongodb";
import DatabaseManager from "../config/database";
import SocketManager from "../config/socket";
import {
  NotificationDocument,
  NotificationType,
  Priority,
  NotificationChannel,
  NotificationStatus,
  UserRole,
} from "../types";

interface NotificationPreferences {
  email: boolean;
  sms: boolean;
  push: boolean;
  urgentOnly: boolean;
  categories: NotificationType[];
}

interface SendNotificationOptions {
  userId: ObjectId | string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, any>;
  priority?: Priority;
  channels?: NotificationChannel[];
  actionUrl?: string;
  expiresAt?: Date;
}

interface BulkNotificationOptions {
  userIds: (ObjectId | string)[];
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, any>;
  priority?: Priority;
  channels?: NotificationChannel[];
  actionUrl?: string;
  expiresAt?: Date;
}

class NotificationService {
  private static instance: NotificationService;
  private notificationCollection: Collection<NotificationDocument>;
  private socketManager: SocketManager;
  private redisClient: any;

  private constructor() {
    const db = DatabaseManager.getInstance().getDatabase();
    this.notificationCollection =
      db.collection<NotificationDocument>("notification");
    this.socketManager = SocketManager.getInstance();
    this.redisClient = DatabaseManager.getInstance().getRedisClient();
  }

  public static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  // Send notification to a single user
  public async sendNotification(
    options: SendNotificationOptions
  ): Promise<string> {
    const notification: NotificationDocument = {
      userId:
        typeof options.userId === "string"
          ? new ObjectId(options.userId)
          : options.userId,
      type: options.type,
      title: options.title,
      message: options.message,
      data: options.data,
      priority: options.priority || Priority.MEDIUM,
      channels: options.channels || [NotificationChannel.IN_APP],
      status: NotificationStatus.PENDING,
      actionUrl: options.actionUrl,
      expiresAt: options.expiresAt,
      createdAt: new Date(),
    };

    // Save to database
    const result = await this.notificationCollection.insertOne(notification);
    const notificationId = result.insertedId.toString();

    // Send real-time notification
    const userIdString =
      typeof options.userId === "string"
        ? options.userId
        : options.userId.toString();
    const success = this.socketManager.sendToUser(
      userIdString,
      "notification",
      {
        id: notificationId,
        ...notification,
      }
    );

    if (success) {
      await this.updateNotificationStatus(
        notificationId,
        NotificationStatus.SENT
      );
    }

    // Update unread count in Redis
    await this.incrementUnreadCount(userIdString);

    // Handle other notification channels (email, SMS, push)
    await this.handleAdditionalChannels(notification, notificationId);

    return notificationId;
  }

  // Send notification to multiple users
  public async sendBulkNotifications(
    options: BulkNotificationOptions
  ): Promise<string[]> {
    const notifications: NotificationDocument[] = options.userIds.map(
      (userId) => ({
        userId: typeof userId === "string" ? new ObjectId(userId) : userId,
        type: options.type,
        title: options.title,
        message: options.message,
        data: options.data,
        priority: options.priority || Priority.MEDIUM,
        channels: options.channels || [NotificationChannel.IN_APP],
        status: NotificationStatus.PENDING,
        actionUrl: options.actionUrl,
        expiresAt: options.expiresAt,
        createdAt: new Date(),
      })
    );

    // Save all notifications to database
    const result = await this.notificationCollection.insertMany(notifications);
    const notificationIds = Object.values(result.insertedIds).map((id) =>
      id.toString()
    );

    // Send real-time notifications
    const userIdStrings = options.userIds.map((id) =>
      typeof id === "string" ? id : id.toString()
    );

    notifications.forEach((notification, index) => {
      const notificationWithId = {
        id: notificationIds[index],
        ...notification,
      };

      this.socketManager.sendToUser(
        userIdStrings[index],
        "notification",
        notificationWithId
      );
      this.incrementUnreadCount(userIdStrings[index]);
    });

    // Update all notifications as sent
    await this.notificationCollection.updateMany(
      { _id: { $in: Object.values(result.insertedIds) } },
      { $set: { status: NotificationStatus.SENT } }
    );

    return notificationIds;
  }

  // Send urgent alert to compatible donors
  public async sendUrgentAlert(
    requestId: string,
    targetDonors: string[]
  ): Promise<void> {
    const urgentNotification = {
      type: NotificationType.URGENT_REQUEST,
      title: "🚨 Urgent Blood Request",
      message: "A critical blood request needs your immediate attention!",
      data: { requestId, urgent: true },
      priority: Priority.CRITICAL,
      channels: [
        NotificationChannel.IN_APP,
        NotificationChannel.PUSH,
        NotificationChannel.SMS,
      ],
      actionUrl: `/donation-request/${requestId}`,
    };

    await this.sendBulkNotifications({
      userIds: targetDonors,
      ...urgentNotification,
    });

    // Also broadcast to all online donors for maximum reach
    this.socketManager.sendToRole("donor", "urgent-alert", {
      requestId,
      message: urgentNotification.message,
      actionUrl: urgentNotification.actionUrl,
    });
  }

  // Get unread notification count for a user
  public async getUnreadCount(userId: string): Promise<number> {
    const cacheKey = `unread_count:${userId}`;

    try {
      const cachedCount = await this.redisClient.get(cacheKey);
      if (cachedCount !== null) {
        return parseInt(cachedCount, 10);
      }
    } catch (error) {
      console.error("Redis error getting unread count:", error);
    }

    // Fallback to database count
    const count = await this.notificationCollection.countDocuments({
      userId: new ObjectId(userId),
      status: { $in: [NotificationStatus.SENT, NotificationStatus.DELIVERED] },
      readAt: { $exists: false },
    });

    // Cache the result
    try {
      await this.redisClient.setex(cacheKey, 300, count.toString()); // Cache for 5 minutes
    } catch (error) {
      console.error("Redis error setting unread count:", error);
    }

    return count;
  }

  // Mark notifications as read
  public async markAsRead(
    userId: string,
    notificationIds: string[]
  ): Promise<void> {
    const objectIds = notificationIds.map((id) => new ObjectId(id));

    await this.notificationCollection.updateMany(
      {
        _id: { $in: objectIds },
        userId: new ObjectId(userId),
      },
      {
        $set: {
          readAt: new Date(),
          status: NotificationStatus.READ,
        },
      }
    );

    // Update unread count in Redis
    await this.decrementUnreadCount(userId, notificationIds.length);

    // Notify user of read status update
    this.socketManager.sendToUser(userId, "notifications-read", {
      notificationIds,
      readAt: new Date(),
    });
  }

  // Get user notifications with pagination
  public async getUserNotifications(
    userId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<{
    notifications: NotificationDocument[];
    total: number;
    unreadCount: number;
  }> {
    const skip = (page - 1) * limit;

    const [notifications, total, unreadCount] = await Promise.all([
      this.notificationCollection
        .find({ userId: new ObjectId(userId) })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      this.notificationCollection.countDocuments({
        userId: new ObjectId(userId),
      }),
      this.getUnreadCount(userId),
    ]);

    return { notifications, total, unreadCount };
  }

  // Send welcome notification to new users
  public async sendWelcomeNotification(
    userId: string,
    userName: string
  ): Promise<void> {
    await this.sendNotification({
      userId,
      type: NotificationType.WELCOME,
      title: `Welcome to BloodBridge, ${userName}! 🩸`,
      message:
        "Thank you for joining our life-saving community. Your generosity can make a real difference!",
      data: { isWelcome: true },
      priority: Priority.MEDIUM,
      channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
      actionUrl: "/dashboard",
    });
  }

  // Send donation confirmation notification
  public async sendDonationConfirmation(
    requesterId: string,
    donorName: string,
    requestId: string
  ): Promise<void> {
    await this.sendNotification({
      userId: requesterId,
      type: NotificationType.DONATION_CONFIRMED,
      title: "✅ Donor Found!",
      message: `${donorName} has confirmed to donate blood for your request.`,
      data: { requestId, donorName },
      priority: Priority.HIGH,
      channels: [
        NotificationChannel.IN_APP,
        NotificationChannel.EMAIL,
        NotificationChannel.SMS,
      ],
      actionUrl: `/donation-request/${requestId}`,
    });
  }

  // Send status update notification
  public async sendStatusUpdate(
    userId: string,
    requestId: string,
    oldStatus: string,
    newStatus: string
  ): Promise<void> {
    await this.sendNotification({
      userId,
      type: NotificationType.STATUS_UPDATE,
      title: "Request Status Updated",
      message: `Your blood request status has been updated from ${oldStatus} to ${newStatus}.`,
      data: { requestId, oldStatus, newStatus },
      priority: Priority.MEDIUM,
      channels: [NotificationChannel.IN_APP],
      actionUrl: `/donation-request/${requestId}`,
    });
  }

  // Send eligibility reminder
  public async sendEligibilityReminder(
    userId: string,
    userName: string
  ): Promise<void> {
    await this.sendNotification({
      userId,
      type: NotificationType.ELIGIBILITY_REMINDER,
      title: `${userName}, You Can Donate Again! 🩸`,
      message:
        "You are now eligible to donate blood again. Help save lives today!",
      data: { isEligibilityReminder: true },
      priority: Priority.MEDIUM,
      channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
      actionUrl: "/donation-request",
    });
  }

  // Private helper methods
  private async updateNotificationStatus(
    notificationId: string,
    status: NotificationStatus
  ): Promise<void> {
    await this.notificationCollection.updateOne(
      { _id: new ObjectId(notificationId) },
      { $set: { status } }
    );
  }

  private async incrementUnreadCount(userId: string): Promise<void> {
    const cacheKey = `unread_count:${userId}`;
    try {
      await this.redisClient.incr(cacheKey);
      await this.redisClient.expire(cacheKey, 300); // Expire in 5 minutes
    } catch (error) {
      console.error("Redis error incrementing unread count:", error);
    }
  }

  private async decrementUnreadCount(
    userId: string,
    count: number
  ): Promise<void> {
    const cacheKey = `unread_count:${userId}`;
    try {
      await this.redisClient.decrby(cacheKey, count);
      await this.redisClient.expire(cacheKey, 300); // Expire in 5 minutes
    } catch (error) {
      console.error("Redis error decrementing unread count:", error);
    }
  }

  private async handleAdditionalChannels(
    notification: NotificationDocument,
    notificationId: string
  ): Promise<void> {
    // Handle email notifications
    if (notification.channels.includes(NotificationChannel.EMAIL)) {
      // Email service integration would go here
      console.log(`📧 Email notification sent: ${notification.title}`);
    }

    // Handle SMS notifications
    if (notification.channels.includes(NotificationChannel.SMS)) {
      // SMS service integration would go here
      console.log(`📱 SMS notification sent: ${notification.title}`);
    }

    // Handle push notifications
    if (notification.channels.includes(NotificationChannel.PUSH)) {
      // Push notification service integration would go here
      console.log(`🔔 Push notification sent: ${notification.title}`);
    }
  }

  // Queue notifications for offline users
  public async queueNotificationForOfflineUser(
    userId: string,
    notification: Omit<SendNotificationOptions, "userId">
  ): Promise<void> {
    const queueKey = `offline_notifications:${userId}`;
    const notificationData = {
      ...notification,
      queuedAt: new Date().toISOString(),
    };

    try {
      await this.redisClient.lpush(queueKey, JSON.stringify(notificationData));
      await this.redisClient.expire(queueKey, 86400); // Expire in 24 hours
    } catch (error) {
      console.error("Redis error queuing notification:", error);
      // Fallback: save directly to database
      await this.sendNotification({ userId, ...notification });
    }
  }

  // Deliver queued notifications when user comes online
  public async deliverQueuedNotifications(userId: string): Promise<void> {
    const queueKey = `offline_notifications:${userId}`;

    try {
      const queuedNotifications = await this.redisClient.lrange(
        queueKey,
        0,
        -1
      );

      for (const notificationStr of queuedNotifications) {
        const notification = JSON.parse(notificationStr);
        await this.sendNotification({ userId, ...notification });
      }

      // Clear the queue
      await this.redisClient.del(queueKey);

      console.log(
        `✅ Delivered ${queuedNotifications.length} queued notifications to user ${userId}`
      );
    } catch (error) {
      console.error("Error delivering queued notifications:", error);
    }
  }
}

export default NotificationService;
