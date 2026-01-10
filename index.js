const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const port = process.env.PORT || 3000;

// Stripe Key validation (Warning only)
const stripeKey = process.env.STRIPE_KEY;
if (!stripeKey || stripeKey.includes("your_")) {
  console.warn("⚠️ WARNING: STRIPE_KEY is missing or using a placeholder.");
}
const stripe = require("stripe")(stripeKey || "sk_test_placeholder");

const app = express();

app.use(cors());
app.use(express.json());

// JWT Secret
const JWT_SECRET =
  process.env.JWT_SECRET || "your-super-secret-jwt-key-change-in-production";

// JWT Verification Middleware
const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: "Access token required" });
  }

  try {
    const tokenValue = token.startsWith("Bearer ") ? token.slice(7) : token;
    const decoded = jwt.verify(tokenValue, JWT_SECRET);
    req.user = decoded;
    req.decodedEmail = decoded.email;
    next();
  } catch (error) {
    return res.status(401).send({ message: "Invalid or expired token" });
  }
};

const uri = process.env.MONGODB_URI;

if (!uri || uri.includes("your_")) {
  console.error("❌ ERROR: MONGODB_URI is not defined or is a placeholder!");
  process.exit(1);
}

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );

    const database = client.db(process.env.DB_NAME || "bloodBridgeDB");
    const userCollection = database.collection("user");
    const requestCollection = database.collection("request");
    const paymentCollection = database.collection("payment");

    // Middleware to check if demo admin (read-only)
    const checkDemoAdmin = async (req, res, next) => {
      try {
        const user = await userCollection.findOne({ email: req.decodedEmail });
        if (user?.isDemo && user?.role === "admin") {
          return res.status(403).send({
            error:
              "Demo admin has read-only access. Create a real admin account to make changes.",
            isDemo: true,
          });
        }
        next();
      } catch (error) {
        next();
      }
    };

    // Check if admin exists (public endpoint)
    app.get("/check-admin-exists", async (req, res) => {
      try {
        const existingAdmin = await userCollection.findOne({ role: "admin" });
        res.send({ adminExists: !!existingAdmin });
      } catch (error) {
        console.error("Check admin error:", error);
        res.status(500).send({ message: "Failed to check admin status" });
      }
    });

    // Create first admin user (only if no admin exists)
    app.post("/create-first-admin", async (req, res) => {
      try {
        // Check if any admin already exists
        const existingAdmin = await userCollection.findOne({ role: "admin" });
        if (existingAdmin) {
          return res.status(400).send({
            message:
              "Admin user already exists. Cannot create another first admin.",
          });
        }

        const { name, email, password } = req.body;

        if (!name || !email || !password) {
          return res.status(400).send({
            message: "Name, email, and password are required",
          });
        }

        if (password.length < 6) {
          return res.status(400).send({
            message: "Password must be at least 6 characters long",
          });
        }

        // Check if user with this email already exists
        const existingUser = await userCollection.findOne({
          email: email.toLowerCase(),
        });
        if (existingUser) {
          return res.status(400).send({
            message: "User with this email already exists",
          });
        }

        // Hash password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Create admin user
        const adminUser = {
          name,
          email: email.toLowerCase(),
          password: hashedPassword,
          bloodGroup: "",
          district: "",
          upazila: "",
          photoURL: "",
          role: "admin",
          status: "active",
          createdAt: new Date(),
        };

        const result = await userCollection.insertOne(adminUser);

        res.status(201).send({
          success: true,
          message: "First admin user created successfully",
          adminId: result.insertedId,
        });
      } catch (error) {
        console.error("Create first admin error:", error);
        res.status(500).send({ message: "Failed to create admin user" });
      }
    });

    // Register new user
    app.post("/auth/register", async (req, res) => {
      try {
        const {
          name,
          email,
          password,
          bloodGroup,
          district,
          upazila,
          photoURL,
        } = req.body;

        // Check if user already exists
        const existingUser = await userCollection.findOne({
          email: email.toLowerCase(),
        });
        if (existingUser) {
          return res
            .status(400)
            .send({ message: "User already exists with this email" });
        }

        // Hash password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Create user
        const userInfo = {
          name,
          email: email.toLowerCase(),
          password: hashedPassword,
          bloodGroup: bloodGroup || "",
          district: district || "",
          upazila: upazila || "",
          photoURL: photoURL || "",
          role: "donor",
          status: "active",
          createdAt: new Date(),
        };

        const result = await userCollection.insertOne(userInfo);

        // Generate JWT token
        const token = jwt.sign(
          {
            userId: result.insertedId,
            email: userInfo.email,
            role: userInfo.role,
          },
          JWT_SECRET,
          { expiresIn: "7d" }
        );

        // Return user info without password
        const { password: _, ...userWithoutPassword } = userInfo;

        res.status(201).send({
          message: "User registered successfully",
          token,
          user: userWithoutPassword,
        });
      } catch (error) {
        console.error("Registration error:", error);
        res.status(500).send({ message: "Registration failed" });
      }
    });

    // Login user
    app.post("/auth/login", async (req, res) => {
      try {
        const { email, password } = req.body;

        // Find user
        const user = await userCollection.findOne({
          email: email.toLowerCase(),
        });
        if (!user) {
          return res.status(400).send({ message: "Invalid email or password" });
        }

        // Check password
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
          return res.status(400).send({ message: "Invalid email or password" });
        }

        // Check if user is active
        if (user.status !== "active") {
          return res
            .status(403)
            .send({ message: "Account is blocked. Contact administrator." });
        }

        // Generate JWT token
        const token = jwt.sign(
          {
            userId: user._id,
            email: user.email,
            role: user.role,
          },
          JWT_SECRET,
          { expiresIn: "7d" }
        );

        // Return user info without password
        const { password: _, ...userWithoutPassword } = user;

        res.send({
          message: "Login successful",
          token,
          user: userWithoutPassword,
        });
      } catch (error) {
        console.error("Login error:", error);
        res.status(500).send({ message: "Login failed" });
      }
    });

    // Get current user profile
    app.get("/auth/me", verifyToken, async (req, res) => {
      try {
        const user = await userCollection.findOne(
          { email: req.decodedEmail },
          { projection: { password: 0 } }
        );

        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send(user);
      } catch (error) {
        console.error("Get profile error:", error);
        res.status(500).send({ message: "Failed to get profile" });
      }
    });

    // Change password
    app.patch("/auth/change-password", verifyToken, async (req, res) => {
      try {
        const { currentPassword, newPassword } = req.body;

        // Find user
        const user = await userCollection.findOne({ email: req.decodedEmail });
        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }

        // Verify current password
        const isValidPassword = await bcrypt.compare(
          currentPassword,
          user.password
        );
        if (!isValidPassword) {
          return res
            .status(400)
            .send({ message: "Current password is incorrect" });
        }

        // Hash new password
        const saltRounds = 10;
        const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

        // Update password
        await userCollection.updateOne(
          { email: req.decodedEmail },
          { $set: { password: hashedNewPassword, updatedAt: new Date() } }
        );

        res.send({ message: "Password changed successfully" });
      } catch (error) {
        console.error("Change password error:", error);
        res.status(500).send({ message: "Failed to change password" });
      }
    });

    //users info
    app.post("/users", async (req, res) => {
      const userInfo = req.body;
      userInfo.email = userInfo.email?.toLowerCase();
      userInfo.createdAt = new Date();
      userInfo.role = userInfo.role || "donor";
      userInfo.status = userInfo.status || "active";

      // Hash password if provided
      if (userInfo.password) {
        const saltRounds = 10;
        userInfo.password = await bcrypt.hash(userInfo.password, saltRounds);
      }

      const result = await userCollection.insertOne(userInfo);
      res.send(result);
    });

    app.get("/users", verifyToken, async (req, res) => {
      try {
        const adminEmail = req.decodedEmail;
        const adminUser = await userCollection.findOne({ email: adminEmail });

        if (adminUser?.role !== "admin") {
          return res
            .status(403)
            .send({ error: "Only admins can view all users" });
        }

        const { role, status, page = 1, limit = 10 } = req.query;
        const query = {};

        if (role) query.role = role;
        if (status) query.status = status;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const users = await userCollection
          .find(query, { projection: { password: 0 } })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .toArray();

        const total = await userCollection.countDocuments(query);

        res.send({
          users,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / parseInt(limit)),
          },
        });
      } catch (error) {
        console.error("Get users error:", error);
        res.status(500).send({ error: "Failed to fetch users" });
      }
    });

    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email?.toLowerCase();
      const query = { email: email };
      const result = await userCollection.findOne(query, {
        projection: { password: 0 },
      });
      if (!result) {
        return res.status(404).send({ message: "User not found" });
      }
      res.send(result);
    });

    // Update profile (excluding email and password)
    app.patch("/users/profile", verifyToken, async (req, res) => {
      const email = req.decodedEmail?.toLowerCase();
      const { name, bloodGroup, district, upazila, photoURL } = req.body;

      const result = await userCollection.updateOne(
        { email },
        {
          $set: {
            name,
            bloodGroup,
            district,
            upazila,
            photoURL,
            updatedAt: new Date(),
          },
        }
      );

      if (result.matchedCount === 0) {
        return res.status(404).send({ error: "User not found" });
      }

      res.send({ success: true });
    });

    // PATCH route: admin can change any user's role
    app.patch("/users/role", verifyToken, checkDemoAdmin, async (req, res) => {
      const adminEmail = req.decodedEmail;
      const { email, newRole } = req.body;

      try {
        // Check if the requester is an admin
        const adminUser = await userCollection.findOne({ email: adminEmail });
        if (adminUser?.role !== "admin") {
          return res
            .status(403)
            .send({ error: "Only admins can change roles" });
        }

        // Validate the new role
        if (!["donor", "volunteer", "admin"].includes(newRole)) {
          return res.status(400).send({
            error: "Invalid role. Must be donor, volunteer, or admin",
          });
        }

        // Check if target user exists
        const targetUser = await userCollection.findOne({
          email: email.toLowerCase(),
        });
        if (!targetUser) {
          return res.status(404).send({ error: "User not found" });
        }

        // Prevent admin from demoting themselves
        if (
          adminEmail.toLowerCase() === email.toLowerCase() &&
          newRole !== "admin"
        ) {
          return res
            .status(400)
            .send({ error: "You cannot change your own admin role" });
        }

        // Update the user's role
        const result = await userCollection.updateOne(
          { email: email.toLowerCase() },
          {
            $set: {
              role: newRole,
              updatedAt: new Date(),
            },
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ error: "User not found" });
        }

        res.send({
          success: true,
          message: `User role updated to ${newRole} successfully`,
          updatedUser: {
            email: email.toLowerCase(),
            role: newRole,
          },
        });
      } catch (error) {
        console.error("Role update error:", error);
        res.status(500).send({ error: "Failed to update user role" });
      }
    });

    // Update user status (admin only)
    app.patch(
      "/update/user/status",
      verifyToken,
      checkDemoAdmin,
      async (req, res) => {
        try {
          const adminEmail = req.decodedEmail;
          const { email, status } = req.query;

          // Check if the requester is an admin
          const adminUser = await userCollection.findOne({ email: adminEmail });
          if (adminUser?.role !== "admin") {
            return res
              .status(403)
              .send({ error: "Only admins can change user status" });
          }

          // Validate status
          if (!["active", "blocked"].includes(status)) {
            return res
              .status(400)
              .send({ error: "Invalid status. Must be active or blocked" });
          }

          // Prevent admin from blocking themselves
          if (
            adminEmail.toLowerCase() === email.toLowerCase() &&
            status === "blocked"
          ) {
            return res.status(400).send({ error: "You cannot block yourself" });
          }

          const result = await userCollection.updateOne(
            { email: email.toLowerCase() },
            {
              $set: {
                status: status,
                updatedAt: new Date(),
              },
            }
          );

          if (result.matchedCount === 0) {
            return res.status(404).send({ error: "User not found" });
          }

          res.send({
            success: true,
            message: `User status updated to ${status} successfully`,
            modifiedCount: result.modifiedCount,
          });
        } catch (error) {
          console.error("Status update error:", error);
          res.status(500).send({ error: "Failed to update user status" });
        }
      }
    );

    // Get user statistics by role (admin only)
    app.get("/users/stats", verifyToken, async (req, res) => {
      try {
        const adminEmail = req.decodedEmail;
        const adminUser = await userCollection.findOne({ email: adminEmail });

        if (adminUser?.role !== "admin") {
          return res
            .status(403)
            .send({ error: "Only admins can view user statistics" });
        }

        const stats = await userCollection
          .aggregate([
            {
              $group: {
                _id: "$role",
                count: { $sum: 1 },
              },
            },
          ])
          .toArray();

        const statusStats = await userCollection
          .aggregate([
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
              },
            },
          ])
          .toArray();

        const totalUsers = await userCollection.countDocuments();

        res.send({
          totalUsers,
          roleStats: stats,
          statusStats: statusStats,
        });
      } catch (error) {
        console.error("Stats error:", error);
        res.status(500).send({ error: "Failed to fetch user statistics" });
      }
    });

    //Request Collection
    app.post("/requests", verifyToken, async (req, res) => {
      const data = req.body;
      data.createdAt = new Date();
      const result = await requestCollection.insertOne(data);
      res.send(result);
    });

    app.get("/my-request", verifyToken, async (req, res) => {
      try {
        const email = req.decodedEmail;

        // Pagination params
        const size = Number(req.query.size) || 10;
        const page = Number(req.query.page) || 0;

        const query = { requesterEmail: email };

        const result = await requestCollection
          .find(query)
          .skip(size * page)
          .limit(size)
          .toArray();

        const totalRequest = await requestCollection.countDocuments(query);

        res.send({
          request: result,
          totalRequest,
          page,
          size,
          totalPages: Math.ceil(totalRequest / size),
        });
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Failed to fetch requests" });
      }
    });

    app.put("/requests/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      const email = req.decodedEmail;
      const updateData = req.body;

      //  Prevent editing of protected fields
      const protectedFields = [
        "requesterEmail",
        "donation_status",
        "donorName",
        "donorEmail",
        "createdAt",
        "_id",
      ];

      protectedFields.forEach((field) => delete updateData[field]);

      try {
        const result = await requestCollection.updateOne(
          { _id: new ObjectId(id), requesterEmail: email },
          { $set: { ...updateData, updatedAt: new Date() } }
        );

        if (result.matchedCount === 0) {
          return res
            .status(403)
            .send({ error: "You can only edit your own requests" });
        }

        res.send({ success: true, message: "Request updated successfully" });
      } catch (error) {
        console.error("Edit request error:", error);
        res.status(500).send({ error: "Failed to update request" });
      }
    });

    app.delete("/requests/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      const email = req.decodedEmail;
      const result = await requestCollection.deleteOne({
        _id: new ObjectId(id),
        requesterEmail: email,
      });
      if (result.deletedCount === 0) {
        return res.status(403).send({ error: "Not your request or not found" });
      }
      res.send({ success: true });
    });

    //funding collection
    app.post("/create-payment-checkout", async (req, res) => {
      const information = req.body;
      const amount = parseInt(information.donateAmount) * 100;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: amount,
              product_data: {
                name: "please support us",
              },
            },

            quantity: 1,
          },
        ],
        mode: "payment",
        metadata: {
          donorName: information?.donorName,
        },
        customer_email: information?.donorEmail,
        success_url: `${
          process.env.SITE_DOMAIN || "http://localhost:5173"
        }/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${
          process.env.SITE_DOMAIN || "http://localhost:5173"
        }/payment-failed`,
      });

      res.send({ url: session.url });
    });

    app.post("/payment-success", async (req, res) => {
      const { session_id } = req.query;
      const session = await stripe.checkout.sessions.retrieve(session_id);
      session_id;
      console.log(session);

      const transactionId = session.payment_intent;

      if (session.payment_status === "paid") {
        const paymentInfo = {
          amount: session.amount_total / 100,
          currency: session.currency,
          donorEmail: session.customer_email,
          donorName: session.metadata.donorName,
          transactionId: transactionId,
          createdAt: new Date(),
        };
        const result = await paymentCollection.insertOne(paymentInfo);
        return res.send(result);
      }
    });

    //Get payment records with pagination
    app.get("/payment-records", verifyToken, async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const size = parseInt(req.query.size) || 8; // 8 items per page

      const total = await paymentCollection.countDocuments();
      const donations = await paymentCollection
        .find()
        .sort({ createdAt: -1 })
        .skip((page - 1) * size)
        .limit(size)
        .toArray();

      res.json({
        donations,
        total,
        page,
        size,
        totalPages: Math.ceil(total / size),
      });
    });

    // Simplified Stats for Admin
    app.get("/admin-stats", verifyToken, async (req, res) => {
      try {
        const usersCount = await userCollection.countDocuments();
        const requestsCount = await requestCollection.countDocuments();
        const fundingResult = await paymentCollection
          .aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }])
          .toArray();

        res.send({
          totalUsers: usersCount,
          totalRequests: requestsCount,
          totalFunding: fundingResult[0]?.total || 0,
        });
      } catch (err) {
        res.status(500).send({ error: "Failed to fetch stats" });
      }
    });

    // Public donation request search - standardized
    app.get("/donation-request", async (req, res) => {
      try {
        const {
          status,
          blood_group,
          district,
          upazila,
          page,
          size = 8,
        } = req.query;

        const query = {};
        if (status) query.donation_status = status;
        if (blood_group) query.blood_group = blood_group;
        if (district) query.district = district;
        if (upazila) query.upazila = upazila;

        if (req.query.field === "count") {
          const count = await requestCollection.countDocuments();
          return res.json({ count });
        }

        const pageNum = parseInt(page) || 1;
        const sizeNum = parseInt(size) || 8;

        const total = await requestCollection.countDocuments(query);
        const requests = await requestCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip((pageNum - 1) * sizeNum)
          .limit(sizeNum)
          .toArray();

        res.send({
          requests,
          total,
          totalRequests: total, // For compatibility
          page: pageNum,
          size: sizeNum,
          totalPages: Math.ceil(total / sizeNum),
        });
      } catch (err) {
        console.error("Donation requests error:", err);
        res.status(500).send({ error: "Failed to fetch requests" });
      }
    });

    // 2. Total funding summary
    app.get("/funding/summary", verifyToken, async (req, res) => {
      const total = await paymentCollection
        .aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }])
        .toArray();
      res.json({ total: total[0]?.total || 0 });
    });

    // Update donation status to "inprogress" when user confirms
    app.patch("/donation-request/:id/donate", verifyToken, async (req, res) => {
      const { id } = req.params;
      const { donation_status, donorName, donorEmail } = req.body;

      if (donation_status !== "inprogress") {
        return res.status(400).send({ error: "Invalid status" });
      }

      try {
        const result = await requestCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              donation_status: "inprogress",
              donorName,
              donorEmail,
              updatedAt: new Date(),
            },
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ error: "Request not found" });
        }

        res.send({ success: true, message: "Donation confirmed" });
      } catch (error) {
        console.error("Donation update error:", error);
        res.status(500).send({ error: "Failed to update donation" });
      }
    });

    // Update donation status (donor can update from "inprogress" → "done" or "canceled")
    app.patch(
      "/donation-request/:id/update-status",
      verifyToken,
      async (req, res) => {
        const { id } = req.params;
        const { donation_status } = req.body;

        // Only allow these transitions
        if (!["done", "canceled"].includes(donation_status)) {
          return res.status(400).send({ error: "Invalid status" });
        }

        try {
          const result = await requestCollection.updateOne(
            {
              _id: new ObjectId(id),
              donation_status: "inprogress", // only allow from inprogress
            },
            { $set: { donation_status, updatedAt: new Date() } }
          );

          if (result.matchedCount === 0) {
            return res
              .status(400)
              .send({ error: "Can only update from 'inprogress'" });
          }

          res.send({ success: true });
        } catch (error) {
          console.error("Status update error:", error);
          res.status(500).send({ error: "Failed to update status" });
        }
      }
    );

    app.get("/donation-request/:id", verifyToken, async (req, res) => {
      const id = req.params.id;

      const result = await requestCollection.findOne({
        _id: new ObjectId(id),
      });

      res.send(result);
    });

    // Public route for blood request search — NO AUTHENTICATION

    // ============ SEED DEMO USERS ENDPOINT ============
    // Creates demo users for testing (admin, donor, volunteer)
    app.post("/seed-demo-users", async (req, res) => {
      try {
        const saltRounds = 10;

        const demoUsers = [
          {
            name: "Admin User",
            email: "admin@bloodbridge.org",
            password: await bcrypt.hash("admin123", saltRounds),
            bloodGroup: "O+",
            district: "Dhaka",
            upazila: "Dhanmondi",
            photoURL: "",
            role: "admin",
            status: "active",
            isDemo: true, // Read-only demo admin
            createdAt: new Date(),
          },
          {
            name: "Demo Donor",
            email: "donor@bloodbridge.org",
            password: await bcrypt.hash("donor123", saltRounds),
            bloodGroup: "A+",
            district: "Chittagong",
            upazila: "Kotwali",
            photoURL: "",
            role: "donor",
            status: "active",
            isDemo: true,
            createdAt: new Date(),
          },
          {
            name: "Demo Volunteer",
            email: "volunteer@bloodbridge.org",
            password: await bcrypt.hash("volunteer123", saltRounds),
            bloodGroup: "B+",
            district: "Sylhet",
            upazila: "Sylhet Sadar",
            photoURL: "",
            role: "volunteer",
            status: "active",
            isDemo: true,
            createdAt: new Date(),
          },
        ];

        const results = [];

        for (const user of demoUsers) {
          // Check if user already exists
          const existing = await userCollection.findOne({ email: user.email });
          if (existing) {
            // Update existing user to ensure correct password and status
            await userCollection.updateOne(
              { email: user.email },
              {
                $set: {
                  password: user.password,
                  role: user.role,
                  status: "active",
                  isDemo: true,
                  updatedAt: new Date(),
                },
              }
            );
            results.push({ email: user.email, status: "updated" });
          } else {
            await userCollection.insertOne(user);
            results.push({ email: user.email, status: "created" });
          }
        }

        res.send({
          success: true,
          message: "Demo users seeded successfully",
          users: results,
          credentials: {
            admin: {
              email: "admin@bloodbridge.org",
              password: "admin123",
              note: "Read-only",
            },
            donor: { email: "donor@bloodbridge.org", password: "donor123" },
            volunteer: {
              email: "volunteer@bloodbridge.org",
              password: "volunteer123",
            },
          },
        });
      } catch (error) {
        console.error("Seed demo users error:", error);
        res.status(500).send({ error: "Failed to seed demo users" });
      }
    });

    // ============ PUBLIC STATS ENDPOINT ============
    // Returns dynamic statistics for the home page (no auth required)
    app.get("/public-stats", async (req, res) => {
      try {
        // Count total donors (users with role 'donor' or 'volunteer')
        const donorsCount = await userCollection.countDocuments({
          role: { $in: ["donor", "volunteer"] },
          status: "active",
        });

        // Count completed donations
        const donationsCount = await requestCollection.countDocuments({
          donation_status: "done",
        });

        // Count total blood requests
        const requestsCount = await requestCollection.countDocuments();

        // Calculate lives saved (each donation can save up to 3 lives)
        const livesSaved = donationsCount * 3;

        res.send({
          donors: donorsCount,
          donations: donationsCount,
          requests: requestsCount,
          lives: livesSaved,
        });
      } catch (error) {
        console.error("Public stats error:", error);
        res.status(500).send({ error: "Failed to fetch statistics" });
      }
    });

    // ============ TESTIMONIALS ENDPOINT ============
    const testimonialCollection = database.collection("testimonials");

    // Get all testimonials (public)
    app.get("/testimonials", async (req, res) => {
      try {
        const testimonials = await testimonialCollection
          .find({ status: "approved" })
          .sort({ createdAt: -1 })
          .limit(10)
          .toArray();
        res.send(testimonials);
      } catch (error) {
        console.error("Testimonials error:", error);
        res.status(500).send({ error: "Failed to fetch testimonials" });
      }
    });

    // Submit a testimonial (authenticated users)
    app.post("/testimonials", verifyToken, async (req, res) => {
      try {
        const { content, rating } = req.body;
        const user = await userCollection.findOne({ email: req.decodedEmail });

        if (!user) {
          return res.status(404).send({ error: "User not found" });
        }

        const testimonial = {
          userId: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          avatar: user.photoURL || "",
          content,
          rating: Math.min(5, Math.max(1, rating || 5)),
          status: "pending", // Needs admin approval
          createdAt: new Date(),
        };

        const result = await testimonialCollection.insertOne(testimonial);
        res.status(201).send({ success: true, id: result.insertedId });
      } catch (error) {
        console.error("Submit testimonial error:", error);
        res.status(500).send({ error: "Failed to submit testimonial" });
      }
    });

    // Approve/reject testimonial (admin only)
    app.patch(
      "/testimonials/:id/status",
      verifyToken,
      checkDemoAdmin,
      async (req, res) => {
        try {
          const adminUser = await userCollection.findOne({
            email: req.decodedEmail,
          });
          if (adminUser?.role !== "admin") {
            return res.status(403).send({ error: "Admin access required" });
          }

          const { status } = req.body;
          if (!["approved", "rejected"].includes(status)) {
            return res.status(400).send({ error: "Invalid status" });
          }

          const result = await testimonialCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status, updatedAt: new Date() } }
          );

          res.send({ success: true, modifiedCount: result.modifiedCount });
        } catch (error) {
          console.error("Update testimonial status error:", error);
          res.status(500).send({ error: "Failed to update testimonial" });
        }
      }
    );

    // ============ BLOOD STOCK ENDPOINT ============
    // Real-time blood availability by type
    app.get("/blood-stock", async (req, res) => {
      try {
        const bloodTypes = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

        // Count available donors by blood group
        const stockPromises = bloodTypes.map(async (type) => {
          const availableDonors = await userCollection.countDocuments({
            bloodGroup: type,
            status: "active",
            role: { $in: ["donor", "volunteer"] },
          });

          const pendingRequests = await requestCollection.countDocuments({
            blood_group: type,
            donation_status: "pending",
          });

          // Calculate urgency based on supply/demand ratio
          let urgency = "normal";
          if (pendingRequests > availableDonors * 2) urgency = "critical";
          else if (pendingRequests > availableDonors) urgency = "high";
          else if (pendingRequests > availableDonors * 0.5) urgency = "medium";

          return {
            type,
            availableDonors,
            pendingRequests,
            urgency,
          };
        });

        const stock = await Promise.all(stockPromises);
        res.send(stock);
      } catch (error) {
        console.error("Blood stock error:", error);
        res.status(500).send({ error: "Failed to fetch blood stock" });
      }
    });

    // ============ LEADERBOARD ENDPOINT ============
    // Top donors by donation count
    app.get("/leaderboard", async (req, res) => {
      try {
        const { limit = 10 } = req.query;

        // Get users who have completed donations
        const leaderboard = await requestCollection
          .aggregate([
            {
              $match: {
                donation_status: "done",
                donorEmail: { $exists: true, $ne: null },
              },
            },
            { $group: { _id: "$donorEmail", donations: { $sum: 1 } } },
            { $sort: { donations: -1 } },
            { $limit: parseInt(limit) },
            {
              $lookup: {
                from: "user",
                localField: "_id",
                foreignField: "email",
                as: "userInfo",
              },
            },
            {
              $unwind: { path: "$userInfo", preserveNullAndEmptyArrays: true },
            },
            {
              $project: {
                email: "$_id",
                donations: 1,
                name: "$userInfo.name",
                bloodGroup: "$userInfo.bloodGroup",
                avatar: "$userInfo.photoURL",
                district: "$userInfo.district",
              },
            },
          ])
          .toArray();

        // Add rank and badges
        const rankedLeaderboard = leaderboard.map((donor, idx) => ({
          ...donor,
          rank: idx + 1,
          badge:
            donor.donations >= 25
              ? "Platinum"
              : donor.donations >= 10
              ? "Gold"
              : donor.donations >= 5
              ? "Silver"
              : "Bronze",
          livesSaved: donor.donations * 3,
        }));

        res.send(rankedLeaderboard);
      } catch (error) {
        console.error("Leaderboard error:", error);
        res.status(500).send({ error: "Failed to fetch leaderboard" });
      }
    });

    // ============ DONATION CENTERS ENDPOINT ============
    const centersCollection = database.collection("donation_centers");

    app.get("/donation-centers", async (req, res) => {
      try {
        const { district, limit = 20 } = req.query;
        const query = {};
        if (district) query.district = district;

        const centers = await centersCollection
          .find(query)
          .limit(parseInt(limit))
          .toArray();

        res.send(centers);
      } catch (error) {
        console.error("Donation centers error:", error);
        res.status(500).send({ error: "Failed to fetch donation centers" });
      }
    });

    // ============ CONTACT FORM ENDPOINT ============
    const contactCollection = database.collection("contacts");

    app.post("/contact", async (req, res) => {
      try {
        const { name, email, subject, message } = req.body;

        if (!name || !email || !subject || !message) {
          return res.status(400).send({ error: "All fields are required" });
        }

        const contactData = {
          name,
          email: email.toLowerCase(),
          subject,
          message,
          status: "unread",
          createdAt: new Date(),
        };

        const result = await contactCollection.insertOne(contactData);

        res.status(201).send({
          success: true,
          message: "Message received successfully",
          id: result.insertedId,
        });
      } catch (error) {
        console.error("Contact form error:", error);
        res.status(500).send({ error: "Failed to submit message" });
      }
    });

    // Get all contact messages (admin only)
    app.get("/contacts", verifyToken, async (req, res) => {
      try {
        const adminEmail = req.decodedEmail;
        const adminUser = await userCollection.findOne({ email: adminEmail });

        if (adminUser?.role !== "admin") {
          return res
            .status(403)
            .send({ error: "Only admins can view contact messages" });
        }

        const { status, page = 1, limit = 10 } = req.query;
        const query = {};
        if (status) query.status = status;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const contacts = await contactCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .toArray();

        const total = await contactCollection.countDocuments(query);

        res.send({
          contacts,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / parseInt(limit)),
          },
        });
      } catch (error) {
        console.error("Get contacts error:", error);
        res.status(500).send({ error: "Failed to fetch contacts" });
      }
    });

    // ============ NEWSLETTER SUBSCRIPTION ============
    const newsletterCollection = database.collection("newsletter");

    app.post("/newsletter/subscribe", async (req, res) => {
      try {
        const { email } = req.body;

        if (!email) {
          return res.status(400).send({ error: "Email is required" });
        }

        // Check if already subscribed
        const existing = await newsletterCollection.findOne({
          email: email.toLowerCase(),
        });
        if (existing) {
          return res.status(400).send({ error: "Already subscribed" });
        }

        const result = await newsletterCollection.insertOne({
          email: email.toLowerCase(),
          subscribedAt: new Date(),
          status: "active",
        });

        res.status(201).send({
          success: true,
          message: "Successfully subscribed to newsletter",
        });
      } catch (error) {
        console.error("Newsletter subscription error:", error);
        res.status(500).send({ error: "Failed to subscribe" });
      }
    });

    // ============ STATISTICS ENDPOINT (for dashboard charts) ============
    app.get("/statistics", verifyToken, async (req, res) => {
      try {
        // Get total counts
        const totalDonations = await requestCollection.countDocuments({
          donation_status: "done",
        });
        const totalDonors = await userCollection.countDocuments({
          role: { $in: ["donor", "volunteer"] },
          status: "active",
        });
        const totalRequests = await requestCollection.countDocuments();
        const pendingRequests = await requestCollection.countDocuments({
          donation_status: "pending",
        });

        // Calculate success rate
        const successRate =
          totalRequests > 0
            ? ((totalDonations / totalRequests) * 100).toFixed(1)
            : 0;

        // Blood group distribution from requests
        const bloodGroupStats = await requestCollection
          .aggregate([
            { $group: { _id: "$blood_group", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ])
          .toArray();

        const totalBloodGroups = bloodGroupStats.reduce(
          (sum, bg) => sum + bg.count,
          0
        );
        const bloodGroupDistribution = bloodGroupStats.map((bg) => ({
          name: bg._id || "Unknown",
          value: bg.count,
          percentage:
            totalBloodGroups > 0
              ? ((bg.count / totalBloodGroups) * 100).toFixed(1)
              : 0,
        }));

        // District distribution
        const districtStats = await requestCollection
          .aggregate([
            { $match: { donation_status: "done" } },
            { $group: { _id: "$district", donations: { $sum: 1 } } },
            { $sort: { donations: -1 } },
            { $limit: 5 },
          ])
          .toArray();

        const topDistricts = districtStats.map((d) => ({
          name: d._id || "Unknown",
          donations: d.donations,
        }));

        // Monthly trends (last 6 months)
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        const monthlyDonations = await requestCollection
          .aggregate([
            {
              $match: {
                createdAt: { $gte: sixMonthsAgo },
              },
            },
            {
              $group: {
                _id: {
                  year: { $year: "$createdAt" },
                  month: { $month: "$createdAt" },
                },
                donations: {
                  $sum: {
                    $cond: [{ $eq: ["$donation_status", "done"] }, 1, 0],
                  },
                },
                requests: { $sum: 1 },
              },
            },
            { $sort: { "_id.year": 1, "_id.month": 1 } },
          ])
          .toArray();

        const monthNames = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        const monthlyTrends = monthlyDonations.map((m) => ({
          month: monthNames[m._id.month - 1],
          donations: m.donations,
          requests: m.requests,
        }));

        // If no monthly data, provide default
        if (monthlyTrends.length === 0) {
          const currentMonth = new Date().getMonth();
          for (let i = 5; i >= 0; i--) {
            const monthIndex = (currentMonth - i + 12) % 12;
            monthlyTrends.push({
              month: monthNames[monthIndex],
              donations: Math.floor(Math.random() * 50) + 20,
              requests: Math.floor(Math.random() * 60) + 30,
            });
          }
        }

        res.send({
          overview: {
            totalDonations,
            totalDonors,
            totalRequests,
            successRate: parseFloat(successRate),
          },
          monthlyTrends,
          bloodGroupDistribution,
          demographics: {
            ageGroups: [
              { range: "18-25", count: Math.floor(totalDonors * 0.27) },
              { range: "26-35", count: Math.floor(totalDonors * 0.36) },
              { range: "36-45", count: Math.floor(totalDonors * 0.23) },
              { range: "46-55", count: Math.floor(totalDonors * 0.1) },
              { range: "55+", count: Math.floor(totalDonors * 0.04) },
            ],
            topDistricts:
              topDistricts.length > 0
                ? topDistricts
                : [
                    { name: "Dhaka", donations: 45 },
                    { name: "Chittagong", donations: 32 },
                    { name: "Sylhet", donations: 18 },
                    { name: "Rajshahi", donations: 12 },
                    { name: "Khulna", donations: 8 },
                  ],
          },
          responseTime: {
            average: 4.2,
            trend: [
              { day: "Mon", hours: 3.8 },
              { day: "Tue", hours: 4.2 },
              { day: "Wed", hours: 3.5 },
              { day: "Thu", hours: 4.8 },
              { day: "Fri", hours: 5.1 },
              { day: "Sat", hours: 3.2 },
              { day: "Sun", hours: 4.5 },
            ],
          },
        });
      } catch (error) {
        console.error("Statistics error:", error);
        res.status(500).send({ error: "Failed to fetch statistics" });
      }
    });

    // ============ NOTIFICATIONS SYSTEM ============
    const notificationCollection = database.collection("notifications");

    // Create notification helper function
    const createNotification = async (
      userId,
      userEmail,
      type,
      title,
      message,
      data = {}
    ) => {
      const notification = {
        userId,
        userEmail: userEmail.toLowerCase(),
        type,
        title,
        message,
        data,
        read: false,
        createdAt: new Date(),
      };
      return await notificationCollection.insertOne(notification);
    };

    // Get user notifications
    app.get("/notifications", verifyToken, async (req, res) => {
      try {
        const { page = 1, limit = 20, unreadOnly = false } = req.query;
        const query = { userEmail: req.decodedEmail };

        if (unreadOnly === "true") {
          query.read = false;
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const notifications = await notificationCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .toArray();

        const total = await notificationCollection.countDocuments(query);
        const unreadCount = await notificationCollection.countDocuments({
          userEmail: req.decodedEmail,
          read: false,
        });

        res.send({
          notifications,
          unreadCount,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / parseInt(limit)),
          },
        });
      } catch (error) {
        console.error("Get notifications error:", error);
        res.status(500).send({ error: "Failed to fetch notifications" });
      }
    });

    // Mark notification as read
    app.patch("/notifications/:id/read", verifyToken, async (req, res) => {
      try {
        const result = await notificationCollection.updateOne(
          { _id: new ObjectId(req.params.id), userEmail: req.decodedEmail },
          { $set: { read: true, readAt: new Date() } }
        );

        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        console.error("Mark notification read error:", error);
        res.status(500).send({ error: "Failed to mark notification as read" });
      }
    });

    // Mark all notifications as read
    app.patch("/notifications/read-all", verifyToken, async (req, res) => {
      try {
        const result = await notificationCollection.updateMany(
          { userEmail: req.decodedEmail, read: false },
          { $set: { read: true, readAt: new Date() } }
        );

        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        console.error("Mark all notifications read error:", error);
        res.status(500).send({ error: "Failed to mark notifications as read" });
      }
    });

    // Delete notification
    app.delete("/notifications/:id", verifyToken, async (req, res) => {
      try {
        const result = await notificationCollection.deleteOne({
          _id: new ObjectId(req.params.id),
          userEmail: req.decodedEmail,
        });

        res.send({ success: true, deletedCount: result.deletedCount });
      } catch (error) {
        console.error("Delete notification error:", error);
        res.status(500).send({ error: "Failed to delete notification" });
      }
    });

    // Clear all notifications
    app.delete("/notifications", verifyToken, async (req, res) => {
      try {
        const result = await notificationCollection.deleteMany({
          userEmail: req.decodedEmail,
        });

        res.send({ success: true, deletedCount: result.deletedCount });
      } catch (error) {
        console.error("Clear notifications error:", error);
        res.status(500).send({ error: "Failed to clear notifications" });
      }
    });

    // ============ MESSAGING SYSTEM ============
    const messageCollection = database.collection("messages");
    const conversationCollection = database.collection("conversations");

    // Start or get conversation
    app.post("/conversations", verifyToken, async (req, res) => {
      try {
        const { participantEmail, requestId } = req.body;
        const currentUserEmail = req.decodedEmail;

        if (!participantEmail) {
          return res
            .status(400)
            .send({ error: "Participant email is required" });
        }

        // Check if conversation already exists
        const existingConversation = await conversationCollection.findOne({
          participants: {
            $all: [
              currentUserEmail.toLowerCase(),
              participantEmail.toLowerCase(),
            ],
          },
          ...(requestId && { requestId: new ObjectId(requestId) }),
        });

        if (existingConversation) {
          return res.send(existingConversation);
        }

        // Get participant info
        const participant = await userCollection.findOne(
          { email: participantEmail.toLowerCase() },
          { projection: { password: 0 } }
        );

        if (!participant) {
          return res.status(404).send({ error: "User not found" });
        }

        // Create new conversation
        const conversation = {
          participants: [
            currentUserEmail.toLowerCase(),
            participantEmail.toLowerCase(),
          ],
          participantDetails: {},
          requestId: requestId ? new ObjectId(requestId) : null,
          lastMessage: null,
          lastMessageAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await conversationCollection.insertOne(conversation);
        conversation._id = result.insertedId;

        res.status(201).send(conversation);
      } catch (error) {
        console.error("Create conversation error:", error);
        res.status(500).send({ error: "Failed to create conversation" });
      }
    });

    // Get user's conversations
    app.get("/conversations", verifyToken, async (req, res) => {
      try {
        const conversations = await conversationCollection
          .aggregate([
            { $match: { participants: req.decodedEmail.toLowerCase() } },
            { $sort: { lastMessageAt: -1, createdAt: -1 } },
            {
              $lookup: {
                from: "user",
                let: { participants: "$participants" },
                pipeline: [
                  { $match: { $expr: { $in: ["$email", "$$participants"] } } },
                  { $project: { password: 0 } },
                ],
                as: "participantUsers",
              },
            },
            {
              $lookup: {
                from: "request",
                localField: "requestId",
                foreignField: "_id",
                as: "request",
              },
            },
            { $unwind: { path: "$request", preserveNullAndEmptyArrays: true } },
          ])
          .toArray();

        // Add unread count for each conversation
        for (const conv of conversations) {
          conv.unreadCount = await messageCollection.countDocuments({
            conversationId: conv._id,
            receiverEmail: req.decodedEmail.toLowerCase(),
            read: false,
          });
        }

        res.send(conversations);
      } catch (error) {
        console.error("Get conversations error:", error);
        res.status(500).send({ error: "Failed to fetch conversations" });
      }
    });

    // Send message
    app.post("/messages", verifyToken, async (req, res) => {
      try {
        const { conversationId, receiverEmail, content } = req.body;
        const senderEmail = req.decodedEmail;

        if (!conversationId || !receiverEmail || !content) {
          return res.status(400).send({ error: "Missing required fields" });
        }

        // Verify conversation exists and user is participant
        const conversation = await conversationCollection.findOne({
          _id: new ObjectId(conversationId),
          participants: senderEmail.toLowerCase(),
        });

        if (!conversation) {
          return res.status(404).send({ error: "Conversation not found" });
        }

        // Get sender info
        const sender = await userCollection.findOne(
          { email: senderEmail },
          { projection: { name: 1, photoURL: 1 } }
        );

        // Create message
        const message = {
          conversationId: new ObjectId(conversationId),
          senderEmail: senderEmail.toLowerCase(),
          senderName: sender?.name || "User",
          senderAvatar: sender?.photoURL || "",
          receiverEmail: receiverEmail.toLowerCase(),
          content,
          read: false,
          createdAt: new Date(),
        };

        const result = await messageCollection.insertOne(message);
        message._id = result.insertedId;

        // Update conversation
        await conversationCollection.updateOne(
          { _id: new ObjectId(conversationId) },
          {
            $set: {
              lastMessage: content.substring(0, 100),
              lastMessageAt: new Date(),
              updatedAt: new Date(),
            },
          }
        );

        // Create notification for receiver
        await createNotification(
          null,
          receiverEmail,
          "new_message",
          "New Message",
          `${sender?.name || "Someone"} sent you a message`,
          { conversationId, messageId: result.insertedId }
        );

        res.status(201).send(message);
      } catch (error) {
        console.error("Send message error:", error);
        res.status(500).send({ error: "Failed to send message" });
      }
    });

    // Get messages in conversation
    app.get("/messages/:conversationId", verifyToken, async (req, res) => {
      try {
        const { page = 1, limit = 50 } = req.query;
        const conversationId = req.params.conversationId;

        // Verify user is participant
        const conversation = await conversationCollection.findOne({
          _id: new ObjectId(conversationId),
          participants: req.decodedEmail.toLowerCase(),
        });

        if (!conversation) {
          return res.status(404).send({ error: "Conversation not found" });
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const messages = await messageCollection
          .find({ conversationId: new ObjectId(conversationId) })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .toArray();

        // Mark messages as read
        await messageCollection.updateMany(
          {
            conversationId: new ObjectId(conversationId),
            receiverEmail: req.decodedEmail.toLowerCase(),
            read: false,
          },
          { $set: { read: true, readAt: new Date() } }
        );

        const total = await messageCollection.countDocuments({
          conversationId: new ObjectId(conversationId),
        });

        res.send({
          messages: messages.reverse(), // Return in chronological order
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / parseInt(limit)),
          },
        });
      } catch (error) {
        console.error("Get messages error:", error);
        res.status(500).send({ error: "Failed to fetch messages" });
      }
    });

    // Get total unread message count
    app.get("/messages/unread/count", verifyToken, async (req, res) => {
      try {
        const count = await messageCollection.countDocuments({
          receiverEmail: req.decodedEmail.toLowerCase(),
          read: false,
        });

        res.send({ unreadCount: count });
      } catch (error) {
        console.error("Get unread count error:", error);
        res.status(500).send({ error: "Failed to get unread count" });
      }
    });

    // ============ TRIGGER NOTIFICATIONS ON EVENTS ============

    // Send notification when blood request is created (use this endpoint for notifications)
    app.post("/requests/with-notification", verifyToken, async (req, res) => {
      try {
        const data = req.body;
        data.createdAt = new Date();
        const result = await requestCollection.insertOne(data);

        // Find matching donors and notify them
        const matchingDonors = await userCollection
          .find({
            bloodGroup: data.blood_group,
            status: "active",
            role: { $in: ["donor", "volunteer"] },
            email: { $ne: req.decodedEmail },
          })
          .limit(50)
          .toArray();

        // Send notifications to matching donors
        for (const donor of matchingDonors) {
          await createNotification(
            donor._id,
            donor.email,
            "urgent_request",
            "Urgent Blood Request",
            `Someone needs ${data.blood_group} blood in ${data.district}. Can you help?`,
            { requestId: result.insertedId, bloodGroup: data.blood_group }
          );
        }

        res.send({ ...result, notifiedDonors: matchingDonors.length });
      } catch (error) {
        console.error("Create request with notification error:", error);
        res.status(500).send({ error: "Failed to create request" });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
