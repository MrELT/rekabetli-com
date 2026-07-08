#!/usr/bin/env node
/**
 * Supabase SQL dosyalarını bağlı remote projede sırayla çalıştırır.
 *
 * Kullanım:
 *   node scripts/run-supabase-sql.mjs
 *   node scripts/run-supabase-sql.mjs referral
 *   node scripts/run-supabase-sql.mjs purchase-notifications
 *   node scripts/run-supabase-sql.mjs panel
 *   node scripts/run-supabase-sql.mjs all
 *
 * Gereksinim: supabase CLI kurulu ve `supabase link` yapılmış olmalı.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const BATCHES = {
  referral: [
    "supabase-referral-program-phase1.sql",
    "supabase-referral-program-phase1-fix.sql",
    "supabase-referral-program-phase3-mentor-commission.sql",
    "supabase-referral-program-phase3-mentor-stats.sql",
  ],

  wallet: [
    "supabase-mentor-wallet.sql",
    "supabase-mentor-wallet-payout-hold.sql",
    "supabase-mentor-wallet-payout-fee.sql",
    "supabase-mentor-wallet-held-balance-list.sql",
    "supabase-mentor-payout-account.sql",
    "supabase-mentor-payout-wise.sql",
  ],

  orders: [
    "supabase-package-orders-enrollment-fix.sql",
    "supabase-package-orders-refund.sql",
    "supabase-package-orders-refund-stripe-fee.sql",
    "supabase-package-orders-success-page.sql",
  ],

  panel: [
    "supabase-mentor-linked-students-source.sql",
    "supabase-mentor-package-tasks.sql",
    "supabase-mentor-task-activations.sql",
    "supabase-student-panel.sql",
    "supabase-mentor-messaging.sql",
    "supabase-mentor-messages-rich-content.sql",
    "supabase-mentor-notifications.sql",
    "supabase-mentor-meeting-proposals.sql",
    "supabase-mentor-meeting-postpone.sql",
    "supabase-meeting-reviews.sql",
    "supabase-meeting-reminders-cron.sql",
    "supabase-mentor-meeting-link.sql",
    "supabase-mentor-vitrin-availability.sql",
    "supabase-mentor-vitrin-availability-watch.sql",
  ],

  notifications: [
    "supabase-notification-email-fix.sql",
    "supabase-notification-email-queue.sql",
  ],

  "purchase-notifications": ["supabase-package-purchase-notifications.sql"],

  "invoice-email": ["supabase-package-payment-invoice-email.sql"],

  "student-invoice": ["supabase-student-package-order-invoice.sql"],

  influencer: ["supabase-influencer-program-full.sql"],

  "self-billing": ["supabase-mentor-payout-self-billing.sql"],

  "vitrin-review": ["supabase-mentor-vitrin-review.sql"],

  "package-order-fix": ["supabase-package-orders-create-overload-fix.sql"],

  "panel-error-reports": ["supabase-panel-error-reports.sql"],

  "cleanup-test-payments": ["supabase-cleanup-test-payments.sql"],

  security: [
    "supabase-security-high-priority-fixes.sql",
    "supabase-security-referral-fixes.sql",
    "supabase-security-payout-admin-only.sql",
    "supabase-security-remaining-fixes.sql",
  ],

  remaining: [
    "supabase-mentor-meeting-proposals.sql",
    "supabase-mentor-meeting-postpone.sql",
    "supabase-meeting-reviews.sql",
    "supabase-meeting-reminders-cron.sql",
    "supabase-mentor-meeting-link.sql",
    "supabase-mentor-vitrin-availability.sql",
    "supabase-mentor-vitrin-availability-watch.sql",
    "supabase-notification-email-fix.sql",
    "supabase-notification-email-queue.sql",
    "supabase-package-purchase-notifications.sql",
  ],

  all: [
    "supabase-mentor-wallet.sql",
    "supabase-mentor-wallet-payout-hold.sql",
    "supabase-mentor-wallet-payout-fee.sql",
    "supabase-mentor-wallet-held-balance-list.sql",
    "supabase-package-orders-enrollment-fix.sql",
    "supabase-package-orders-refund.sql",
    "supabase-package-orders-refund-stripe-fee.sql",
    "supabase-package-orders-success-page.sql",
    "supabase-mentor-payout-account.sql",
    "supabase-mentor-payout-wise.sql",
    "supabase-referral-program-phase1.sql",
    "supabase-referral-program-phase1-fix.sql",
    "supabase-referral-program-phase3-mentor-commission.sql",
    "supabase-referral-program-phase3-mentor-stats.sql",
    "supabase-mentor-linked-students-source.sql",
    "supabase-mentor-package-tasks.sql",
    "supabase-mentor-task-activations.sql",
    "supabase-student-panel.sql",
    "supabase-mentor-messaging.sql",
    "supabase-mentor-messages-rich-content.sql",
    "supabase-mentor-notifications.sql",
    "supabase-mentor-meeting-proposals.sql",
    "supabase-mentor-meeting-postpone.sql",
    "supabase-meeting-reviews.sql",
    "supabase-meeting-reminders-cron.sql",
    "supabase-mentor-meeting-link.sql",
    "supabase-mentor-vitrin-availability.sql",
    "supabase-mentor-vitrin-availability-watch.sql",
    "supabase-notification-email-fix.sql",
    "supabase-notification-email-queue.sql",
    "supabase-package-purchase-notifications.sql",
    "supabase-mentor-payout-self-billing.sql",
  ],
};

function runFile(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!existsSync(fullPath)) {
    throw new Error(`Dosya bulunamadı: ${relativePath}`);
  }

  console.log("");
  console.log("=".repeat(60));
  console.log(`>> ${relativePath}`);
  console.log("=".repeat(60));

  const result = spawnSync("supabase", ["db", "query", "--linked", "-f", fullPath], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    throw new Error(`SQL başarısız: ${relativePath} (exit ${result.status ?? "unknown"})`);
  }
}

function main() {
  const batchName = process.argv[2] || "all";
  const files = BATCHES[batchName];

  if (!files) {
    console.error(`Bilinmeyen batch: ${batchName}`);
    console.error(`Geçerli batch'ler: ${Object.keys(BATCHES).join(", ")}`);
    process.exit(1);
  }

  console.log(`Supabase SQL batch: ${batchName} (${files.length} dosya)`);
  console.log(`Proje: ${root}`);

  for (const file of files) {
    runFile(file);
  }

  console.log("");
  console.log(`Tamamlandı: ${files.length} dosya başarıyla çalıştırıldı.`);
}

try {
  main();
} catch (error) {
  console.error("");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
