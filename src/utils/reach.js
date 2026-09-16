const USERS_PER_DOLLAR = 5;

async function calculateReach(budget) {
  // Reach scales with the total budget only: $1 ≈ 5 users, $10 ≈ 50 users.
  // Duration does not change the total reach — it only spreads delivery
  // across the active period.
  const estimate = budget * USERS_PER_DOLLAR;
  return {
    low: Math.round(estimate * 0.8),
    high: Math.round(estimate * 1.2),
  };
}

module.exports = {
  USERS_PER_DOLLAR,
  calculateReach,
};
