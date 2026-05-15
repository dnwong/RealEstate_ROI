/**
 * Gross rental yield: annual gross rent / total acquisition cost.
 * This is not net cap rate (no operating expenses, vacancy, or financing).
 */
export function grossRentalYield(annualGrossRent, totalInvestment) {
  if (
    !Number.isFinite(annualGrossRent) ||
    !Number.isFinite(totalInvestment) ||
    totalInvestment <= 0
  ) {
    return null;
  }
  return (annualGrossRent / totalInvestment) * 100;
}

/**
 * Simple cash-on-cash return: annual pre-tax cash flow / cash invested.
 * cashInvested typically = down payment + closing costs (excludes loan).
 */
export function cashOnCashReturn(annualCashFlow, cashInvested) {
  if (
    !Number.isFinite(annualCashFlow) ||
    !Number.isFinite(cashInvested) ||
    cashInvested <= 0
  ) {
    return null;
  }
  return (annualCashFlow / cashInvested) * 100;
}
