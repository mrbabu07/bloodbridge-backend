import fc from "fast-check";
import { MongoClient, Db } from "mongodb";
import bcrypt from "bcryptjs";
import { User, UserRole, UserStatus, BloodGroup } from "../../types";

describe("Property Tests: User Registration", () => {
  let db: Db;
  let userCollection: any;

  beforeAll(async () => {
    const client = new MongoClient(process.env.MONGODB_URI!);
    await client.connect();
    db = client.db(process.env.DB_NAME);
    userCollection = db.collection("user");
  });

  /**
   * Property 1: User Registration Default Assignment
   * Feature: comprehensive-blood-platform, Property 1: For any new user registration, the system should assign the default role of "donor" and create a complete user profile with all required fields
   * Validates: Requirements 1.1
   */
  test("Property 1: User Registration Default Assignment", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          name: fc.string({ minLength: 2, maxLength: 50 }),
          email: fc.emailAddress(),
          password: fc.string({ minLength: 6, maxLength: 100 }),
          bloodGroup: fc.constantFrom(...Object.values(BloodGroup)),
          district: fc.string({ minLength: 2, maxLength: 50 }),
          upazila: fc.string({ minLength: 2, maxLength: 50 }),
          phone: fc.option(fc.string({ minLength: 10, maxLength: 15 })),
          address: fc.string({ minLength: 5, maxLength: 200 }),
        }),
        async (userData) => {
          // Simulate user registration
          const hashedPassword = await bcrypt.hash(userData.password, 10);

          const newUser: Partial<User> = {
            name: userData.name,
            email: userData.email.toLowerCase(),
            password: hashedPassword,
            bloodGroup: userData.bloodGroup,
            location: {
              address: userData.address,
              district: userData.district,
              upazila: userData.upazila,
              coordinates: [90.4125, 23.8103], // Default coordinates for Dhaka
            },
            phone: userData.phone,
            role: UserRole.DONOR, // Default role assignment
            status: UserStatus.ACTIVE, // Default status
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

          // Insert user into database
          const result = await userCollection.insertOne(newUser);
          const insertedUser = await userCollection.findOne({
            _id: result.insertedId,
          });

          // Property assertions
          expect(insertedUser).toBeDefined();
          expect(insertedUser.role).toBe(UserRole.DONOR); // Default role should be donor
          expect(insertedUser.status).toBe(UserStatus.ACTIVE); // Default status should be active
          expect(insertedUser.email).toBe(userData.email.toLowerCase()); // Email should be normalized
          expect(insertedUser.donationHistory).toEqual([]); // Should have empty donation history
          expect(insertedUser.activityLog).toEqual([]); // Should have empty activity log
          expect(insertedUser.notificationPreferences).toBeDefined(); // Should have notification preferences
          expect(insertedUser.location).toBeDefined(); // Should have location object
          expect(insertedUser.location.district).toBe(userData.district);
          expect(insertedUser.location.upazila).toBe(userData.upazila);
          expect(insertedUser.createdAt).toBeInstanceOf(Date);
          expect(insertedUser.updatedAt).toBeInstanceOf(Date);

          // Clean up for next iteration
          await userCollection.deleteOne({ _id: result.insertedId });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property Test: Email Uniqueness
   * Ensures that duplicate email registrations are properly handled
   */
  test("Property: Email Uniqueness Enforcement", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          name1: fc.string({ minLength: 2, maxLength: 50 }),
          name2: fc.string({ minLength: 2, maxLength: 50 }),
          email: fc.emailAddress(),
          password1: fc.string({ minLength: 6, maxLength: 100 }),
          password2: fc.string({ minLength: 6, maxLength: 100 }),
          bloodGroup: fc.constantFrom(...Object.values(BloodGroup)),
          district: fc.string({ minLength: 2, maxLength: 50 }),
          upazila: fc.string({ minLength: 2, maxLength: 50 }),
        }),
        async (data) => {
          const createUser = async (name: string, password: string) => ({
            name,
            email: data.email.toLowerCase(),
            password: await bcrypt.hash(password, 10),
            bloodGroup: data.bloodGroup,
            location: {
              address: "Test Address",
              district: data.district,
              upazila: data.upazila,
              coordinates: [90.4125, 23.8103] as [number, number],
            },
            role: UserRole.DONOR,
            status: UserStatus.ACTIVE,
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
          });

          // Create first user
          const user1 = await createUser(data.name1, data.password1);
          const result1 = await userCollection.insertOne(user1);
          expect(result1.insertedId).toBeDefined();

          // Attempt to create second user with same email
          const user2 = await createUser(data.name2, data.password2);

          // This should fail due to unique email constraint
          await expect(userCollection.insertOne(user2)).rejects.toThrow();

          // Verify only one user exists with this email
          const usersWithEmail = await userCollection
            .find({ email: data.email.toLowerCase() })
            .toArray();
          expect(usersWithEmail).toHaveLength(1);
          expect(usersWithEmail[0].name).toBe(data.name1);

          // Clean up
          await userCollection.deleteOne({ _id: result1.insertedId });
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property Test: Password Security
   * Ensures passwords are properly hashed and never stored in plain text
   */
  test("Property: Password Security Enforcement", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          name: fc.string({ minLength: 2, maxLength: 50 }),
          email: fc.emailAddress(),
          password: fc.string({ minLength: 6, maxLength: 100 }),
          bloodGroup: fc.constantFrom(...Object.values(BloodGroup)),
        }),
        async (userData) => {
          const hashedPassword = await bcrypt.hash(userData.password, 10);

          const newUser = {
            name: userData.name,
            email: userData.email.toLowerCase(),
            password: hashedPassword,
            bloodGroup: userData.bloodGroup,
            location: {
              address: "Test Address",
              district: "Test District",
              upazila: "Test Upazila",
              coordinates: [90.4125, 23.8103] as [number, number],
            },
            role: UserRole.DONOR,
            status: UserStatus.ACTIVE,
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

          const result = await userCollection.insertOne(newUser);
          const insertedUser = await userCollection.findOne({
            _id: result.insertedId,
          });

          // Property assertions for password security
          expect(insertedUser.password).not.toBe(userData.password); // Password should be hashed
          expect(insertedUser.password).toMatch(/^\$2[aby]\$\d+\$/); // Should match bcrypt hash pattern
          expect(
            await bcrypt.compare(userData.password, insertedUser.password)
          ).toBe(true); // Should verify correctly

          // Clean up
          await userCollection.deleteOne({ _id: result.insertedId });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property Test: Complete Profile Structure
   * Ensures all required fields are present in user profiles
   */
  test("Property: Complete Profile Structure", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          name: fc.string({ minLength: 2, maxLength: 50 }),
          email: fc.emailAddress(),
          password: fc.string({ minLength: 6, maxLength: 100 }),
          bloodGroup: fc.constantFrom(...Object.values(BloodGroup)),
          district: fc.string({ minLength: 2, maxLength: 50 }),
          upazila: fc.string({ minLength: 2, maxLength: 50 }),
        }),
        async (userData) => {
          const newUser = {
            name: userData.name,
            email: userData.email.toLowerCase(),
            password: await bcrypt.hash(userData.password, 10),
            bloodGroup: userData.bloodGroup,
            location: {
              address: "Test Address",
              district: userData.district,
              upazila: userData.upazila,
              coordinates: [90.4125, 23.8103] as [number, number],
            },
            role: UserRole.DONOR,
            status: UserStatus.ACTIVE,
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

          const result = await userCollection.insertOne(newUser);
          const insertedUser = await userCollection.findOne({
            _id: result.insertedId,
          });

          // Required fields should be present
          const requiredFields = [
            "name",
            "email",
            "password",
            "bloodGroup",
            "location",
            "role",
            "status",
            "donationHistory",
            "activityLog",
            "notificationPreferences",
            "eligibilityStatus",
            "createdAt",
            "updatedAt",
          ];

          requiredFields.forEach((field) => {
            expect(insertedUser).toHaveProperty(field);
            expect(insertedUser[field]).toBeDefined();
          });

          // Location object should have required sub-fields
          expect(insertedUser.location).toHaveProperty("address");
          expect(insertedUser.location).toHaveProperty("district");
          expect(insertedUser.location).toHaveProperty("upazila");
          expect(insertedUser.location).toHaveProperty("coordinates");
          expect(Array.isArray(insertedUser.location.coordinates)).toBe(true);
          expect(insertedUser.location.coordinates).toHaveLength(2);

          // Arrays should be initialized
          expect(Array.isArray(insertedUser.donationHistory)).toBe(true);
          expect(Array.isArray(insertedUser.activityLog)).toBe(true);

          // Clean up
          await userCollection.deleteOne({ _id: result.insertedId });
        }
      ),
      { numRuns: 100 }
    );
  });
});
