import { describe, expect, it } from "vitest";
import {
  contributionPeriod, employeeInsurance, financialYear, professionalTax, providentFund, taxOnSalary
} from "@/lib/payroll/statutory";
import { ecrFor, paidDaysFor, payRun, payslipFor, type Employee } from "@/lib/payroll/run";
import { postPayroll } from "@/lib/ledger/posting";

/* --------------------------------------------------------- provident fund */

describe("provident fund", () => {
  it("takes 12% from both sides of a wage under the ceiling", () => {
    // ₹10,000 of basic and dearness allowance
    const pf = providentFund({ pfWageMinor: 1000000, date: "2026-11-01" })!;
    expect(pf.employeeMinor).toBe(120000);
    expect(pf.employerTotalMinor).toBe(120000);
  });

  it("splits the employer's share between the pension scheme and the fund", () => {
    const pf = providentFund({ pfWageMinor: 1000000, date: "2026-11-01" })!;
    expect(pf.employerPensionMinor).toBe(83300);
    expect(pf.employerFundMinor).toBe(36700);
    expect(pf.employerPensionMinor + pf.employerFundMinor).toBe(pf.employerTotalMinor);
  });

  it("caps at the ceiling, which is what most employers do", () => {
    // ₹40,000 of basic, capped to ₹15,000
    const pf = providentFund({ pfWageMinor: 4000000, date: "2026-11-01" })!;
    expect(pf.wageMinor).toBe(1500000);
    expect(pf.employeeMinor).toBe(180000);
  });

  it("contributes on the whole wage when the employer has chosen to", () => {
    const pf = providentFund({ pfWageMinor: 4000000, date: "2026-11-01", capAtCeiling: false })!;
    expect(pf.wageMinor).toBe(4000000);
    expect(pf.employeeMinor).toBe(480000);
  });

  it("sends the pension share on the ceiling even when the rest is not capped, which is the part done wrong by hand", () => {
    const pf = providentFund({ pfWageMinor: 4000000, date: "2026-11-01", capAtCeiling: false })!;
    // 8.33% of ₹15,000, not of ₹40,000
    expect(pf.employerPensionMinor).toBe(124950);
    expect(pf.employerFundMinor).toBe(480000 - 124950);
  });

  it("adds the insurance and administration charges the employer alone pays", () => {
    const pf = providentFund({ pfWageMinor: 1000000, date: "2026-11-01" })!;
    expect(pf.edliMinor).toBe(5000);
    expect(pf.adminMinor).toBe(5000);
    expect(pf.employerCostMinor).toBe(pf.employerTotalMinor + pf.edliMinor + pf.adminMinor);
  });

  it("says which rule it used and where it came from", () => {
    const pf = providentFund({ pfWageMinor: 1000000, date: "2026-11-01" })!;
    expect(pf.rule.source).toContain("EPF");
    expect(pf.rule.status).toBe("published");
  });
});

/* ----------------------------------------------------- employee insurance */

describe("employee insurance", () => {
  it("covers somebody under the wage ceiling and takes three quarters of a per cent", () => {
    const esi = employeeInsurance({ grossMinor: 2000000, date: "2026-11-01" })!;
    expect(esi.covered).toBe(true);
    expect(esi.employeeMinor).toBe(15000);
    expect(esi.employerMinor).toBe(65000);
  });

  it("does not cover somebody above it", () => {
    const esi = employeeInsurance({ grossMinor: 2500000, date: "2026-11-01" })!;
    expect(esi.covered).toBe(false);
    expect(esi.employeeMinor).toBe(0);
    expect(esi.employerMinor).toBe(0);
  });

  it("keeps covering a person who rose above the ceiling mid half-year, which catches employers out at appraisal time", () => {
    const esi = employeeInsurance({ grossMinor: 2500000, date: "2026-11-01", coveredAtPeriodStart: true })!;
    expect(esi.covered).toBe(true);
    expect(esi.coveredToPeriodEnd).toBe("2027-03-31");
    expect(esi.employeeMinor).toBe(18750);
  });

  it("uses the higher ceiling for a person with a disability", () => {
    expect(employeeInsurance({ grossMinor: 2400000, date: "2026-11-01" })!.covered).toBe(false);
    expect(employeeInsurance({ grossMinor: 2400000, date: "2026-11-01", hasDisability: true })!.covered).toBe(true);
  });

  it("knows which half of the year a month falls in", () => {
    expect(contributionPeriod("2026-05-10")).toMatchObject({ from: "2026-04-01", to: "2026-09-30" });
    expect(contributionPeriod("2026-11-10")).toMatchObject({ from: "2026-10-01", to: "2027-03-31" });
    expect(contributionPeriod("2027-02-10")).toMatchObject({ from: "2026-10-01", to: "2027-03-31" });
  });
});

/* ------------------------------------------------------ professional tax */

describe("professional tax", () => {
  it("knows Karnataka's one slab", () => {
    expect(professionalTax({ grossMinor: 3000000, region: "KA", date: "2026-11-01" })).toMatchObject({ known: true, amountMinor: 20000 });
    expect(professionalTax({ grossMinor: 2000000, region: "KA", date: "2026-11-01" })).toMatchObject({ known: true, amountMinor: 0 });
  });

  it("charges Maharashtra's higher amount in February", () => {
    expect(professionalTax({ grossMinor: 3000000, region: "MH", date: "2026-11-01" })).toMatchObject({ amountMinor: 20000 });
    expect(professionalTax({ grossMinor: 3000000, region: "MH", date: "2026-02-01" })).toMatchObject({ amountMinor: 30000 });
  });

  it("does not charge February's higher amount to somebody below the slab", () => {
    expect(professionalTax({ grossMinor: 500000, region: "MH", date: "2026-02-01" })).toMatchObject({ amountMinor: 0 });
  });

  it("reads West Bengal's slabs from the top down", () => {
    expect(professionalTax({ grossMinor: 5000000, region: "WB", date: "2026-11-01" })).toMatchObject({ amountMinor: 20000 });
    expect(professionalTax({ grossMinor: 1200000, region: "WB", date: "2026-11-01" })).toMatchObject({ amountMinor: 11000 });
    expect(professionalTax({ grossMinor: 900000, region: "WB", date: "2026-11-01" })).toMatchObject({ amountMinor: 0 });
  });

  it("says nil with confidence in a state that does not levy it", () => {
    const verdict = professionalTax({ grossMinor: 9000000, region: "DL", date: "2026-11-01" });
    expect(verdict).toMatchObject({ known: true, amountMinor: 0, none: true });
  });

  it("refuses to guess for a state we do not hold, rather than returning nil", () => {
    const verdict = professionalTax({ grossMinor: 3000000, region: "PB", date: "2026-11-01" });
    expect(verdict.known).toBe(false);
    if (!verdict.known) expect(verdict.reason).toContain("PB");
  });

  it("says when a state collects it half-yearly instead of monthly", () => {
    const verdict = professionalTax({ grossMinor: 3000000, region: "TN", date: "2026-11-01" });
    expect(verdict.known).toBe(false);
    if (!verdict.known) expect(verdict.reason).toContain("half-yearly");
  });

  it("asks for the state rather than assuming one", () => {
    const verdict = professionalTax({ grossMinor: 3000000, region: undefined, date: "2026-11-01" });
    expect(verdict.known).toBe(false);
  });

  it("marks the slabs we have not verified ourselves", () => {
    const mh = professionalTax({ grossMinor: 3000000, region: "MH", date: "2026-11-01" });
    expect(mh.known && "rule" in mh && mh.rule.status).toBe("unverified");
  });
});

/* -------------------------------------------------------- tax on salary */

describe("tax on a salary", () => {
  it("knows the financial year begins in April", () => {
    expect(financialYear("2026-11-14").label).toBe("2026-27");
    expect(financialYear("2026-02-14").label).toBe("2025-26");
  });

  it("takes nothing from a salary the rebate covers", () => {
    // ₹12,00,000 a year, less the standard deduction, is inside the rebate
    const tax = taxOnSalary({ annualSalaryMinor: 120000000, date: "2026-11-01" })!;
    expect(tax.annualMinor).toBe(0);
    expect(tax.monthlyMinor).toBe(0);
  });

  it("works the slabs upward rather than taxing the whole salary at the top rate", () => {
    // ₹20,00,000 less ₹75,000 standard deduction leaves ₹19,25,000 taxable:
    // 4L nil, then 20,000 + 40,000 + 60,000 at 5/10/15%, and 3.25L at 20% = ₹1,85,000
    const tax = taxOnSalary({ annualSalaryMinor: 200000000, date: "2026-11-01" })!;
    expect(tax.beforeRebateMinor).toBe(18500000);
    expect(tax.cessMinor).toBe(740000);
    expect(tax.annualMinor).toBe(19240000);
  });

  it("spreads it over the months left in the year", () => {
    const whole = taxOnSalary({ annualSalaryMinor: 200000000, date: "2026-11-01" })!;
    const rest = taxOnSalary({ annualSalaryMinor: 200000000, date: "2026-11-01", monthsRemaining: 5 })!;
    expect(whole.monthlyMinor).toBe(Math.round(whole.annualMinor / 12));
    expect(rest.monthlyMinor).toBe(Math.round(whole.annualMinor / 5));
  });

  it("softens the cliff just above the rebate, so a rupee more of pay cannot cost more than a rupee", () => {
    const under = taxOnSalary({ annualSalaryMinor: 127500000, date: "2026-11-01" })!;
    const justOver = taxOnSalary({ annualSalaryMinor: 128000000, date: "2026-11-01" })!;
    expect(under.annualMinor).toBe(0);
    // ₹5,000 more pay must not cost more than ₹5,000 of tax before cess
    expect(justOver.annualMinor - justOver.cessMinor).toBeLessThanOrEqual(500000);
  });

  it("uses the old regime's slabs and deductions when asked", () => {
    const oldWay = taxOnSalary({ annualSalaryMinor: 120000000, date: "2026-11-01", regime: "old", deductionsMinor: 15000000 })!;
    expect(oldWay.regime.regime).toBe("old");
    expect(oldWay.taxableMinor).toBe(120000000 - 5000000 - 15000000);
    expect(oldWay.annualMinor).toBeGreaterThan(0);
  });

  it("says plainly that it is an estimate", () => {
    expect(taxOnSalary({ annualSalaryMinor: 200000000, date: "2026-11-01" })!.basis).toContain("Estimated");
  });
});

/* -------------------------------------------------------------- the run */

const person = (over: Partial<Employee> = {}): Employee => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  name: over.name ?? "Anita Rao",
  joined: "2024-01-01",
  basicMinor: 2000000,
  hraMinor: 800000,
  otherAllowancesMinor: 200000,
  region: "KA",
  pf: { enrolled: true, uan: "100200300400" },
  esi: { enrolled: true },
  ...over
});

describe("one person's payslip", () => {
  const slip = payslipFor(person(), "2026-11");

  it("adds the earnings into a gross", () => {
    expect(slip.grossMinor).toBe(3000000);
  });

  it("takes provident fund on basic and dearness allowance, not on the whole gross, and caps it at the ceiling", () => {
    // ₹20,000 of basic, capped to the ₹15,000 ceiling
    expect(slip.pf?.wageMinor).toBe(1500000);
    expect(slip.deductions.find((d) => d.label === "Provident fund")?.amountMinor).toBe(180000);
  });

  it("leaves insurance off somebody over the ceiling", () => {
    expect(slip.esi?.covered).toBe(false);
    expect(slip.deductions.find((d) => d.label === "Employee insurance")).toBeUndefined();
  });

  it("deducts the state's professional tax", () => {
    expect(slip.deductions.find((d) => d.label === "Professional tax")?.amountMinor).toBe(20000);
  });

  it("nets down to what actually reaches the bank", () => {
    expect(slip.netMinor).toBe(slip.grossMinor - slip.deductionsMinor);
  });

  it("counts what the employer pays on top, which is not on the payslip but is on the business", () => {
    expect(slip.employerCostMinor).toBeGreaterThan(0);
  });

  it("carries a question through rather than deducting a made-up amount", () => {
    const punjab = payslipFor(person({ region: "PB" }), "2026-11");
    expect(punjab.deductions.find((d) => d.label === "Professional tax")).toBeUndefined();
    expect(punjab.unanswered[0]).toContain("PB");
  });

  it("deducts insurance from somebody under the ceiling", () => {
    const junior = payslipFor(person({ basicMinor: 800000, hraMinor: 300000, otherAllowancesMinor: 100000 }), "2026-11");
    expect(junior.esi?.covered).toBe(true);
    expect(junior.deductions.find((d) => d.label === "Employee insurance")?.amountMinor).toBe(9000);
  });

  it("respects a tax figure the employer set by hand", () => {
    const fixed = payslipFor(person({ tax: { overrideMonthlyMinor: 500000 } }), "2026-11");
    const line = fixed.deductions.find((d) => d.label === "Tax deducted at source");
    expect(line?.amountMinor).toBe(500000);
    expect(line?.note).toBe("Set by hand");
  });
});

describe("somebody who joined or left partway through", () => {
  it("counts the days they were actually on the payroll", () => {
    expect(paidDaysFor(person({ joined: "2026-11-20" }), "2026-11")).toEqual({ paid: 11, total: 30 });
    expect(paidDaysFor(person({ left: "2026-11-10" }), "2026-11")).toEqual({ paid: 10, total: 30 });
    expect(paidDaysFor(person(), "2026-11")).toEqual({ paid: 30, total: 30 });
  });

  it("pays them for the part of the month they worked", () => {
    const slip = payslipFor(person({ joined: "2026-11-16" }), "2026-11");
    expect(slip.paidDays).toBe(15);
    expect(slip.grossMinor).toBe(1500000);
  });

  it("takes the statutory amounts on what was earned, not on the full month", () => {
    const slip = payslipFor(person({ joined: "2026-11-16" }), "2026-11");
    expect(slip.pf?.wageMinor).toBe(1000000);
  });

  it("leaves somebody who had already left off the run entirely", () => {
    const run = payRun([person({ left: "2026-09-30" })], "2026-11");
    expect(run.payslips).toHaveLength(0);
  });

  it("leaves somebody who has not joined yet off it too", () => {
    expect(payRun([person({ joined: "2027-01-01" })], "2026-11").payslips).toHaveLength(0);
  });
});

describe("the month as a whole", () => {
  const team = [
    person({ id: "a", name: "Anita Rao" }),
    person({ id: "b", name: "Rahul Shah", basicMinor: 900000, hraMinor: 300000, otherAllowancesMinor: 100000 }),
    person({ id: "c", name: "Left in June", left: "2026-06-30" })
  ];
  const run = payRun(team, "2026-11");

  it("pays only the people who were there", () => {
    expect(run.totals.employees).toBe(2);
    expect(run.label).toBe("November 2026");
  });

  it("adds up what every payslip says", () => {
    expect(run.totals.grossMinor).toBe(3000000 + 1300000);
    expect(run.totals.netMinor).toBe(run.payslips.reduce((a, p) => a + p.netMinor, 0));
  });

  it("works out what the month really cost, contributions included", () => {
    expect(run.totals.costMinor).toBeGreaterThan(run.totals.grossMinor);
  });

  it("puts a floor under the administration charge, which is per establishment rather than per person", () => {
    // Half a per cent of these wages is well under the ₹500 minimum
    expect(run.totals.pfAdminMinor).toBe(50000);
  });

  it("says what has to be paid, how much, and by when", () => {
    const pf = run.challans.find((c) => c.name === "Provident fund")!;
    expect(pf.dueOn).toBe("2026-12-15");
    expect(pf.amountMinor).toBeGreaterThan(0);
    expect(pf.detail).toContain("pension");

    const esi = run.challans.find((c) => c.name === "Employee insurance")!;
    expect(esi.dueOn).toBe("2026-12-15");
  });

  it("gets the due date right across the turn of the year", () => {
    const december = payRun(team, "2026-12");
    expect(december.challans.find((c) => c.name === "Provident fund")?.dueOn).toBe("2027-01-15");
  });

  it("makes no challan for something nobody owes", () => {
    const nobody = payRun([person({ pf: { enrolled: false }, esi: { enrolled: false }, region: "DL" })], "2026-11");
    expect(nobody.challans.find((c) => c.name === "Provident fund")).toBeUndefined();
  });

  it("gathers up every question the payslips could not answer", () => {
    const withGap = payRun([person({ region: "PB" })], "2026-11");
    expect(withGap.unanswered).toHaveLength(1);
  });

  it("writes the fund's own upload file, one line per member", () => {
    const ecr = ecrFor(run, team);
    const lines = ecr.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0].split("#~#")[0]).toBe("100200300400");
    expect(lines[0].split("#~#")[1]).toBe("Anita Rao");
    // EPF wages are the capped wage in rupees, not paise
    expect(lines[0].split("#~#")[3]).toBe("15000");
  });
});

describe("payroll in the accounts", () => {
  const run = payRun([person({ id: "a" }), person({ id: "b", basicMinor: 900000, hraMinor: 300000, otherAllowancesMinor: 100000 })], "2026-11");
  const posted = postPayroll(run, "INR");

  it("balances", () => {
    const debits = posted.lines.reduce((a, l) => a + (l.debit ?? 0), 0);
    const credits = posted.lines.reduce((a, l) => a + (l.credit ?? 0), 0);
    expect(debits).toBe(credits);
  });

  it("falls on the last day of the month it is for", () => {
    expect(posted.date).toBe("2026-11-30");
  });

  it("charges the gross to salaries and the employer's own contributions separately", () => {
    expect(posted.lines.find((l) => l.account === "6020")?.debit).toBe(run.totals.grossMinor);
    expect(posted.lines.find((l) => l.account === "6025")?.debit).toBeGreaterThan(0);
  });

  it("owes the net to the staff and the rest to the people it was held back for", () => {
    expect(posted.lines.find((l) => l.account === "2400")?.credit).toBe(run.totals.netMinor);
    expect(posted.lines.find((l) => l.account === "2410")?.credit).toBeGreaterThan(0);
    expect(posted.lines.find((l) => l.account === "2440")?.credit).toBe(run.totals.professionalTaxMinor);
  });

  it("leaves out the liabilities nobody owes", () => {
    const simple = payRun([person({ pf: { enrolled: false }, esi: { enrolled: false }, region: "DL" })], "2026-11");
    const entry = postPayroll(simple, "INR");
    expect(entry.lines.find((l) => l.account === "2410")).toBeUndefined();
    expect(entry.lines.find((l) => l.account === "2420")).toBeUndefined();
  });
});
