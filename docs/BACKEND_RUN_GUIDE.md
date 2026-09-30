# FormyFans Backend Run Guide

This guide explains how to configure and run the backend locally and in production.

## 1. Requirements

- Node.js
- npm
- Docker with Docker Compose
- MongoDB Atlas or another MongoDB replica set
- Stripe account
- AWS S3 bucket
- OpenAI API key
- Magica API key
- LiveKit credentials if live streaming is used
- SMTP account if email features are used

MongoDB transactions require a replica set. MongoDB Atlas already provides this.

## 2. Install the project

```bash
git clone <repository-url>
cd formyfans_backend_updated
npm install
```

## 3. Environment files

The backend loads:

- `.env.development` when running in development
- `.env.production` when running in production
- `.env` only as a fallback

Create the development file:

```bash
cp .env.example .env.development
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env.development
```

Create the production file on the VPS:

```bash
cp .env.example .env.production
```

Never commit real environment files or secrets.

## 4. Environment configuration

Use `.env.example` as the complete template.

### Application

Local:

```env
NODE_ENV=development
PORT=5009
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

Production:

```env
NODE_ENV=production
PORT=5009
CORS_ORIGINS=https://your-frontend.com
```

Multiple frontend origins must be separated with commas. Do not add frontend route paths.

### MongoDB

```env
MONGODB_URI=mongodb+srv://username:password@cluster.example.mongodb.net/database
MONGODB_USER=your_mongodb_user
MONGODB_PASSWORD=your_mongodb_password
```

`MONGODB_URI` is the value used to connect. `MONGODB_USER` and `MONGODB_PASSWORD` are kept for deployments that build the URI separately.

### JWT

```env
JWT_SECRET=replace_with_a_long_random_secret
```

Use a long random value in production. Changing it logs out existing users.

### Stripe

```env
STRIPE_SECRET_KEY=sk_test_replace_me
STRIPE_PUBLISHABLE_KEY=pk_test_replace_me
STRIPE_WEBHOOK_SECRET=whsec_replace_me
STRIPE_RETURN_URL=https://your-frontend.com/payment/return
STRIPE_STANDARD_PRICE_ID=price_replace_me
STRIPE_COUPON_FIRST_3_MONTHS=coupon_replace_me
```

Use Stripe test keys locally and live keys only in production. The webhook secret must belong to the backend webhook endpoint configured in Stripe.

### AWS S3

```env
AWS_BUCKET_NAME=your_aws_bucket_name
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
```

The AWS identity needs permission to read, write, and delete objects inside the application bucket.

### OpenAI

```env
OPENAI_API_KEY=your_openai_api_key
OPENAI_PROMPT_MODEL=gpt-4o-mini
OPENAI_INPUT_PRICE_PER_1M_TOKENS=0.15
OPENAI_OUTPUT_PRICE_PER_1M_TOKENS=0.60
```

The pricing values are used for provider-cost tracking. Platform credit conversion is managed through `CreditPricing`.

### Magica

```env
MAGICA_API_KEY=your_magica_api_key
MAGICA_BASE_URL=https://inference.magica.com/v1
MAGICA_IMAGE_MODEL_NODE_TYPE=flux_2_max
MAGICA_TEXT_IMAGE_SUBMODEL=flux-2-max-text
MAGICA_IMAGE_OUTPUT_FORMAT=JPEG
MAGICA_VIDEO_MODEL_NODE_TYPE=seedance_2_0_fast
MAGICA_TEXT_VIDEO_SUBMODEL=seedance-2.0-fast-text-to-video
MAGICA_IMAGE_VIDEO_SUBMODEL=seedance-2.0-fast-image-to-video
MAGICA_VIDEO_EDIT_MODEL_NODE_TYPE=kling_o3_pro_video_edit
MAGICA_POLL_INTERVAL_MS=3000
MAGICA_TIMEOUT_MS=900000
MAGICA_CREDIT_UNIT_DIVISOR=1000000
```

`MAGICA_CREDIT_UNIT_DIVISOR=1000000` converts Magica microcredits into regular provider credits.

### Redis and BullMQ

```env
REDIS_URL=redis://127.0.0.1:6379
AI_QUEUE_CONCURRENCY=100
AI_PROVIDER_START_RATE_PER_MINUTE=100
AI_JOB_LOCK_DURATION_MS=1200000
```

| Variable | Meaning |
|---|---|
| `REDIS_URL` | Address used by BullMQ and the AI rate limiter |
| `AI_QUEUE_CONCURRENCY` | Maximum AI jobs coordinated concurrently by this backend process |
| `AI_PROVIDER_START_RATE_PER_MINUTE` | Maximum new provider jobs started per minute |
| `AI_JOB_LOCK_DURATION_MS` | Worker lock duration; `1200000` is 20 minutes |

If the backend runs directly on the host and Redis runs through the included Docker Compose file, keep `REDIS_URL=redis://127.0.0.1:6379`.

### Generated output streaming

```env
AI_S3_UPLOAD_CONCURRENCY=4
```

This limits how many generated files are streamed from Magica to S3 at the same time. User input uploads still go directly from the frontend to S3 through presigned URLs.

### SMTP email

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your_smtp_user
SMTP_PASS=your_smtp_password
SMTP_FROM=no-reply@example.com
```

### LiveKit

```env
LIVEKIT_URL=wss://your-livekit-host.example.com
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
```

## 5. Start Redis with Docker

The same Redis setup is used locally and on the VPS.

```bash
npm run redis:up
npm run redis:ping
```

Expected result:

```text
PONG
```

Other Redis commands:

```bash
npm run redis:logs
npm run redis:down
```

Redis data is stored in the persistent `formyfans-redis-data` Docker volume. The Redis port is bound only to `127.0.0.1`, so it is not publicly exposed.

## 6. Run locally

1. Complete `.env.development`.
2. Start Redis.
3. Start the backend.

```bash
npm run redis:up
npm run redis:ping
npm run dev
```

The default API URL is:

```text
http://localhost:5009/api
```

Health check:

```text
GET http://localhost:5009/api/test
```

Expected response:

```json
{
  "message": "API is working..."
}
```

## 7. Run in production on a VPS

### Install dependencies

```bash
npm ci --omit=dev
```

### Configure production environment

Create and complete `.env.production`:

```env
NODE_ENV=production
PORT=5009
CORS_ORIGINS=https://your-frontend.com
REDIS_URL=redis://127.0.0.1:6379
```

Also fill in all MongoDB, JWT, Stripe, AWS, OpenAI, Magica, SMTP, and LiveKit values described above.

### Start Redis

```bash
npm run redis:up
npm run redis:ping
```

### Start the backend directly

```bash
npm start
```

### Start with PM2

```bash
npm install -g pm2
pm2 start npm --name formyfans-backend -- start
pm2 save
pm2 startup
```

Run the command printed by `pm2 startup`, then run `pm2 save` again.

Useful PM2 commands:

```bash
pm2 status
pm2 logs formyfans-backend
pm2 restart formyfans-backend
```

## 8. Reverse proxy

In production, place Nginx, Caddy, or Cloudflare Tunnel in front of port `5009` and enable HTTPS.

The frontend API base URL must not end with an extra slash:

```env
VITE_API_URL=https://api.your-domain.com
```

Correct request:

```text
https://api.your-domain.com/api/auth/login-user
```

Incorrect request:

```text
https://api.your-domain.com//api/auth/login-user
```

## 9. Frontend connection requirements

The frontend must send the JWT when connecting to Socket.IO:

```js
const socket = io(BACKEND_URL, {
  auth: {
    token: `Bearer ${accessToken}`,
  },
});
```

AI reference images and videos must use the presigned upload endpoint. The old Base64 direct-upload endpoint is no longer available.

## 10. Startup checklist

Before starting the backend, confirm:

- MongoDB connection works.
- `redis-cli ping` through `npm run redis:ping` returns `PONG`.
- Stripe webhook secret matches the configured Stripe endpoint.
- The S3 bucket and IAM permissions are correct.
- OpenAI and Magica keys are valid.
- `CORS_ORIGINS` contains the exact frontend origin.
- Production secrets are stored only in `.env.production` or a secret manager.

## 11. Common problems

### Redis connection error

```bash
npm run redis:up
npm run redis:ping
```

Confirm:

```env
REDIS_URL=redis://127.0.0.1:6379
```

### Browser CORS error

Add the exact frontend origin:

```env
CORS_ORIGINS=http://localhost:5173,https://your-frontend.com
```

Restart the backend after changing environment variables.

### Socket authentication error

Make sure the frontend sends the user JWT in `socket.auth.token`.

### AI requests return `503`

Check Redis and BullMQ first. The backend releases reserved credits when a job cannot be queued.

### MongoDB transaction error

Use MongoDB Atlas or another replica-set deployment. Standalone MongoDB does not support the transactions used by the credit and AI generation flows.
