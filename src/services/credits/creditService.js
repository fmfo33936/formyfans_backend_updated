const mongoose = require("mongoose");
const UserCredit = require("../../models/UserCredit");
const CreditTransaction = require("../../models/CreditTransaction");
const CreditPricing = require("../../models/CreditPricing");
const logger = require("../../utils/logger");

class CreditService {
  /**
   * Retrieves or initializes the credit balance record for a user.
   */
  async getOrCreateUserCredit(userId) {
    let credit = await UserCredit.findOne({ userId });
    if (!credit) {
      credit = await UserCredit.create({
        userId,
        balance: 0,
        reserved: 0,
        totalPurchased: 0,
        totalSpent: 0,
      });
    }
    return credit;
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

    // Atomically increment reserved only if available balance >= amount
    const credit = await UserCredit.findOneAndUpdate(
      {
        userId,
        $expr: { $gte: [{ $subtract: ["$balance", "$reserved"] }, amount] },
      },
      {
        $inc: { reserved: amount },
      },
      { returnDocument: "after" }
    );

    if (!credit) {
      throw new Error("Insufficient available credit balance to reserve.");
    }

    // Log the reservation transaction
    await CreditTransaction.create({
      userId,
      transactionType: "RESERVATION",
      amount,
      balanceBefore: credit.balance,
      balanceAfter: credit.balance,
      relatedGeneration: generationId,
      status: "COMPLETED",
      description: `Reserved ${amount} credits for generation ${generationId}`,
      metadata: { reservedAmount: amount, currentReservedTotal: credit.reserved },
    });

    return credit;
  }

  /**
   * Finalizes the credit deduction after a successful generation.
   * Unreserves reservedAmount and deducts actualAmount from balance.
   */
  async finalizeDeduction(userId, reservedAmount, actualAmount, generationId, description = "AI Generation Charge") {
    const current = await this.getOrCreateUserCredit(userId);
    const balanceBefore = current.balance;

    const finalBalance = Math.max(0, current.balance - actualAmount);
    const unreservedAmount = Math.min(reservedAmount, current.reserved);
    const finalReserved = Math.max(0, current.reserved - unreservedAmount);

    const updated = await UserCredit.findOneAndUpdate(
      { userId },
      {
        $set: {
          balance: finalBalance,
          reserved: finalReserved,
        },
        $inc: {
          totalSpent: actualAmount,
        },
      },
      { returnDocument: "after" }
    );

    await CreditTransaction.create({
      userId,
      transactionType: "DEDUCTION",
      amount: -actualAmount,
      balanceBefore,
      balanceAfter: updated.balance,
      relatedGeneration: generationId,
      status: "COMPLETED",
      description: description || `Deducted ${actualAmount} credits for generation ${generationId}`,
      metadata: {
        reservedPreviously: reservedAmount,
        actualDeducted: actualAmount,
        unreservedExcess: Math.max(0, reservedAmount - actualAmount),
      },
    });

    return updated;
  }


  /**
   * Releases/refunds reserved credits in case of provider failure or timeout.
   */
  async refundCredits(userId, reservedAmount, generationId, reason = "Generation failed") {
    if (reservedAmount <= 0) return;

    const current = await this.getOrCreateUserCredit(userId);
    const balanceBefore = current.balance;

    const unreservedAmount = Math.min(reservedAmount, current.reserved);

    const updated = await UserCredit.findOneAndUpdate(
      { userId },
      {
        $inc: {
          reserved: -unreservedAmount,
        },
      },
      { returnDocument: "after" }
    );

    await CreditTransaction.create({
      userId,
      transactionType: "REFUND",
      amount: reservedAmount,
      balanceBefore,
      balanceAfter: updated.balance,
      relatedGeneration: generationId,
      status: "COMPLETED",
      description: `Released ${reservedAmount} reserved credits: ${reason}`,
      metadata: { reason, releasedReserved: reservedAmount },
    });

    return updated;
  }

  /**
   * Adds credits purchased through payment (idempotent via paymentIntentId).
   */
  async addPurchasedCredits(userId, creditsAmount, paymentIntentId, description = "Credit Purchase") {
    // Check idempotency first
    const existingTx = await CreditTransaction.findOne({
      relatedPayment: paymentIntentId,
      transactionType: "PURCHASE",
      status: "COMPLETED",
    });

    if (existingTx) {
      logger.info(`Payment ${paymentIntentId} already credited. Skipping duplicate.`);
      return await this.getOrCreateUserCredit(userId);
    }

    const current = await this.getOrCreateUserCredit(userId);
    const balanceBefore = current.balance;

    const baseBalance = Math.max(0, current.balance);
    const newBalance = baseBalance + creditsAmount;

    const updated = await UserCredit.findOneAndUpdate(
      { userId },
      {
        $set: {
          balance: newBalance,
        },
        $inc: {
          totalPurchased: creditsAmount,
        },
      },
      { returnDocument: "after", upsert: true }
    );

    await CreditTransaction.create({
      userId,
      transactionType: "PURCHASE",
      amount: creditsAmount,
      balanceBefore,
      balanceAfter: updated.balance,
      relatedPayment: paymentIntentId,
      idempotencyKey: `purchase_${paymentIntentId}`,
      status: "COMPLETED",
      description: description || `Purchased ${creditsAmount} platform credits`,
      metadata: { paymentIntentId },
    });

    // Mark AIPaymentHistory as succeeded
    try {
      const AIPaymentHistory = require("../../models/AIPaymentHistory");
      const User = require("../../models/auth");

      await AIPaymentHistory.findOneAndUpdate(
        { stripePaymentIntentId: paymentIntentId },
        {
          $set: {
            userId,
            creditsPurchased: creditsAmount,
            status: "succeeded",
            paidAt: new Date(),
          },
        },
        { upsert: true, returnDocument: "after" }
      );

      await User.findByIdAndUpdate(userId, {
        isAIPremiumActive: true,
      });
    } catch (historyErr) {
      logger.error(`Error updating AIPaymentHistory: ${historyErr.message}`);
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
      const providerCredits = Number(magicaUsage.creditUsed || 0);
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
