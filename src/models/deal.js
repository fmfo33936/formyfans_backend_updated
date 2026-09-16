const mongoose = require("mongoose");
const { Schema } = mongoose;

/*
  DEAL FLOW / STATUS LOGIC:

  1. Sender creates a deal -> status: "pending"
  2. Receiver sees the "pending" deal -> can "accept" or "reject" it
     - accept -> status: "accepted"
     - reject -> status: "rejected"
  3. Sender, after sending the deal (only while it's still "pending")
     -> can "cancel" or "pause" it
     - cancel -> status: "cancelled" (receiver only sees "cancelled", accept/reject options disappear)
     - pause  -> status: "paused"    (receiver sees "Deal paused by sender", accept/reject options disappear)
  4. Sender can "resume" a paused deal -> status goes back to "pending"
     (so the receiver can accept/reject again)
  5. Once accepted, sender pays (platform collects the payment) -> status: "started"
  6. Receiver creates content, bumping each deliverable's completed count,
     until every deliverable's completed count matches its required count.
  7. Receiver requests completion -> status: "verifying"
     (only allowed once ALL deliverables are fully fulfilled)
  8. Sender reviews the work and verifies it:
     - approve -> status: "completed" -> sender can now leave a review
     - reject  -> status: "incomplete" -> receiver can address the issue
       and request completion again (back to "verifying")

  IMPORTANT:
  - accept/reject only allowed when status === "pending"
  - payment only allowed when status === "accepted"
  - content can only be linked to a deal when status === "started"
  - requestCompletion only allowed when status === "started" (or "incomplete"
    to resubmit) AND all deliverables are fully fulfilled (receiver only)
  - verifyCompletion only allowed when status === "verifying" (sender only)
  - adminVerifyIncomplete only allowed when status === "incomplete" (admin only)
  - review only allowed when status === "completed" (sender only)
*/

const DEAL_STATUS = {
  PENDING: "pending", // sent, waiting for receiver's response
  ACCEPTED: "accepted", // receiver accepted, waiting for sender's payment
  STARTED: "started", // sender paid, work in progress
  VERIFYING: "verifying", // receiver requested completion, awaiting sender's verification
  COMPLETED: "completed", // sender verified the work is done
  INCOMPLETE: "incomplete", // sender rejected the completion request - receiver must fix and resubmit
  REJECTED: "rejected", // receiver rejected
  CANCELLED: "cancelled", // sender cancelled (final, receiver only sees "cancelled")
  PAUSED: "paused", // sender paused (temporary, receiver sees "paused by sender")
};

const deliverableSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["post", "reel", "stream", "story"],
      required: true,
    },
    count: {
      type: Number,
      default: 0,
    },
    completed: {
      type: Number,
      default: 0,
    },
  },
  { _id: false },
);

const dealSchema = new Schema(
  {
    sender: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    receiver: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    title: {
      type: String,
      required: true,
      minLength: 3,
      maxLength: 100,
      trim: true,
    },
    brand: {
      type: String,
      required: true,
      minLength: 3,
      maxLength: 100,
      trim: true,
    },
    description: {
      type: String,
      minLength: 10,
      maxLength: 300,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: "USD",
    },
    paymentType: {
      type: String,
      enum: ["one-time"],
      default: "one-time",
    },
    deliverables: {
      type: [deliverableSchema],
      required: true,
    },
    deadline: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(DEAL_STATUS),
      default: DEAL_STATUS.PENDING,
    },
    // status history - tracks who did what action and when
    statusHistory: [
      {
        status: {
          type: String,
          enum: Object.values(DEAL_STATUS),
        },
        changedBy: {
          type: Schema.Types.ObjectId,
          ref: "users",
        },
        changedAt: {
          type: Date,
          default: Date.now,
        },
        note: String,
      },
    ],
    isRecieverPaid: { type: Boolean, default: false },
    paidAmount: {
      type: Number,
      default: 0,
    },
    paidAt: Date,
    transferId: String,
    respondedAt: Date, // when receiver accepted/rejected
    cancelledAt: Date, // when sender cancelled
    pausedAt: Date, // when sender paused
    startedAt: Date, // when sender's payment succeeded (deal moved to "started")
    completionRequestedAt: Date, // when receiver last requested completion
    verifiedAt: Date, // when sender approved/rejected the completion request
    completedAt: Date, // when sender approved and the deal became "completed"

    // ---- Payment fields (sender -> platform) ----
    paymentIntentId: { type: String, index: true },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded", "disputed"],
      default: "pending",
    },

    // ---- Review (sender reviews receiver, once deal is completed) ----
    review: {
      type: Schema.Types.ObjectId,
      ref: "Review",
    },
    isReviewed: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true, collection: "deal" },
);

// ---------- Helper instance methods ----------

// Receiver accepts the deal
dealSchema.methods.acceptDeal = function (userId) {
  if (this.status !== DEAL_STATUS.PENDING) {
    throw new Error(`Deal cannot be accepted. Current status: ${this.status}`);
  }
  this.status = DEAL_STATUS.ACCEPTED;
  this.respondedAt = new Date();
  this.statusHistory.push({ status: DEAL_STATUS.ACCEPTED, changedBy: userId });
  return this.save();
};

// Receiver rejects the deal
dealSchema.methods.rejectDeal = function (userId, note) {
  if (this.status !== DEAL_STATUS.PENDING) {
    throw new Error(`Deal cannot be rejected. Current status: ${this.status}`);
  }
  this.status = DEAL_STATUS.REJECTED;
  this.respondedAt = new Date();
  this.statusHistory.push({
    status: DEAL_STATUS.REJECTED,
    changedBy: userId,
    note,
  });
  return this.save();
};

// Sender cancels the deal (only allowed while pending or paused)
dealSchema.methods.cancelDeal = function (userId, note) {
  if (
    this.status !== DEAL_STATUS.PENDING &&
    this.status !== DEAL_STATUS.PAUSED
  ) {
    throw new Error(`Deal cannot be cancelled. Current status: ${this.status}`);
  }
  this.status = DEAL_STATUS.CANCELLED;
  this.cancelledAt = new Date();
  this.statusHistory.push({
    status: DEAL_STATUS.CANCELLED,
    changedBy: userId,
    note,
  });
  return this.save();
};

// Sender pauses the deal (only allowed while pending)
dealSchema.methods.pauseDeal = function (userId) {
  if (this.status !== DEAL_STATUS.PENDING) {
    throw new Error(`Deal cannot be paused. Current status: ${this.status}`);
  }
  this.status = DEAL_STATUS.PAUSED;
  this.pausedAt = new Date();
  this.statusHistory.push({ status: DEAL_STATUS.PAUSED, changedBy: userId });
  return this.save();
};

// Sender resumes a paused deal -> receiver can accept/reject again
dealSchema.methods.resumeDeal = function (userId) {
  if (this.status !== DEAL_STATUS.PAUSED) {
    throw new Error(
      `Only paused deals can be resumed. Current status: ${this.status}`,
    );
  }
  this.status = DEAL_STATUS.PENDING;
  this.pausedAt = null;
  this.statusHistory.push({
    status: DEAL_STATUS.PENDING,
    changedBy: userId,
    note: "resumed",
  });
  return this.save();
};

// Sender's payment succeeded -> deal moves from "accepted" to "started"
dealSchema.methods.startDeal = function (userId, paymentIntentId) {
  if (this.status !== DEAL_STATUS.ACCEPTED) {
    throw new Error(`Deal cannot be started. Current status: ${this.status}`);
  }
  this.status = DEAL_STATUS.STARTED;
  this.startedAt = new Date();
  this.paymentIntentId = paymentIntentId;
  this.paymentStatus = "paid";
  this.statusHistory.push({
    status: DEAL_STATUS.STARTED,
    changedBy: userId,
    note: "payment received, work started",
  });
  return this.save();
};

// Helper: are ALL deliverables fully fulfilled? e.g. 3/3 posts AND 3/3 reels
dealSchema.methods.areDeliverablesComplete = function () {
  return this.deliverables.every((d) => d.completed >= d.count);
};

// Receiver requests completion -> status: "verifying" (awaiting sender's
// confirmation). Allowed from "started" (first request) or "incomplete"
// (resubmitting after the sender previously rejected it). ALWAYS requires
// every deliverable to be fully fulfilled first.
dealSchema.methods.requestCompletion = function (userId) {
  if (
    this.status !== DEAL_STATUS.STARTED &&
    this.status !== DEAL_STATUS.INCOMPLETE
  ) {
    throw new Error(
      `Completion cannot be requested. Current status: ${this.status}`,
    );
  }

  if (!this.areDeliverablesComplete()) {
    const remaining = this.deliverables
      .filter((d) => d.completed < d.count)
      .map((d) => `${d.completed}/${d.count} ${d.type}`)
      .join(", ");
    throw new Error(
      `All deliverables must be fulfilled before requesting completion. Still remaining: ${remaining}`,
    );
  }

  this.status = DEAL_STATUS.VERIFYING;
  this.completionRequestedAt = new Date();
  this.statusHistory.push({
    status: DEAL_STATUS.VERIFYING,
    changedBy: userId,
    note: "receiver requested completion, awaiting sender's verification",
  });
  return this.save();
};

// Sender verifies the receiver's completion request.
// approved = true  -> status: "completed", sender can now leave a review
// approved = false -> status: "incomplete", receiver can fix and resubmit
dealSchema.methods.verifyCompletion = function (userId, approved, note) {
  if (this.status !== DEAL_STATUS.VERIFYING) {
    throw new Error(
      `There is no completion request to verify. Current status: ${this.status}`,
    );
  }

  this.verifiedAt = new Date();

  if (approved) {
    this.status = DEAL_STATUS.COMPLETED;
    this.completedAt = new Date();
    this.statusHistory.push({
      status: DEAL_STATUS.COMPLETED,
      changedBy: userId,
      note: note || "sender verified the work as complete",
    });
  } else {
    this.status = DEAL_STATUS.INCOMPLETE;
    this.statusHistory.push({
      status: DEAL_STATUS.INCOMPLETE,
      changedBy: userId,
      note: note || "sender rejected the completion request",
    });
  }

  return this.save();
};

// Admin overrides sender's "incomplete" decision after manual review.
dealSchema.methods.adminMarkIncompleteAsComplete = function (adminId, note) {
  if (this.status !== DEAL_STATUS.INCOMPLETE) {
    throw new Error(
      `Only incomplete deals can be verified by admin. Current status: ${this.status}`,
    );
  }

  this.status = DEAL_STATUS.COMPLETED;
  this.verifiedAt = new Date();
  this.completedAt = new Date();
  this.statusHistory.push({
    status: DEAL_STATUS.COMPLETED,
    changedBy: adminId,
    note:
      note ||
      "admin verified the deal as complete after sender marked it incomplete",
  });

  return this.save();
};

// A new post/reel/stream/story was created against this deal -> bump that
// deliverable's completed count (only allowed while the deal is "started")
dealSchema.methods.registerDeliverable = function (contentType) {
  if (this.status !== DEAL_STATUS.STARTED) {
    throw new Error(
      `Content can only be linked to a deal that is in progress. Current status: ${this.status}`,
    );
  }

  const deliverable = this.deliverables.find((d) => d.type === contentType);
  if (!deliverable) {
    throw new Error(`This deal has no "${contentType}" deliverable`);
  }
  if (deliverable.completed >= deliverable.count) {
    throw new Error(
      `All "${contentType}" deliverables for this deal are already fulfilled`,
    );
  }

  deliverable.completed += 1;
  return this.save();
};

// Sender leaves a review (only once deal is completed, only once ever)
dealSchema.methods.addReview = async function (reviewId, session) {
  if (this.status !== DEAL_STATUS.COMPLETED) {
    throw new Error("Review can only be added once the deal is completed");
  }

  if (this.isReviewed) {
    throw new Error("Review already submitted for this deal");
  }

  this.review = reviewId;
  this.isReviewed = true;

  return this.save({ session });
};

const Deal = mongoose.model("Deal", dealSchema);

module.exports = Deal;
module.exports.DEAL_STATUS = DEAL_STATUS;