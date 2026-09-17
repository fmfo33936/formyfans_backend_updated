# Project Overview: FormyFans Backend

This project is a backend platform for **FormyFans**, a creator economy social platform supporting creator subscriptions, fan interactions, posts/stories/exclusive VIP content, merchandise shop orders, live streaming (LiveKit WebRTC), brand sponsorship deals with milestone escrow, and payouts via Stripe Connect.

## Technology Stack
- **Framework**: Express.js (v5) on Node.js (CommonJS)
- **Database & ODM**: MongoDB with Mongoose (v9)
- **Validation**: Joi schema validation with `schemaValidator`
- **Authentication**: JWT-based with role-based access control (RBAC: `user`, `creator`, `admin`)
- **File Upload**: AWS S3 SDK v3 presigned PUT URLs (`PutObjectCommand` via `@aws-sdk/client-s3`)
- **Payment & Escrow**: Stripe (PaymentIntents, SetupIntents, Stripe Connect accounts, Payouts, Webhooks)
- **Real-time & Live**: Socket.io (chat, notifications) + LiveKit WebRTC (live streaming)
- **Background Jobs**: Node-cron (scheduled posts publication, expiring post boosts)

---

## Key Patterns

### 1. Module Structure
Code is organized under `src/`:
- `src/routes/`: Route definitions and middleware mapping (30 routers mounted under `/api` in `src/routes/index.js` and `/api/upload` in `src/awsConfig/upload.js`).
- `src/controllers/`: HTTP request handlers containing business logic and database interactions.
- `src/models/`: Mongoose schemas and models (40 models).
- `src/middlewares/`: Authorization middlewares (`verifyUser`, `verifyAdmin`, `verifyContentCreator`, `verifyVerifiedContentCreator`).
- `src/utils/`: Stripe helpers, email service, Winston logger, Joi validator helper (`validator.js`), schema definitions (`validations.js`).
- `src/jobs/`: Automated cron jobs (`publishScheduledPosts.js`, `expireBoosts.js`).
- `src/socket/`: Socket.io connection handlers (`socket.js`).

### 2. Validation Pattern
- **Helper**: Uses `schemaValidator(req.body, schema)` from `src/utils/validator.js`.
- **Schemas**: Joi validation schemas centralized in `src/utils/validations.js`.

### 3. Authentication & Authorization (RBAC)
- **Bearer JWT**: Tokens passed in `Authorization: Bearer <token>`.
- **`verifyUser`**: Authenticates user JWT, verifies account active status, sets `req.user`.
- **`verifyAdmin`**: Authenticates admin JWT, sets `req.admin`.
- **`verifyContentCreator`**: Ensures authenticated user has role `creator`.
- **`verifyVerifiedContentCreator`**: Ensures creator is verified.

### 4. Response Handling
- Success responses return JSON with status code 200/201: `{ message, token, user, ... }` or `{ success: true, data }`.
- Error responses handled uniformly by global error middleware in `src/app.js`.

---

## Core Models
- **User (`UserModel`)**: User/creator profile, credentials, role (`user`, `creator`), subscription status, balances.
- **Admin (`Admin`)**: Admin portal credentials, dashboard stats access, platform moderation.
- **Post (`PostModel`)**: Feed posts, scheduled posts, media attachments, captions, taggable users, like/comment counts.
- **Story (`StoryModel`)**: 24-hour ephemeral video/photo stories.
- **ExclusiveContent**: Subscriber-only VIP creator content and media drops.
- **Product & Order**: Creator merchandise catalog, shopping cart (`CartModel`), Stripe order checkout, fulfillment tracking.
- **Deal (`DealModel`)**: Brand sponsorship contracts with milestone stages (`pending` ➔ `accepted` ➔ `started`/escrow ➔ `completed` ➔ `reviewed`).
- **LiveStream (`LiveStreamModel`)**: Live broadcasts with LiveKit room tokens, real-time chat, and fanbug tipping.
- **Subscriptions**: Platform subscriptions (`SubscriptionPlans`, `UserSubscription`) and direct creator fan subscriptions (`FanSubscription`).
- **Payout**: Stripe Connect onboarding, creator balance redemption, deal and stream earnings withdrawal.

---

## Development Patterns & Runtime
- **Dev Server**: `npm run dev` (starts `nodemon server.js` using `.env.development`).
- **Default Port**: `5009` (configured in `.env.development`).
- **Base Route**: `http://localhost:5009/api`.
- **Cron Jobs**: Run automatically in `server.js` on database connection (`publishScheduledPosts`, `expireBoosts`).

---

## Postman API Collection
- **File**: `FormyFans_API_Complete.postman_collection.json` (212 endpoints across 18 numbered modules).
- **Generator Script**: `scripts/generate-postman-collection.js` (`node scripts/generate-postman-collection.js` to rebuild).
- **Variables**:
  - `baseUrl`: `http://localhost:5009/api` (All routes: `{{baseUrl}}/...`).
  - `userToken`: Automatically captured and set by post-response script on User Login, Register, Verify OTP.
  - `adminToken`: Automatically captured and set on Admin Login / Create.
  - `userId`, `creatorId`, `adminId`: Dynamic identifiers for testing workflows.

---

## Context & Token Optimization: Caveman + Graphify

### Caveman Mode (Output Token Reduction)
- **High Signal, Zero Fluff**: Strip pleasantries, conversational filler, and verbose intros/outros.
- **Telegraphic**: Deliver concise bullets and exact action steps.
- **Integrity**: Keep code, diffs, file paths, and syntax 100% complete and valid.
- **Saves**: 65%–75% output tokens.

### Graphify Knowledge Graph (Input Token Reduction)
- **Files**:
  - `graphify-out/GRAPH_REPORT.md` (Human-readable knowledge graph summary, god nodes, community hubs).
  - `graphify-out/graph.json` (GraphRAG-ready graph data).
  - `graphify-out/graph.html` (Interactive 3D visualization).
- **Agent Rule**: Query `graphify-out/GRAPH_REPORT.md` first before reading raw source files. Slashes context retrieval tokens by up to 70x.

### How to Update Graphify
Whenever files are added, modified, or deleted:

1. **Incremental Update (Fastest - only changed files)**:
   ```bash
   python -m graphify update .
   ```
2. **Full AST Re-scan & Re-clustering (Complete re-indexing)**:
   ```bash
   python -m graphify extract . --code-only --force
   python -m graphify cluster-only .
   ```
3. **Generate Interactive Visualization**:
   ```bash
   python -m graphify export html
   ```
4. **Query the Graph**:
   ```bash
   python -m graphify query "How does creator subscription payment work?"
   ```
