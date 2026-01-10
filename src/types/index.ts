import { ObjectId } from "mongodb";

// User Types
export interface User {
  _id?: ObjectId;
  name: string;
  email: string;
  password: string;
  bloodGroup: BloodGroup;
  dateOfBirth?: Date;
  gender?: Gender;
  phone?: string;
  location: {
    address: string;
    district: string;
    upazila: string;
    coordinates: [number, number]; // [longitude, latitude]
  };
  role: UserRole;
  status: UserStatus;
  profileImage?: string;
  donationHistory: DonationRecord[];
  activityLog: ActivityLogEntry[];
  notificationPreferences: NotificationPreferences;
  lastLoginAt?: Date;
  lastDonationDate?: Date;
  eligibilityStatus: EligibilityStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface DonationRecord {
  requestId: ObjectId;
  donatedAt: Date;
  recipientName: string;
  hospitalName: string;
  bloodGroup: BloodGroup;
  status: DonationStatus;
  feedback?: string;
  verificationStatus: VerificationStatus;
}

export interface ActivityLogEntry {
  id: string;
  userId: string;
  action: string;
  timestamp: Date;
  details: Record<string, any>;
  ipAddress: string;
  userAgent: string;
}

// Blood Request Types
export interface BloodRequest {
  _id?: ObjectId;
  recipientName: string;
  bloodGroup: BloodGroup;
  unitsNeeded: number;
  urgencyLevel: UrgencyLevel;
  location: {
    hospitalName: string;
    address: string;
    district: string;
    upazila: string;
    coordinates: [number, number];
  };
  contactInfo: {
    phone: string;
    email: string;
    emergencyContact?: string;
  };
  requesterId: ObjectId;
  requesterName: string;
  requesterEmail: string;
  status: RequestStatus;
  matchedDonors: DonorMatch[];
  statusHistory: StatusChange[];
  requiredBy: Date;
  notes: string;
  medicalInfo?: {
    condition: string;
    doctorName: string;
    hospitalId?: string;
  };
  createdAt: Date;
  updatedAt: Date;
  archivedAt?: Date;
}

export interface DonorMatch {
  donorId: string;
  donorName: string;
  bloodGroup: BloodGroup;
  distance: number;
  lastDonationDate?: Date;
  responseHistory: ResponseMetrics;
  matchScore: number;
  contactInfo: ContactInfo;
  availability: AvailabilityStatus;
}

// Notification Types
export interface NotificationDocument {
  _id?: ObjectId;
  userId: ObjectId;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, any>;
  priority: Priority;
  channels: NotificationChannel[];
  status: NotificationStatus;
  readAt?: Date;
  actionUrl?: string;
  expiresAt?: Date;
  createdAt: Date;
}

// Analytics Types
export interface AnalyticsSnapshot {
  _id?: ObjectId;
  date: Date;
  type: AnalyticsType;
  data: {
    totalUsers: number;
    activeUsers: number;
    newRegistrations: number;
    totalRequests: number;
    completedDonations: number;
    averageResponseTime: number;
    bloodGroupDistribution: Record<BloodGroup, number>;
    geographicDistribution: Record<string, number>;
    userRoleDistribution: Record<UserRole, number>;
  };
  generatedAt: Date;
}

// Content Types
export interface Content {
  _id?: ObjectId;
  title: string;
  body: string;
  type: ContentType;
  status: ContentStatus;
  authorId: ObjectId;
  publisherId?: ObjectId;
  createdAt: Date;
  publishedAt?: Date;
  scheduledFor?: Date;
  expiresAt?: Date;
  tags: string[];
  targetAudience: UserRole[];
  priority: Priority;
  versions: ContentVersion[];
}

export interface ContentVersion {
  version: number;
  title: string;
  body: string;
  authorId: ObjectId;
  createdAt: Date;
  changes: string;
}

// Enums
export enum BloodGroup {
  A_POSITIVE = "A+",
  A_NEGATIVE = "A-",
  B_POSITIVE = "B+",
  B_NEGATIVE = "B-",
  AB_POSITIVE = "AB+",
  AB_NEGATIVE = "AB-",
  O_POSITIVE = "O+",
  O_NEGATIVE = "O-",
}

export enum UserRole {
  DONOR = "donor",
  VOLUNTEER = "volunteer",
  ADMIN = "admin",
}

export enum UserStatus {
  ACTIVE = "active",
  BLOCKED = "blocked",
  PENDING = "pending",
}

export enum Gender {
  MALE = "male",
  FEMALE = "female",
  OTHER = "other",
}

export enum RequestStatus {
  PENDING = "pending",
  MATCHED = "matched",
  CONFIRMED = "confirmed",
  INPROGRESS = "inprogress",
  COMPLETED = "completed",
  VERIFIED = "verified",
  CANCELLED = "cancelled",
}

export enum UrgencyLevel {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}

export enum DonationStatus {
  SCHEDULED = "scheduled",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
  NO_SHOW = "no_show",
}

export enum VerificationStatus {
  PENDING = "pending",
  VERIFIED = "verified",
  REJECTED = "rejected",
}

export enum EligibilityStatus {
  ELIGIBLE = "eligible",
  INELIGIBLE = "ineligible",
  PENDING_REVIEW = "pending_review",
}

export enum NotificationType {
  WELCOME = "welcome",
  URGENT_REQUEST = "urgent_request",
  DONATION_CONFIRMED = "donation_confirmed",
  STATUS_UPDATE = "status_update",
  ELIGIBILITY_REMINDER = "eligibility_reminder",
  SYSTEM_ANNOUNCEMENT = "system_announcement",
}

export enum Priority {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}

export enum NotificationChannel {
  IN_APP = "in_app",
  EMAIL = "email",
  SMS = "sms",
  PUSH = "push",
}

export enum NotificationStatus {
  PENDING = "pending",
  SENT = "sent",
  DELIVERED = "delivered",
  READ = "read",
  FAILED = "failed",
}

export enum AnalyticsType {
  DAILY = "daily",
  WEEKLY = "weekly",
  MONTHLY = "monthly",
}

export enum ContentType {
  ANNOUNCEMENT = "announcement",
  EDUCATIONAL = "educational",
  EMERGENCY_ALERT = "emergency_alert",
  SYSTEM_UPDATE = "system_update",
}

export enum ContentStatus {
  DRAFT = "draft",
  PENDING_APPROVAL = "pending_approval",
  APPROVED = "approved",
  PUBLISHED = "published",
  ARCHIVED = "archived",
}

// Additional interfaces
export interface NotificationPreferences {
  email: boolean;
  sms: boolean;
  push: boolean;
  urgentOnly: boolean;
  categories: NotificationType[];
}

export interface ResponseMetrics {
  totalRequests: number;
  responseRate: number;
  averageResponseTime: number;
  completionRate: number;
}

export interface ContactInfo {
  phone: string;
  email: string;
  preferredMethod: "phone" | "email";
}

export interface AvailabilityStatus {
  isAvailable: boolean;
  nextAvailableDate?: Date;
  restrictions?: string[];
}

export interface StatusChange {
  from: RequestStatus;
  to: RequestStatus;
  timestamp: Date;
  changedBy: ObjectId;
  reason?: string;
}

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

// JWT Payload
export interface JWTPayload {
  userId: string;
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}
