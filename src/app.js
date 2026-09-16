const express = require("express");
const logger = require("./utils/logger");
const routes = require("./routes");
const { handleStripeWebhook } = require("./controllers/stripe");
const { handleBoostWebhook } = require("./controllers/boost");
const cors = require("cors");
const app = express();
const presignedUrlRoutes = require("./awsConfig/upload");
app.post(
  "/api/webhook",
  express.raw({ type: "application/json" }),
  handleStripeWebhook,
);
// Boost webhook MUST use raw body parsing (express.raw) — the global JSON
// body parser would mangle the payload and break signature verification.
app.post(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json" }),
  handleBoostWebhook,
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cors());

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
  });
  next();
});

app.get("/api/test", (req, res) => {
  res.send({ message: "API is working!" });
});

app.use("/api/upload", presignedUrlRoutes);
app.use("/api", routes);



app.use((err, req, res, next) => {
  logger.error(`${err.message} - ${req.method} ${req.originalUrl}`);
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    data: null,
    message: statusCode === 500 ? "Something went wrong" : err.message,
  });
});

module.exports = app;
