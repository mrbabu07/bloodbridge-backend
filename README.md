# 🩸 BloodBridge Backend API

RESTful API server for the BloodBridge blood donation management platform. Built with Node.js, Express, and MongoDB.

## 📋 Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Server](#running-the-server)
- [API Documentation](#api-documentation)
- [Database Schema](#database-schema)
- [Security](#security)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

## ✨ Features

### Core Functionality

- 🔐 **JWT Authentication** - Secure token-based authentication
- 👥 **User Management** - Registration, login, profile management
- 🩸 **Blood Request System** - Create, read, update, delete blood requests
- 💳 **Payment Integration** - Stripe payment processing for donations
- 🔔 **Real-time Notifications** - Socket.IO for live updates
- 📊 **Analytics Dashboard** - Statistics and reporting
- 🚨 **Emergency Alerts** - Priority blood request system
- 🔍 **Advanced Search** - Filter by blood group, location, date
- 📍 **Location-based Filtering** - District and Upazila search
- 🎯 **Donor Matching** - AI-powered donor recommendation

### Advanced Features

- 🏆 **Gamification System** - Badges and achievements
- 📅 **Event Management** - Blood donation camps and events
- 💬 **Messaging System** - Direct communication between users
- 📈 **Donation Tracking** - Complete donation history
- ⚡ **Rate Limiting** - API protection against abuse
- 🔒 **Helmet Security** - HTTP headers security
- 📦 **Compression** - Response compression for performance
- 📝 **Request Logging** - Morgan HTTP request logger

## 🛠️ Tech Stack

### Core Technologies

- **Node.js** (v18+) - JavaScript runtime
- **Express.js** (v5.2.1) - Web application framework
- **MongoDB** (v7.0.0) - NoSQL database

### Authentication & Security

- **bcryptjs** (v2.4.3) - Password hashing
- **jsonwebtoken** (v9.0.3) - JWT token generation
- **helmet** (v7.1.0) - Security headers
- **express-rate-limit** (v7.1.5) - Rate limiting
- **cors** (v2.8.5) - Cross-origin resource sharing

### Payment & Communication

- **stripe** (v20.0.0) - Payment processing
- **socket.io** (v4.7.5) - Real-time communication
- **redis** (v4.6.13) - Caching and session management

### Utilities

- **dotenv** (v17.2.3) - Environment variables
- **multer** (v1.4.5) - File upload handling
- **node-cron** (v3.0.3) - Scheduled tasks
- **geolib** (v3.3.4) - Geolocation calculations
- **compression** (v1.7.4) - Response compression
- **morgan** (v1.10.0) - HTTP request logger

## 📦 Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v18.0.0 or higher)
- **npm** (v9.0.0 or higher)
- **MongoDB** (v6.0 or higher) - Local or Atlas cluster
- **Redis** (Optional, for caching)

### External Services Required

1. **MongoDB Atlas** or local MongoDB instance
2. **Stripe Account** - For payment processing
3. **Firebase Project** - For authentication (optional)

## 🚀 Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd PH-11-BACKEND
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

## ⚙️ Configuration

### Environment Variables

Edit the `.env` file with your configuration:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Database
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/
DB_NAME=bloodBridgeDB

# Authentication
JWT_SECRET=your-super-secret-jwt-key-change-in-production

# Payment Gateway
STRIPE_KEY=sk_test_your_stripe_secret_key

# Frontend URL (for CORS)
SITE_DOMAIN=http://localhost:5173

# Redis (Optional)
REDIS_URL=redis://localhost:6379

# Firebase Admin (Optional)
FB_KEY=base64_encoded_firebase_service_account_key
```

### MongoDB Setup

1. **Create MongoDB Atlas Cluster** (or use local MongoDB):

   - Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
   - Create a new cluster
   - Get your connection string

2. **Database Collections** (Auto-created on first use):
   - `user` - User accounts and profiles
   - `request` - Blood donation requests
   - `payment` - Payment transactions
   - `testimonials` - User testimonials
   - `donation_centers` - Blood donation centers
   - `contacts` - Contact form submissions
   - `newsletter` - Newsletter subscriptions
   - `notifications` - User notifications
   - `messages` - Direct messages
   - `conversations` - Message threads
   - `events` - Blood donation events
   - `achievements` - User achievements and badges

### Stripe Setup

1. Create a Stripe account at [stripe.com](https://stripe.com)
2. Get your **Secret Key** from the Dashboard
3. Add it to your `.env` file as `STRIPE_KEY`

## 🏃 Running the Server

### Development Mode (with auto-reload)

```bash
npm run dev
```

The server will start on `http://localhost:3000` with nodemon watching for changes.

### Production Mode

```bash
npm start
```

### Verify Server is Running

Open your browser or use curl:

```bash
curl http://localhost:3000
```

You should see:

```json
{
  "message": "Hello World!"
}
```

## 📚 API Documentation

### Base URL

```
http://localhost:3000
```

### Authentication

Most endpoints require a JWT token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

### API Endpoints

#### 🔐 Authentication

| Method | Endpoint                | Description       | Auth Required |
| ------ | ----------------------- | ----------------- | ------------- |
| POST   | `/auth/register`        | Register new user | No            |
| POST   | `/auth/login`           | Login user        | No            |
| GET    | `/auth/me`              | Get current user  | Yes           |
| PATCH  | `/auth/change-password` | Change password   | Yes           |

#### 👥 User Management

| Method | Endpoint              | Description                 | Auth Required |
| ------ | --------------------- | --------------------------- | ------------- |
| POST   | `/users`              | Create user                 | No            |
| GET    | `/users`              | Get all users (admin)       | Yes           |
| GET    | `/users/role/:email`  | Get user by email           | No            |
| PATCH  | `/users/profile`      | Update profile              | Yes           |
| PATCH  | `/users/role`         | Update user role (admin)    | Yes           |
| PATCH  | `/update/user/status` | Update user status (admin)  | Yes           |
| GET    | `/users/stats`        | Get user statistics (admin) | Yes           |

#### 🩸 Blood Requests

| Method | Endpoint                              | Description                     | Auth Required |
| ------ | ------------------------------------- | ------------------------------- | ------------- |
| GET    | `/donation-request`                   | Get all requests (with filters) | No            |
| POST   | `/requests`                           | Create new request              | Yes           |
| GET    | `/my-request`                         | Get user's requests             | Yes           |
| GET    | `/donation-request/:id`               | Get request by ID               | Yes           |
| PUT    | `/requests/:id`                       | Update request                  | Yes           |
| DELETE | `/requests/:id`                       | Delete request                  | Yes           |
| PATCH  | `/donation-request/:id/donate`        | Confirm donation                | Yes           |
| PATCH  | `/donation-request/:id/update-status` | Update status                   | Yes           |

#### 🔍 Advanced Search

| Method | Endpoint                       | Description                  | Auth Required |
| ------ | ------------------------------ | ---------------------------- | ------------- |
| GET    | `/donors/search`               | Search donors                | No            |
| GET    | `/requests/emergency`          | Get emergency requests       | No            |
| PATCH  | `/requests/:id/mark-emergency` | Mark as emergency            | Yes           |
| POST   | `/emergency-broadcast`         | Send emergency alert (admin) | Yes           |

#### 💳 Payments

| Method | Endpoint                   | Description            | Auth Required |
| ------ | -------------------------- | ---------------------- | ------------- |
| POST   | `/create-payment-checkout` | Create Stripe session  | No            |
| POST   | `/payment-success`         | Handle payment success | No            |
| GET    | `/payment-records`         | Get payment records    | Yes           |
| GET    | `/funding/summary`         | Get funding summary    | Yes           |

#### 📊 Admin & Analytics

| Method | Endpoint              | Description           | Auth Required |
| ------ | --------------------- | --------------------- | ------------- |
| GET    | `/admin-stats`        | Get system statistics | Yes           |
| GET    | `/check-admin-exists` | Check if admin exists | No            |
| POST   | `/create-first-admin` | Create first admin    | No            |

#### 🔔 Notifications

| Method | Endpoint                  | Description            | Auth Required |
| ------ | ------------------------- | ---------------------- | ------------- |
| GET    | `/notifications`          | Get user notifications | Yes           |
| PATCH  | `/notifications/:id/read` | Mark as read           | Yes           |
| DELETE | `/notifications/:id`      | Delete notification    | Yes           |

#### 💬 Messaging

| Method | Endpoint                    | Description            | Auth Required |
| ------ | --------------------------- | ---------------------- | ------------- |
| GET    | `/conversations`            | Get user conversations | Yes           |
| GET    | `/messages/:conversationId` | Get messages           | Yes           |
| POST   | `/messages`                 | Send message           | Yes           |
| GET    | `/messages/unread/count`    | Get unread count       | Yes           |

#### 📅 Events

| Method | Endpoint      | Description          | Auth Required |
| ------ | ------------- | -------------------- | ------------- |
| GET    | `/events`     | Get all events       | No            |
| POST   | `/events`     | Create event (admin) | Yes           |
| GET    | `/events/:id` | Get event by ID      | No            |
| PUT    | `/events/:id` | Update event (admin) | Yes           |
| DELETE | `/events/:id` | Delete event (admin) | Yes           |

#### 🏆 Achievements

| Method | Endpoint                  | Description           | Auth Required |
| ------ | ------------------------- | --------------------- | ------------- |
| GET    | `/achievements`           | Get user achievements | Yes           |
| GET    | `/achievements/available` | Get available badges  | Yes           |

### Request Examples

#### Register User

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "password": "password123",
    "bloodGroup": "A+",
    "district": "Dhaka",
    "upazila": "Dhanmondi"
  }'
```

#### Create Blood Request

```bash
curl -X POST http://localhost:3000/requests \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{
    "recipientName": "Jane Doe",
    "blood_group": "O+",
    "district": "Dhaka",
    "hospital": "Dhaka Medical College",
    "donation_date": "2026-01-20",
    "donation_time": "10:00 AM",
    "request_message": "Urgent blood needed for surgery"
  }'
```

#### Search Donors

```bash
curl "http://localhost:3000/donors/search?bloodGroup=A+&district=Dhaka&page=1&limit=10"
```

## 🗄️ Database Schema

### User Collection

```javascript
{
  _id: ObjectId,
  name: String,
  email: String (unique, lowercase),
  password: String (hashed),
  bloodGroup: String,
  district: String,
  upazila: String,
  photoURL: String,
  role: String (enum: ['donor', 'volunteer', 'admin']),
  status: String (enum: ['active', 'blocked']),
  isDemo: Boolean,
  createdAt: Date,
  updatedAt: Date
}
```

### Request Collection

```javascript
{
  _id: ObjectId,
  requesterName: String,
  requesterEmail: String,
  recipientName: String,
  blood_group: String,
  district: String,
  upazila: String,
  hospital: String,
  address: String,
  donation_date: String,
  donation_time: String,
  donation_status: String (enum: ['pending', 'inprogress', 'done', 'canceled']),
  request_message: String,
  donorName: String,
  donorEmail: String,
  isEmergency: Boolean,
  priority: String (enum: ['normal', 'high', 'critical']),
  emergencyMarkedAt: Date,
  createdAt: Date,
  updatedAt: Date
}
```

### Payment Collection

```javascript
{
  _id: ObjectId,
  amount: Number,
  currency: String,
  donorEmail: String,
  donorName: String,
  transactionId: String,
  createdAt: Date
}
```

## 🔒 Security

### Implemented Security Measures

1. **Password Hashing** - bcrypt with 10 salt rounds
2. **JWT Authentication** - 7-day token expiration
3. **CORS Protection** - Configured allowed origins
4. **Rate Limiting** - 100 requests per 15 minutes per IP
5. **Helmet Security Headers** - XSS, clickjacking protection
6. **Input Validation** - Server-side validation for all inputs
7. **Role-based Access Control** - Different permissions for users/admins
8. **Demo Admin Protection** - Read-only access for demo accounts

### Best Practices

- Never commit `.env` file to Git
- Use strong JWT secrets in production
- Enable MongoDB authentication
- Use HTTPS in production
- Regularly update dependencies
- Monitor API usage and logs

## 🚀 Deployment

### Deploy to Vercel

1. **Install Vercel CLI**:

   ```bash
   npm i -g vercel
   ```

2. **Login to Vercel**:

   ```bash
   vercel login
   ```

3. **Deploy**:

   ```bash
   vercel
   ```

4. **Set Environment Variables** in Vercel Dashboard:
   - Go to your project settings
   - Add all variables from `.env`

### Deploy to Heroku

1. **Create Heroku app**:

   ```bash
   heroku create bloodbridge-api
   ```

2. **Set environment variables**:

   ```bash
   heroku config:set MONGODB_URI=your_mongodb_uri
   heroku config:set JWT_SECRET=your_jwt_secret
   # ... set all other variables
   ```

3. **Deploy**:
   ```bash
   git push heroku main
   ```

### Deploy to Railway

1. Connect your GitHub repository
2. Add environment variables in Railway dashboard
3. Deploy automatically on push

## 🐛 Troubleshooting

### Common Issues

#### MongoDB Connection Error

```
Error: MongoServerError: Authentication failed
```

**Solution**: Check your MongoDB URI and credentials in `.env`

#### Port Already in Use

```
Error: listen EADDRINUSE: address already in use :::3000
```

**Solution**: Change the PORT in `.env` or kill the process using port 3000:

```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Linux/Mac
lsof -ti:3000 | xargs kill -9
```

#### JWT Token Invalid

```
Error: Invalid or expired token
```

**Solution**:

- Check JWT_SECRET matches between requests
- Ensure token is not expired (7-day expiration)
- Verify Authorization header format: `Bearer <token>`

#### Stripe Payment Fails

```
Error: No such customer
```

**Solution**:

- Verify STRIPE_KEY is correct
- Check Stripe dashboard for errors
- Ensure using test keys in development

### Debug Mode

Enable detailed logging:

```bash
NODE_ENV=development npm run dev
```

### Check Server Health

```bash
curl http://localhost:3000/
```

Expected response:

```json
{
  "message": "Hello World!"
}
```

## 📝 Scripts

| Script        | Description                           |
| ------------- | ------------------------------------- |
| `npm start`   | Start production server               |
| `npm run dev` | Start development server with nodemon |
| `npm test`    | Run tests (not configured)            |

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Commit changes: `git commit -am 'Add new feature'`
4. Push to branch: `git push origin feature/new-feature`
5. Submit a pull request

## 📄 License

This project is licensed under the ISC License.

## 📞 Support

For issues and questions:

- Create an issue in the GitHub repository
- Email: support@bloodbridge.org

## 🙏 Acknowledgments

- Express.js team for the excellent framework
- MongoDB team for the database
- Stripe for payment processing
- All contributors to this project

---

**Built with ❤️ for BloodBridge** - Saving lives, one API call at a time. 🩸
