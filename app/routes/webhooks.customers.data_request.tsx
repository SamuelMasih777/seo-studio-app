import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * Mandatory GDPR compliance webhook.
 * Triggered when a customer requests to view their stored personal data.
 * This app does not store any customer personal data (we only store shop-level
 * data like session tokens and SEO audit results), so we acknowledge the
 * request and respond 200 immediately.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`[GDPR] ${topic} received for shop: ${shop}`);

  // We do not collect or store personal data about the shop's customers.
  // No data to return. Acknowledge receipt with 200.
  return new Response(null, { status: 200 });
};
