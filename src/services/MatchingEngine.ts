import { ObjectId, Collection } from "mongodb";
import { getDistance } from "geolib";
import DatabaseManager from "../config/database";
import NotificationService from "./NotificationService";
import {
  User,
  BloodRequest,
  DonorMatch,
  BloodGroup,
  UserRole,
  UserStatus,
  UrgencyLevel,
  RequestStatus,
} from "../types";

interface MatchingCriteria {
  bloodGroup: BloodGroup;
  location: {
    coordinates: [number, number];
    maxDistance?: number; // in kilometers
  };
  urgencyLevel: UrgencyLevel;
  excludeUserIds?: string[];
}

interface MatchingMetrics {
  totalMatches: number;
  averageDistance: number;
  averageResponseTime: number;
  successRate: number;
  lastUpdated: Date;
}

interface BloodCompatibilityMatrix {
  [key: string]: BloodGroup[];
}

class MatchingEngine {
  private static instance: MatchingEngine;
  private userCollection: Collection<User>;
  private requestCollection: Collection<BloodRequest>;
  private notificationService: NotificationService;

  // Blood compatibility matrix - who can donate to whom
  private readonly compatibilityMatrix: BloodCompatibilityMatrix = {
    [BloodGroup.O_NEGATIVE]: [
      BloodGroup.O_NEGATIVE,
      BloodGroup.O_POSITIVE,
      BloodGroup.A_NEGATIVE,
      BloodGroup.A_POSITIVE,
      BloodGroup.B_NEGATIVE,
      BloodGroup.B_POSITIVE,
      BloodGroup.AB_NEGATIVE,
      BloodGroup.AB_POSITIVE,
    ],
    [BloodGroup.O_POSITIVE]: [
      BloodGroup.O_POSITIVE,
      BloodGroup.A_POSITIVE,
      BloodGroup.B_POSITIVE,
      BloodGroup.AB_POSITIVE,
    ],
    [BloodGroup.A_NEGATIVE]: [
      BloodGroup.A_NEGATIVE,
      BloodGroup.A_POSITIVE,
      BloodGroup.AB_NEGATIVE,
      BloodGroup.AB_POSITIVE,
    ],
    [BloodGroup.A_POSITIVE]: [BloodGroup.A_POSITIVE, BloodGroup.AB_POSITIVE],
    [BloodGroup.B_NEGATIVE]: [
      BloodGroup.B_NEGATIVE,
      BloodGroup.B_POSITIVE,
      BloodGroup.AB_NEGATIVE,
      BloodGroup.AB_POSITIVE,
    ],
    [BloodGroup.B_POSITIVE]: [BloodGroup.B_POSITIVE, BloodGroup.AB_POSITIVE],
    [BloodGroup.AB_NEGATIVE]: [BloodGroup.AB_NEGATIVE, BloodGroup.AB_POSITIVE],
    [BloodGroup.AB_POSITIVE]: [BloodGroup.AB_POSITIVE],
  };

  private constructor() {
    const db = DatabaseManager.getInstance().getDatabase();
    this.userCollection = db.collection<User>("user");
    this.requestCollection = db.collection<BloodRequest>("request");
    this.notificationService = NotificationService.getInstance();
  }

  public static getInstance(): MatchingEngine {
    if (!MatchingEngine.instance) {
      MatchingEngine.instance = new MatchingEngine();
    }
    return MatchingEngine.instance;
  }

  // Find optimal donors for a blood request
  public async findOptimalDonors(request: BloodRequest): Promise<DonorMatch[]> {
    try {
      const criteria: MatchingCriteria = {
        bloodGroup: request.bloodGroup,
        location: {
          coordinates: request.location.coordinates,
          maxDistance: this.getMaxDistanceByUrgency(request.urgencyLevel),
        },
        urgencyLevel: request.urgencyLevel,
        excludeUserIds: [request.requesterId.toString()],
      };

      // Find compatible donors
      const compatibleDonors = await this.findCompatibleDonors(criteria);

      // Calculate match scores and rank donors
      const donorMatches: DonorMatch[] = [];

      for (const donor of compatibleDonors) {
        const matchScore = await this.calculateMatchScore(donor, request);
        const distance = this.calculateDistance(
          request.location.coordinates,
          donor.location.coordinates
        );

        const donorMatch: DonorMatch = {
          donorId: donor._id!.toString(),
          donorName: donor.name,
          bloodGroup: donor.bloodGroup,
          distance,
          lastDonationDate: donor.lastDonationDate,
          responseHistory: await this.getResponseHistory(donor._id!.toString()),
          matchScore,
          contactInfo: {
            phone: donor.phone || "",
            email: donor.email,
            preferredMethod: donor.phone ? "phone" : "email",
          },
          availability: await this.checkAvailability(donor),
        };

        donorMatches.push(donorMatch);
      }

      // Sort by match score (highest first)
      donorMatches.sort((a, b) => b.matchScore - a.matchScore);

      // Limit results based on urgency
      const maxResults = this.getMaxResultsByUrgency(request.urgencyLevel);
      return donorMatches.slice(0, maxResults);
    } catch (error) {
      console.error("Find optimal donors error:", error);
      return [];
    }
  }

  // Calculate match score for a donor-request pair
  public async calculateMatchScore(
    donor: User,
    request: BloodRequest
  ): Promise<number> {
    let score = 0;

    // Base compatibility score (0-100)
    if (this.isBloodCompatible(donor.bloodGroup, request.bloodGroup)) {
      score += 100;

      // Exact match bonus
      if (donor.bloodGroup === request.bloodGroup) {
        score += 20;
      }
    } else {
      return 0; // Not compatible
    }

    // Distance score (0-50) - closer is better
    const distance = this.calculateDistance(
      request.location.coordinates,
      donor.location.coordinates
    );
    const maxDistance = this.getMaxDistanceByUrgency(request.urgencyLevel);
    const distanceScore = Math.max(0, 50 - (distance / maxDistance) * 50);
    score += distanceScore;

    // Availability score (0-30)
    const availability = await this.checkAvailability(donor);
    if (availability.isAvailable) {
      score += 30;
    } else if (availability.nextAvailableDate) {
      const daysUntilAvailable = Math.floor(
        (availability.nextAvailableDate.getTime() - Date.now()) /
          (1000 * 60 * 60 * 24)
      );
      score += Math.max(0, 30 - daysUntilAvailable);
    }

    // Response history score (0-20)
    const responseHistory = await this.getResponseHistory(
      donor._id!.toString()
    );
    score += responseHistory.responseRate * 20;

    // Recent donation penalty (encourage regular donors but not too frequent)
    if (donor.lastDonationDate) {
      const daysSinceLastDonation = Math.floor(
        (Date.now() - donor.lastDonationDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysSinceLastDonation < 90) {
        score -= 50; // Too recent, not eligible
      } else if (daysSinceLastDonation > 365) {
        score -= 10; // Long time since last donation
      }
    }

    // Urgency multiplier
    const urgencyMultiplier = this.getUrgencyMultiplier(request.urgencyLevel);
    score *= urgencyMultiplier;

    return Math.max(0, Math.min(300, score)); // Cap between 0-300
  }

  // Find compatible donors based on criteria
  private async findCompatibleDonors(
    criteria: MatchingCriteria
  ): Promise<User[]> {
    // Get compatible blood groups
    const compatibleBloodGroups = this.getCompatibleBloodGroups(
      criteria.bloodGroup
    );

    // Build query
    const query: any = {
      role: { $in: [UserRole.DONOR, UserRole.VOLUNTEER] },
      status: UserStatus.ACTIVE,
      bloodGroup: { $in: compatibleBloodGroups },
    };

    // Exclude specific users
    if (criteria.excludeUserIds && criteria.excludeUserIds.length > 0) {
      query._id = {
        $nin: criteria.excludeUserIds.map((id) => new ObjectId(id)),
      };
    }

    // Geospatial query for location
    if (criteria.location.maxDistance) {
      query["location.coordinates"] = {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: criteria.location.coordinates,
          },
          $maxDistance: criteria.location.maxDistance * 1000, // Convert km to meters
        },
      };
    }

    // Find eligible donors
    const donors = await this.userCollection
      .find(query)
      .limit(100) // Limit to prevent performance issues
      .toArray();

    // Filter by donation eligibility (90 days minimum gap)
    const eligibleDonors = donors.filter((donor) => {
      if (!donor.lastDonationDate) return true;

      const daysSinceLastDonation = Math.floor(
        (Date.now() - donor.lastDonationDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      return daysSinceLastDonation >= 90;
    });

    return eligibleDonors;
  }

  // Check if blood groups are compatible
  private isBloodCompatible(
    donorBloodGroup: BloodGroup,
    recipientBloodGroup: BloodGroup
  ): boolean {
    const compatibleRecipients =
      this.compatibilityMatrix[donorBloodGroup] || [];
    return compatibleRecipients.includes(recipientBloodGroup);
  }

  // Get compatible blood groups for a recipient
  private getCompatibleBloodGroups(
    recipientBloodGroup: BloodGroup
  ): BloodGroup[] {
    const compatibleDonors: BloodGroup[] = [];

    for (const [donorGroup, recipients] of Object.entries(
      this.compatibilityMatrix
    )) {
      if (recipients.includes(recipientBloodGroup)) {
        compatibleDonors.push(donorGroup as BloodGroup);
      }
    }

    return compatibleDonors;
  }

  // Calculate distance between two coordinates
  private calculateDistance(
    coord1: [number, number],
    coord2: [number, number]
  ): number {
    return (
      getDistance(
        { latitude: coord1[1], longitude: coord1[0] },
        { latitude: coord2[1], longitude: coord2[0] }
      ) / 1000
    ); // Convert to kilometers
  }

  // Get maximum search distance based on urgency
  private getMaxDistanceByUrgency(urgency: UrgencyLevel): number {
    const distances = {
      [UrgencyLevel.CRITICAL]: 100, // 100km
      [UrgencyLevel.HIGH]: 50, // 50km
      [UrgencyLevel.MEDIUM]: 25, // 25km
      [UrgencyLevel.LOW]: 15, // 15km
    };

    return distances[urgency] || 25;
  }

  // Get maximum results based on urgency
  private getMaxResultsByUrgency(urgency: UrgencyLevel): number {
    const maxResults = {
      [UrgencyLevel.CRITICAL]: 20,
      [UrgencyLevel.HIGH]: 15,
      [UrgencyLevel.MEDIUM]: 10,
      [UrgencyLevel.LOW]: 5,
    };

    return maxResults[urgency] || 10;
  }

  // Get urgency multiplier for scoring
  private getUrgencyMultiplier(urgency: UrgencyLevel): number {
    const multipliers = {
      [UrgencyLevel.CRITICAL]: 1.5,
      [UrgencyLevel.HIGH]: 1.3,
      [UrgencyLevel.MEDIUM]: 1.1,
      [UrgencyLevel.LOW]: 1.0,
    };

    return multipliers[urgency] || 1.0;
  }

  // Check donor availability
  private async checkAvailability(
    donor: User
  ): Promise<DonorMatch["availability"]> {
    // Check if donor is eligible to donate (90 days since last donation)
    if (donor.lastDonationDate) {
      const daysSinceLastDonation = Math.floor(
        (Date.now() - donor.lastDonationDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysSinceLastDonation < 90) {
        const nextAvailableDate = new Date(
          donor.lastDonationDate.getTime() + 90 * 24 * 60 * 60 * 1000
        );
        return {
          isAvailable: false,
          nextAvailableDate,
          restrictions: ["Must wait 90 days between donations"],
        };
      }
    }

    // Check for any active restrictions (this could be expanded)
    const restrictions: string[] = [];

    // Age restrictions (18-65)
    if (donor.dateOfBirth) {
      const age = Math.floor(
        (Date.now() - donor.dateOfBirth.getTime()) / (1000 * 60 * 60 * 24 * 365)
      );
      if (age < 18 || age > 65) {
        restrictions.push("Age must be between 18-65 years");
      }
    }

    return {
      isAvailable: restrictions.length === 0,
      restrictions: restrictions.length > 0 ? restrictions : undefined,
    };
  }

  // Get response history for a donor
  private async getResponseHistory(
    donorId: string
  ): Promise<DonorMatch["responseHistory"]> {
    try {
      const db = DatabaseManager.getInstance().getDatabase();
      const activityLogCollection = db.collection("activityLog");

      // Get notification response activities
      const responses = await activityLogCollection
        .find({
          userId: donorId,
          action: {
            $in: [
              "notification_responded",
              "donation_confirmed",
              "donation_declined",
            ],
          },
        })
        .toArray();

      const notifications = await activityLogCollection
        .find({
          userId: donorId,
          action: "notification_received",
        })
        .toArray();

      const totalRequests = notifications.length || 1; // Avoid division by zero
      const totalResponses = responses.length;
      const confirmedDonations = responses.filter(
        (r) => r.action === "donation_confirmed"
      ).length;

      // Calculate average response time
      const responseTimes = responses
        .filter((r) => r.details.responseTime)
        .map((r) => r.details.responseTime);

      const averageResponseTime =
        responseTimes.length > 0
          ? responseTimes.reduce((sum, time) => sum + time, 0) /
            responseTimes.length
          : 0;

      return {
        totalRequests,
        responseRate: totalResponses / totalRequests,
        averageResponseTime: averageResponseTime / (1000 * 60), // Convert to minutes
        completionRate: confirmedDonations / totalRequests,
      };
    } catch (error) {
      console.error("Get response history error:", error);
      return {
        totalRequests: 0,
        responseRate: 0.5, // Default 50% response rate
        averageResponseTime: 30, // Default 30 minutes
        completionRate: 0.3, // Default 30% completion rate
      };
    }
  }

  // Send notifications to matched donors
  public async notifyMatchedDonors(
    request: BloodRequest,
    matches: DonorMatch[]
  ): Promise<void> {
    try {
      const donorIds = matches.map((match) => match.donorId);

      if (request.urgencyLevel === UrgencyLevel.CRITICAL) {
        // Send urgent alert for critical requests
        await this.notificationService.sendUrgentAlert(
          request._id!.toString(),
          donorIds
        );
      } else {
        // Send regular notifications
        await this.notificationService.sendBulkNotifications({
          userIds: donorIds,
          type: "urgent_request",
          title: `Blood Donation Request - ${request.bloodGroup}`,
          message: `A ${request.urgencyLevel} blood request needs your help in ${request.location.district}.`,
          data: {
            requestId: request._id!.toString(),
            bloodGroup: request.bloodGroup,
            urgencyLevel: request.urgencyLevel,
            location: request.location,
            distance: matches.find((m) => m.donorId === donorIds[0])?.distance,
          },
          priority:
            request.urgencyLevel === UrgencyLevel.HIGH ? "high" : "medium",
          actionUrl: `/donation-request/${request._id}`,
        });
      }

      console.log(
        `✅ Notified ${donorIds.length} donors for request ${request._id}`
      );
    } catch (error) {
      console.error("Notify matched donors error:", error);
    }
  }

  // Update matching algorithm based on feedback
  public async updateMatchingAlgorithm(feedback: any): Promise<void> {
    // This would implement machine learning feedback to improve matching
    // For now, just log the feedback
    console.log("Matching feedback received:", feedback);
  }

  // Get matching metrics
  public async getMatchingMetrics(): Promise<MatchingMetrics> {
    try {
      const db = DatabaseManager.getInstance().getDatabase();

      // Get recent matching statistics
      const recentMatches = await db
        .collection("request")
        .find({
          createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // Last 30 days
          matchedDonors: { $exists: true, $ne: [] },
        })
        .toArray();

      const totalMatches = recentMatches.reduce(
        (sum, req) => sum + req.matchedDonors.length,
        0
      );

      const averageDistance =
        recentMatches.length > 0
          ? recentMatches.reduce((sum, req) => {
              const avgDist =
                req.matchedDonors.reduce(
                  (s: number, d: any) => s + d.distance,
                  0
                ) / req.matchedDonors.length;
              return sum + avgDist;
            }, 0) / recentMatches.length
          : 0;

      // Calculate success rate (requests that got confirmed donations)
      const successfulRequests = recentMatches.filter(
        (req) =>
          req.status === RequestStatus.COMPLETED ||
          req.status === RequestStatus.VERIFIED
      ).length;

      const successRate =
        recentMatches.length > 0
          ? successfulRequests / recentMatches.length
          : 0;

      return {
        totalMatches,
        averageDistance,
        averageResponseTime: 45, // This would be calculated from actual response data
        successRate,
        lastUpdated: new Date(),
      };
    } catch (error) {
      console.error("Get matching metrics error:", error);
      return {
        totalMatches: 0,
        averageDistance: 0,
        averageResponseTime: 0,
        successRate: 0,
        lastUpdated: new Date(),
      };
    }
  }

  // Expand search radius for unfulfilled requests
  public async expandSearchRadius(
    requestId: string,
    newRadius: number
  ): Promise<DonorMatch[]> {
    try {
      const request = await this.requestCollection.findOne({
        _id: new ObjectId(requestId),
      });
      if (!request) {
        throw new Error("Request not found");
      }

      // Update the search criteria with expanded radius
      const criteria: MatchingCriteria = {
        bloodGroup: request.bloodGroup,
        location: {
          coordinates: request.location.coordinates,
          maxDistance: newRadius,
        },
        urgencyLevel: request.urgencyLevel,
        excludeUserIds: [request.requesterId.toString()],
      };

      // Find new matches with expanded radius
      const newMatches = await this.findOptimalDonors(request);

      // Update the request with new matches
      await this.requestCollection.updateOne(
        { _id: new ObjectId(requestId) },
        {
          $set: {
            matchedDonors: newMatches,
            updatedAt: new Date(),
          },
        }
      );

      // Notify the new donors
      await this.notifyMatchedDonors(request, newMatches);

      console.log(
        `✅ Expanded search radius to ${newRadius}km for request ${requestId}, found ${newMatches.length} new matches`
      );

      return newMatches;
    } catch (error) {
      console.error("Expand search radius error:", error);
      return [];
    }
  }
}

export default MatchingEngine;
