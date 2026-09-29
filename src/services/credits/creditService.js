const mongoose = require("mongoose");
const UserCredit = require("../../models/UserCredit");
const CreditTransaction = require("../../models/CreditTransaction");
const CreditPricing = require("../../models/CreditPricing");
const AIPaymentHistory = require("../../models/AIPaymentHistory");
const User = require("../../models/auth");
const logger = require("../../utils/logger");

class CreditService {
  /**
   * Retrieves or initializes the credit balance record for a user.
   */
  async getOrCreateUserCredit(userId) {
    return UserCredit.findOneAndUpdate(
      { userId },
      { $setOnInsert: { balance: 0, reserved: 0, totalPurchased: 0, totalSpent: 0 } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );
  }

  /**
   * Checks if user has enough available credits (balance - reserved).
   */
  async hasSufficientCredits(userId, requiredCredits) {
    const credit = await this.getOrCreateUserCredit(userId);
    const available = Math.max(0, credit.balance - credit.reserved);
    return available >= requiredCredits;
  }

  /**
   * Reserves credits for an in-flight generation.
   * Atomic operation using findOneAndUpdate with condition available >= amount.
   */
  async reserveCredits(userId, amount, generationId) {
    if (amount <= 0) return true;
    let credit;
    try {
      await mongoose.connection.transaction(async (session) => {
        credit = await UserCredit.findOneAndUpdate(
          {
            userId,
            $expr: { $gte: [{ $subtract: ["$balance", "$reserved"] }, amount] },
          },
          { $inc: { reserved: amount } },
          { returnDocument: "after", session }
        );
        if (!credit) throw new Error("Insufficient available credit balance to reserve.");

        await CreditTransaction.create([{
          userId,
          transactionType: "RESERVATION",
          amount,
          balanceBefore: credit.balance,
          balanceAfter: credit.balance,
          relatedGeneration: generationId,
          idempotencyKey: `reservation_${generationId}`,
          status: "COMPLETED",
          description: `Reserved ${amount} credits for generation ${generationId}`,
          metadata: { reservedAmount: amount, currentReservedTotal: credit.reserved },
        }], { session });
      });
    } catch (error) {
      if (error?.code === 11000) return this.getOrCreateUserCredit(userId);
      throw error;
    }
    return credit;
  }

  /**
   * Finalizes the credit deduction after a successful generation.
   * Unreserves reservedAmount and deducts actualAmount from balance.
   */
  async finalizeDeduction(userId, reservedAmount, actualAmount, generationId, description = "AI Generation Charge", session = null) {
    const updated = await UserCredit.findOneAndUpdate(
      {
        userId,
        reserved: { $gte: reservedAmount },
        $expr: {
          $gte: [
            { $subtract: ["$balance", "$reserved"] },
            Math.max(0, actualAmount - reservedAmount),
          ],
        },
      },
      {
        $inc: {
          balance: -actualAmount,
          reserved: -reservedAmount,
          totalSpent: actualAmount,
        },
      },
      { returnDocument: "before", session }
    );
    if (!updated) throw new Error("Insufficient credits to settle generation charge");
    const balanceBefore = updated.balance;

    await CreditTransaction.create([{
      userId,
      transactionType: "DEDUCTION",
      amount: -actualAmount,
      balanceBefore,
      balanceAfter: balanceBefore - actualAmount,
      relatedGeneration: generationId,
      idempotencyKey: `deduction_${generationId}`,
      status: "COMPLETED",
      description: description || `Deducted ${actualAmount} credits for generation ${generationId}`,
      metadata: {
        reservedPreviously: reservedAmount,
        actualDeducted: actualAmount,
        unreservedExcess: Math.max(0, reservedAmount - actualAmount),
      },
    }], { session });

    return { balance: balanceBefore - actualAmount, reserved: updated.reserved - reservedAmount };
  }


  /**
   * Releases/refunds reserved credits in case of provider failure or timeout.
   */
  async refundCredits(userId, reservedAmount, generationId, reason = "Generation failed") {
    if (reservedAmount <= 0) return;
    let updated;
    try {
      await mongoose.connection.transaction(async (session) => {
        const current = await UserCredit.findOne({ userId }).session(session);
        if (!current) return;
        const released = Math.min(reservedAmount, current.reserved);
        if (released <= 0) return;

        updated = await UserCredit.findOneAndUpdate(
          { userId, reserved: { $gte: released } },
          { $inc: { reserved: -released } },
          { returnDocument: "after", session }
        );
        await CreditTransaction.create([{
          userId,
          transactionType: "REFUND",
          amount: released,
          balanceBefore: current.balance,
          balanceAfter: current.balance,
          relatedGeneration: generationId,
          idempotencyKey: `refund_${generationId}`,
          status: "COMPLETED",
          description: `Released ${released} reserved credits: ${reason}`,
          metadata: { reason, releasedReserved: released },
        }], { session });
      });
    } catch (error) {
      if (error?.code === 11000) return this.getOrCreateUserCredit(userId);
      throw error;
    }
    return updated;
  }

  /**
   * Adds credits purchased through payment (idempotent via paymentIntentId).
   */
  async addPurchasedCredits(userId, creditsAmount, paymentIntentId, description = "Credit Purchase") {
    await this.getOrCreateUserCredit(userId);
    let updated;

    try {
      await mongoose.connection.transaction(async (session) => {
        const current = await UserCredit.findOne({ userId }).session(session);
        if (!current) throw new Error("Credit account not found");

        await CreditTransaction.create([{
          userId,
          transactionType: "PURCHASE",
          amount: creditsAmount,
          balanceBefore: current.balance,
          balanceAfter: current.balance + creditsAmount,
          relatedPayment: paymentIntentId,
          idempotencyKey: `purchase_${paymentIntentId}`,
          status: "COMPLETED",
          description: description || `Purchased ${creditsAmount} platform credits`,
          metadata: { paymentIntentId },
        }], { session });

        updated = await UserCredit.findOneAndUpdate(
          { userId },
          { $inc: { balance: creditsAmount, totalPurchased: creditsAmount } },
          { returnDocument: "after", session }
        );

        await AIPaymentHistory.updateOne(
          { stripePaymentIntentId: paymentIntentId },
          { $set: { status: "succeeded", paidAt: new Date() } },
          { session }
        );
        await User.updateOne(
          { _id: userId },
          { $set: { isAIPremiumActive: true } },
          { session }
        );
      });
    } catch (error) {
      if (error?.code === 11000) {
        logger.info(`Payment ${paymentIntentId} was already credited.`);
        return this.getOrCreateUserCredit(userId);
      }
      throw error;
    }

    return updated;
  }


  /**
   * Calculates platform credits from OpenAI token usage and Magica provider usage.
   */
  async calculatePlatformCredits({ openaiUsage = null, magicaUsage = null, generationType = "IMAGE" }) {
    const pricing = await CreditPricing.getActivePricing();

    let openaiCredits = 0;
    let magicaCredits = 0;

    if (openaiUsage) {
      const inputCredits = ((openaiUsage.inputTokens || 0) / 1000) * pricing.openaiInputCreditsPer1kTokens;
      const outputCredits = ((openaiUsage.outputTokens || 0) / 1000) * pricing.openaiOutputCreditsPer1kTokens;
      openaiCredits = (inputCredits + outputCredits) * pricing.profitMarginMultiplier;
    }

    if (magicaUsage) {
      let providerCredits = Number(magicaUsage.creditUsed || 0);
      // Magica API returns creditUsed in micro-units when > 1000 (e.g. 1,209,500 = ~1.2095 credits/USD)
      if (providerCredits > 1000) {
        providerCredits = providerCredits / 1000000;
      }
      magicaCredits = providerCredits * pricing.magicaCreditMultiplier * pricing.profitMarginMultiplier;
    }

    const total = Math.ceil(openaiCredits + magicaCredits);

    // Apply minimum floor according to generation type
    let minCredits = pricing.imageReservationCredits;
    if (generationType === "VIDEO") minCredits = pricing.videoReservationCredits;
    if (generationType === "VIDEO_EDIT") minCredits = pricing.videoEditReservationCredits;

    return Math.max(total, minCredits);
  }

  /**
   * Returns base credits required to reserve for a given generation type.
   */
  async getRequiredReservationCredits(generationType) {
    const pricing = await CreditPricing.getActivePricing();
    switch (generationType) {
      case "VIDEO":
        return pricing.videoReservationCredits;
      case "VIDEO_EDIT":
        return pricing.videoEditReservationCredits;
      case "IMAGE":
      default:
        return pricing.imageReservationCredits;
    }
  }
}

module.exports = new CreditService();
