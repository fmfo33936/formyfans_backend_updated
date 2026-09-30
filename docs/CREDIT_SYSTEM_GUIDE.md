# FormyFans AI Credit System Guide

This guide explains the AI credit system in simple terms. It also explains what changes when an administrator updates the credit pricing settings.

## 1. The basic idea

Users buy platform credits with Stripe. Those credits are used for:

- AI image generation
- AI video generation
- AI video editing
- AI prompt refinement usage that is included in a generation

Each user has three important credit values:

| Value | Meaning |
|---|---|
| `balance` | The total credits currently owned by the user |
| `reserved` | Credits temporarily held for AI jobs that are still running |
| Available credits | `balance - reserved` |

Example:

```text
Balance: 100
Reserved: 25
Available: 75
```

## 2. What happens during an AI generation

### Step 1: Calculate the reservation

Before a generation starts, the system calculates a safe reservation amount.

```text
Reserved credits =
base reservation × duration factor × resolution factor × safety multiplier
```

### Step 2: Reserve credits

The calculated credits are temporarily reserved. They are not permanently charged yet.

If the user does not have enough available credits, the generation does not start.

### Step 3: Run the generation

The generation is added to Redis/BullMQ and processed by the AI provider.

### Step 4: Calculate the final charge

After the provider finishes, the system calculates the actual charge from:

- OpenAI token usage
- Magica microcredit usage
- Platform pricing multipliers
- Minimum charge for the generation type

### Step 5: Settle the credits

- The actual charge is deducted from the balance.
- Unused reserved credits are released.
- If generation fails, the reservation is released.

Example:

```text
Reserved before generation: 25 credits
Final charge: 18 credits
Deducted: 18 credits
Released: 7 credits
```

## 3. Reservation calculation

### Duration factor

The duration factor currently applies to normal video generation.

| Duration | Factor |
|---:|---:|
| 5 seconds | 1 |
| 10 seconds | 2 |
| 15 seconds | 3 |

### Resolution factor

| Resolution | Factor |
|---|---:|
| 480p | 1 |
| 720p | 1.25 |
| 1080p | 1.5 |

### Default examples

Using these settings:

```json
{
  "imageReservationCredits": 1,
  "videoReservationCredits": 5,
  "videoEditReservationCredits": 6,
  "reservationSafetyMultiplier": 2
}
```

The default reservations are:

| Generation | Calculation | Reserved |
|---|---|---:|
| 1080p image | `1 × 1 × 1.5 × 2` | 3 |
| 10-second 720p video | `5 × 2 × 1.25 × 2` | 25 |
| 720p video edit | `6 × 1 × 1.25 × 2` | 15 |

The reservation is always rounded up to a whole credit.

## 4. Final charge calculation

### OpenAI usage

```text
OpenAI credits =
(
  input tokens / 1,000 × input token rate
  +
  output tokens / 1,000 × output token rate
)
× profit margin multiplier
```

### Magica usage

Magica reports usage in microcredits.

```text
Provider credits = Magica creditUsed / MAGICA_CREDIT_UNIT_DIVISOR

Magica platform credits =
provider credits × Magica credit multiplier × profit margin multiplier
```

The default divisor is:

```env
MAGICA_CREDIT_UNIT_DIVISOR=1000000
```

### Final result

```text
Calculated charge = round up(OpenAI credits + Magica platform credits)
```

The system then applies the minimum charge for the generation type:

- Image minimum: `imageReservationCredits`
- Video minimum: `videoReservationCredits`
- Video edit minimum: `videoEditReservationCredits`

The current settlement also prevents the final charge from exceeding the amount reserved for that job.

## 5. Buying credits

The purchase price is simple:

```text
Price in USD = number of credits × pricePerCredit
```

Example:

```text
100 credits × $0.10 = $10.00
```

The user must buy an amount between `minCredits` and `maxCredits`.

Stripe success is processed safely with an idempotency key, so the same successful payment cannot add credits twice.

## 6. Admin pricing fields

Example pricing configuration:

```json
{
  "planName": "Unlock AI Premium Feature",
  "pricePerCredit": 0.10,
  "defaultCredits": 100,
  "minCredits": 10,
  "maxCredits": 10000,
  "openaiInputCreditsPer1kTokens": 0.5,
  "openaiOutputCreditsPer1kTokens": 1,
  "magicaCreditMultiplier": 10,
  "imageReservationCredits": 1,
  "videoReservationCredits": 5,
  "videoEditReservationCredits": 6,
  "profitMarginMultiplier": 2,
  "reservationSafetyMultiplier": 2
}
```

## 7. Effect of changing each setting

| Setting | What changes |
|---|---|
| `pricePerCredit` | Changes how much users pay in USD when buying credits |
| `defaultCredits` | Changes the default credit amount suggested by the UI |
| `minCredits` | Changes the minimum credits allowed in one purchase |
| `maxCredits` | Changes the maximum credits allowed in one purchase |
| `openaiInputCreditsPer1kTokens` | Changes the charge for OpenAI input tokens |
| `openaiOutputCreditsPer1kTokens` | Changes the charge for OpenAI output tokens |
| `magicaCreditMultiplier` | Changes how Magica provider usage converts to platform credits |
| `profitMarginMultiplier` | Multiplies the calculated OpenAI and Magica usage charge |
| `imageReservationCredits` | Changes image reservation and the minimum image charge |
| `videoReservationCredits` | Changes video reservation and the minimum video charge |
| `videoEditReservationCredits` | Changes video-edit reservation and its minimum charge |
| `reservationSafetyMultiplier` | Changes only the amount held before generation; it does not directly increase actual provider usage |

## 8. Simple examples of pricing changes

### Increase `pricePerCredit`

```text
Before: 100 × $0.10 = $10
After:  100 × $0.15 = $15
```

This changes purchase price. It does not change how many credits an AI job consumes.

### Increase `profitMarginMultiplier`

```text
Provider-based charge before margin: 10 credits
Multiplier 2: 20 credits
Multiplier 3: 30 credits
```

This changes the final AI usage charge.

### Increase `reservationSafetyMultiplier`

```text
Base calculation: 12.5 credits
Multiplier 2: 25 credits reserved
Multiplier 3: 38 credits reserved after rounding
```

This requires the user to have more available credits before generation starts. Unused reserved credits are released after completion.

## 9. Failure, refund, and dispute behavior

- AI provider failure: reserved credits are released.
- Queue failure: reserved credits are released.
- Successful generation: actual credits are deducted and the remaining reservation is released.
- Refunded or disputed Stripe purchase: unused purchased credits are recovered.
- If some disputed credits were already spent, the credit account is frozen for manual review.

## 10. Relevant APIs

```text
GET  /api/credits/balance
GET  /api/credits/transactions
GET  /api/credits/pricing
POST /api/credits/calculate-price
POST /api/credits/purchase
POST /api/credits/verify-payment
GET  /api/credits/history
PUT  /api/credits/pricing
```

Only an admin can update pricing.
