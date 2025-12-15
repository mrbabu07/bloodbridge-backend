const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const port = process.env.PORT || 3000;
const stripe = require("stripe")(process.env.STRIPE_KEY);
const crypto = require("crypto");

const app = express();

app.use(cors());
app.use(express.json());

const admin = require("firebase-admin");

// const serviceAccount = require("./firebase-admin-key.json");

const decoded = Buffer.from(process.env.FB_KEY, "base64").toString("utf8");
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: "Unauthorized access" });
  }
  try {
    const idToken = token.split(" ")[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    console.log("Decoded Token:", decodedToken);
    req.decodedEmail = decodedToken.email;
    next();
  } catch (error) {
    return res.status(401).send({ message: "Unauthorized access" });
  }
};

const uri =
  "mongodb+srv://ph-11:eVD4PIXIN9Idf8Gy@cluster0.g6xesjf.mongodb.net/?appName=Cluster0";

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
    // Send a ping to confirm a successful connection

    const database = client.db("ph-11DB");
    const userCollection = database.collection("user");
    const requestCollection = database.collection("request");
    // const fundingCollection = database.collection("funding");
    const paymentCollection = database.collection("payment");
    //users info
    app.post("/users", async (req, res) => {
      const userInfo = req.body;
      userInfo.createdAt = new Date();
      userInfo.role = "donor";
      userInfo.status = "active";
      const result = await userCollection.insertOne(userInfo);
      res.send(result);
    });

    app.get("/users", verifyFBToken, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.status(200).send(result);
    });

    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await userCollection.findOne(query);
      console.log(result);
      res.send(result);
    });

    app.patch("/update/user/status", verifyFBToken, async (req, res) => {
      const { email, status } = req.query;
      const query = { email: email };

      const updateStatus = {
        $set: {
          status: status,
        },
      };
      const result = await userCollection.updateOne(query, updateStatus);
      res.send(result);
    });

    //Request Collection
    app.post("/requests", verifyFBToken, async (req, res) => {
      const data = req.body;
      data.createdAt = new Date();
      const result = await requestCollection.insertOne(data);
      res.send(result);
    });

    app.get("/my-request", verifyFBToken, async (req, res) => {
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
        success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/payment-failed`,
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

    //donation request

    // GET /donation-requests?blood_group=A+&district=Dhaka&upazila=Dhanmondi&status=pending
    app.get("/donation-requests", async (req, res) => {
      try {
        const { status, blood_group, district, upazila } = req.query;

        const query = {};

        if (status) query.donation_status = status;
        if (blood_group) query.blood_group = blood_group;
        if (district) query.district = district;
        if (upazila) query.upazila = upazila;

        const result = await requestCollection.find(query).toArray();

        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to fetch donation requests" });
      }
    });

    // Update donation status to "inprogress" when user confirms
    app.patch(
      "/donation-request/:id/donate",
      verifyFBToken,
      async (req, res) => {
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
      }
    );

    // Update donation status (donor can update from "inprogress" → "done" or "canceled")
    app.patch(
      "/donation-request/:id/update-status",
      verifyFBToken,
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

    app.get("/donation-request/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;

      const result = await requestCollection.findOne({
        _id: new ObjectId(id),
      });

      res.send(result);
    });

    // Public route for blood request search — NO AUTHENTICATION

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
