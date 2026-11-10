'use strict';
// Monthly subscription billing for live (multi-tenant) shops.
//   * Billing cycle: 30 days, anchored on the tenant's creation date.
//   * Default fee: LKR 999 / cycle (super admin can change it globally or per shop).
//   * A shop is locked ("expired") the moment its due date passes unless a grace period is set.
const DAY = 86400000;
const CYCLE_DAYS = 30;
const DEFAULT_FEE = 999;
const DEFAULT_CURRENCY = 'LKR';
const SETTINGS_ID = 'billing';
const DEFAULT_SETTINGS = { monthlyFee: DEFAULT_FEE, currency: DEFAULT_CURRENCY, bankName: '', accountName: '', accountNumber: '', branch: '', swift: '', instructions: '', supportContact: '' };

const asDate = v => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };

// First billing boundary (creation date + N * 30 days) that is strictly after `after`.
function anchoredNext(createdAt, after = Date.now()) {
  const anchor = asDate(createdAt)?.getTime() ?? after;
  const cycles = Math.max(1, Math.floor((after - anchor) / (CYCLE_DAYS * DAY)) + 1);
  return new Date(anchor + cycles * CYCLE_DAYS * DAY);
}

// The date the shop is paid up to. Exempt shops have no due date.
const dueAt = t => (!t || t.billing?.exempt) ? null : (asDate(t.expiresAt) || asDate(t.trialEndsAt));

// How many 30-day cycles have gone unpaid (0 while the shop is still paid up).
function overdueCycles(due, now = Date.now()) {
  if (!due || now < due.getTime()) return 0;
  return Math.floor((now - due.getTime()) / (CYCLE_DAYS * DAY)) + 1;
}

const feeFor = (t, settings) => {
  const own = Number(t?.billing?.monthlyFee), global = Number(settings?.monthlyFee);
  return own > 0 ? own : global > 0 ? global : DEFAULT_FEE;
};

async function getSettings(database) {
  const doc = await database.collection('superadmin_settings').findOne({ _id: SETTINGS_ID });
  return { ...DEFAULT_SETTINGS, ...(doc || {}), _id: undefined };
}

// One-time, idempotent setup of billing fields on a tenant document.
// Existing shops without any date start billing on their next 30-day boundary
// (creation date + N * 30 days) so nobody is locked out the moment this ships.
async function ensure(database, tenant) {
  if (!tenant || tenant.billing) return tenant;
  const now = new Date(), isMain = tenant._id === 'main';
  const set = { billing: { cycleDays: CYCLE_DAYS, startedAt: now, exempt: isMain }, updatedAt: now };
  if (!isMain) set.graceDays = 0;
  if (!isMain && !tenant.expiresAt && !tenant.trialEndsAt) set.expiresAt = anchoredNext(tenant.createdAt, now.getTime());
  const result = await database.collection('tenants').updateOne({ _id: tenant._id, billing: { $exists: false } }, { $set: set });
  if (result.matchedCount) return { ...tenant, ...set };
  return (await database.collection('tenants').findOne({ _id: tenant._id })) || tenant;
}

// Everything the UI needs about one shop's billing position.
function summary(tenant, settings, now = Date.now()) {
  const exempt = !!tenant.billing?.exempt, due = dueAt(tenant), fee = feeFor(tenant, settings), overdue = overdueCycles(due, now);
  return {
    exempt,
    cycleDays: CYCLE_DAYS,
    billingStart: asDate(tenant.createdAt),
    dueAt: due,
    daysLeft: due ? Math.ceil((due.getTime() - now) / DAY) : null,
    overdueCycles: overdue,
    monthlyFee: fee,
    currency: settings?.currency || DEFAULT_CURRENCY,
    amountDue: overdue > 0 ? fee * overdue : fee,
    lastPaidAt: tenant.billing?.lastPaidAt || null,
    lastPaymentAmount: tenant.billing?.lastPaymentAmount ?? null
  };
}

const bankOf = s => ({ bankName: s.bankName || '', accountName: s.accountName || '', accountNumber: s.accountNumber || '', branch: s.branch || '', swift: s.swift || '', instructions: s.instructions || '', supportContact: s.supportContact || '' });

// Shop-facing view. Bank details are only included once payment is near or overdue.
function view(tenant, settings, state) {
  const s = summary(tenant, settings);
  if (s.exempt) return { exempt: true };
  return { ...s, locked: false, ...(state === 'expired' ? { bank: bankOf(settings) } : {}) };
}

function cleanSettings(b) {
  const text = (v, n) => String(v ?? '').trim().slice(0, n);
  const fee = Number(b.monthlyFee);
  if (!Number.isFinite(fee) || fee <= 0 || fee > 100000000) throw Object.assign(new Error('Monthly fee must be a positive number'), { status: 400, code: 'VALIDATION' });
  return { monthlyFee: Math.round(fee * 100) / 100, currency: text(b.currency || DEFAULT_CURRENCY, 8).toUpperCase() || DEFAULT_CURRENCY, bankName: text(b.bankName, 120), accountName: text(b.accountName, 120), accountNumber: text(b.accountNumber, 60), branch: text(b.branch, 120), swift: text(b.swift, 40), instructions: text(b.instructions, 1000), supportContact: text(b.supportContact, 80) };
}

module.exports = { DAY, CYCLE_DAYS, DEFAULT_FEE, SETTINGS_ID, asDate, anchoredNext, dueAt, overdueCycles, feeFor, getSettings, ensure, summary, view, bankOf, cleanSettings };
