import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * Mandatory GDPR compliance webhook.
 * Triggered when a merchant requests deletion of a customer's personal data.
 * This app does not store any customer personal data — only shop-level data
 * (session tokens, SEO audit history, store settings). No action is needed.
 * Acknowledge receipt with 200 within 30 days as required by Shopify.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`[GDPR] ${topic} received for shop: ${shop}`);

  // No customer personal data is stored by this app.
  // Acknowledge receipt with 200.
  return new Response(null, { status: 200 });
};
