import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * Mandatory GDPR compliance webhook.
 * Triggered 48 hours after a shop uninstalls the app. At this point all
 * shop data must be permanently deleted from our database.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`[GDPR] ${topic} received for shop: ${shop} — deleting all shop data`);

  try {
    // Delete in dependency order to avoid FK violations.
    await db.brokenLinkLog.deleteMany({ where: { shop } });
    await db.auditHistory.deleteMany({ where: { shop } });
    await db.dashboardSeoSnapshot.deleteMany({ where: { shop } });
    await db.scheduledAutomation.deleteMany({ where: { shop } });
    await db.aIPromptTemplate.deleteMany({ where: { shop } });
    await db.storeSettings.deleteMany({ where: { shop } });
    await db.session.deleteMany({ where: { shop } });
  } catch (err) {
    console.error(`[GDPR] shop/redact DB cleanup error for ${shop}:`, err);
    // Return 200 anyway — Shopify will retry on non-2xx; a partial delete is
    // better than a retry loop if the store row is already gone.
  }

  return new Response(null, { status: 200 });
};
