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
    try {
      return await UserCredit.findOneAndUpdate(
        { userId },
        { $setOnInsert: { balance: 0, reserved: 0, totalPurchased: 0, totalSpent: 0 } },
        { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
      );
    } catch (error) {
      if (error?.code === 11000) return UserCredit.findOne({ userId });
      throw error;
    }
  }

  /**
   * Checks if user has enough available credits (balance - reserved).
   */
  async hasSufficientCredits(userId, requiredCredits) {
    const credit = await this.getOrCreateUserCredit(userId);
    const available = Math.max(0, credit.balance - credit.reserved);
    return !credit.frozen && available >= requiredCredits;
  }

  /**
   * Reserves credits for an in-flight generation.
   * Atomic operation using findOneAndUpdate with condition available >= amount.
   */
  async reserveCredits(userId, amount, generationId, externalSession = null) {
    if (amount <= 0) return true;
    let credit;
    const reserve = async (session) => {
      credit = await UserCredit.findOneAndUpdate(
          {
            userId,
            frozen: { $ne: true },
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
    };
    try {
      if (externalSession) await reserve(externalSession);
      else await mongoose.connection.transaction(reserve);
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
    let released = 0;
    try {
      await mongoose.connection.transaction(async (session) => {
        const alreadySettled = await CreditTransaction.exists({
          relatedGeneration: generationId,
          transactionType: { $in: ["DEDUCTION", "REFUND"] },
          status: "COMPLETED",
        }).session(session);
        if (alreadySettled) return;

        const current = await UserCredit.findOne({ userId }).session(session);
        if (!current) return;
        released = Math.min(reservedAmount, current.reserved);
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
      if (error?.code === 11000) return null;
      throw error;
    }
    return released > 0 ? { credit: updated, released } : null;
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
        const payment = await AIPaymentHistory.findOne({ stripePaymentIntentId: paymentIntentId }).session(session);
        if (!payment) throw new Error("AI credit payment record not found");
        if (["refunded", "disputed"].includes(payment.status)) {
          updated = current;
          return;
        }

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

  async reversePurchasedCredits(paymentIntentId, status) {
    const payment = await AIPaymentHistory.findOne({ stripePaymentIntentId: paymentIntentId });
    if (!payment || ["refunded", "disputed"].includes(payment.status)) return null;

    if (payment.status !== "succeeded") {
      await AIPaymentHistory.updateOne(
        { _id: payment._id },
        { $set: { status, [`metadata.${status}At`]: new Date() } }
      );
      return null;
    }

    let result;
    await mongoose.connection.transaction(async (session) => {
      const credit = await UserCredit.findOne({ userId: payment.userId }).session(session);
      if (!credit) return;
      const available = Math.max(0, credit.balance - credit.reserved);
      const recovered = Math.min(payment.creditsPurchased, available);
      const shortfall = payment.creditsPurchased - recovered;

      result = await UserCredit.findOneAndUpdate(
        { _id: credit._id },
        {
          $inc: { balance: -recovered, totalPurchased: -Math.min(payment.creditsPurchased, credit.totalPurchased) },
          $set: {
            frozen: shortfall > 0,
            freezeReason: shortfall > 0 ? `${status} payment has ${shortfall} spent credits to review` : null,
          },
        },
        { returnDocument: "after", session }
      );
      await CreditTransaction.create([{
        userId: payment.userId,
        transactionType: "ADJUSTMENT",
        amount: -recovered,
        balanceBefore: credit.balance,
        balanceAfter: credit.balance - recovered,
        relatedPayment: paymentIntentId,
        idempotencyKey: `${status}_${paymentIntentId}`,
        status: "COMPLETED",
        description: `${status} AI credit purchase reversal`,
        metadata: { purchasedCredits: payment.creditsPurchased, recovered, shortfall },
      }], { session });
      await AIPaymentHistory.updateOne(
        { _id: payment._id },
        { $set: { status, [`metadata.${status}At`]: new Date(), "metadata.recoveredCredits": recovered,
          "metadata.creditShortfall": shortfall } },
        { session }
      );
    });
    return result;
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
      const divisor = Math.max(1, Number(process.env.MAGICA_CREDIT_UNIT_DIVISOR) || 1000000);
      const providerCredits = Number(magicaUsage.creditUsed || 0) / divisor;
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
  async getRequiredReservationCredits(generationType, settings = {}) {
    const pricing = await CreditPricing.getActivePricing();
    let baseCredits;
    switch (generationType) {
      case "VIDEO":
        baseCredits = pricing.videoReservationCredits;
        break;
      case "VIDEO_EDIT":
        baseCredits = pricing.videoEditReservationCredits;
        break;
      case "IMAGE":
      default:
        baseCredits = pricing.imageReservationCredits;
    }
    const durationFactor = generationType === "VIDEO"
      ? Math.max(1, Number(settings.duration || 10) / 5)
      : 1;
    const resolutionFactor = settings.resolution === "1080p" ? 1.5 : settings.resolution === "720p" ? 1.25 : 1;
    const safetyMultiplier = pricing.reservationSafetyMultiplier || 2;
    return Math.ceil(baseCredits * durationFactor * resolutionFactor * safetyMultiplier);
  }
}

module.exports = new CreditService();
