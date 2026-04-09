import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Button,
  InlineStack,
  Grid,
  Badge,
  List,
  Banner,
  Divider,
  Icon,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { CheckCircleIcon } from "@shopify/polaris-icons";
import { authenticate, isTestBilling, PLAN_PRO, PLAN_PREMIUM } from "../shopify.server";
import {
  resolveShopPlan,
  getEarlyAdopterSlotsLeft,
} from "../plan-gate.server";

const CLIENT_PLAN_PRO = "Pro";
const CLIENT_PLAN_PREMIUM = "Premium";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);

  const check = await billing.check();
  const resolved = await resolveShopPlan(session.shop, check);
  const slotsLeft = await getEarlyAdopterSlotsLeft();

  return json({
    currentPlan: resolved.plan,
    isEarlyAdopter: resolved.isEarlyAdopter,
    earlyAdopterSlotsLeft: slotsLeft,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  const fd = await request.formData();
  const plan = fd.get("plan") as string;

  if (plan === PLAN_PRO || plan === PLAN_PREMIUM) {
    await billing.request({
      plan,
      isTest: isTestBilling,
    });
  }

  return json({ ok: true });
};

function FeatureRow({ children, included }: { children: React.ReactNode; included: boolean }) {
  return (
    <InlineStack gap="200" blockAlign="center" wrap={false}>
      <span style={{ color: included ? "var(--p-color-text-success)" : "var(--p-color-text-secondary)", display: "flex" }}>
        <Icon source={CheckCircleIcon} />
      </span>
      <Text as="span" variant="bodySm" tone={included ? undefined : "subdued"}>
        {children}
      </Text>
    </InlineStack>
  );
}

export default function PricingPage() {
  const { currentPlan, isEarlyAdopter, earlyAdopterSlotsLeft } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const isSubmitting = fetcher.state === "submitting";
  const submittingPlan = fetcher.formData?.get("plan") as string | undefined;

  const handleSubscribe = (planName: string) => {
    fetcher.submit({ plan: planName }, { method: "POST" });
  };

  const isPro = currentPlan === "pro";
  const isPremium = currentPlan === "premium";
  const isFree = !isPro && !isPremium;

  return (
    <Page>
      <TitleBar title="Subscription Plans" />
      <BlockStack gap="500">
        {isEarlyAdopter && (
          <Banner tone="success">
            <Text as="p" variant="bodyMd">
              You're an early adopter! All Pro features are free for you.
              {earlyAdopterSlotsLeft !== null && earlyAdopterSlotsLeft > 0
                ? ` Only ${earlyAdopterSlotsLeft} early adopter spots remaining.`
                : ""}
            </Text>
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <BlockStack gap="400" inlineAlign="center">
              <Text as="h2" variant="headingLg" alignment="center">
                Choose the right plan for your store
              </Text>
              <Text as="p" tone="subdued" alignment="center">
                Upgrade to unlock more AI generations, blog writing, and automated SEO scans.
              </Text>
            </BlockStack>
          </Layout.Section>

          <Layout.Section>
            <Grid>
              {/* FREE */}
              <Grid.Cell columnSpan={{ xs: 6, sm: 4, md: 4, lg: 4, xl: 4 }}>
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text as="h3" variant="headingMd">Free</Text>
                      {isFree && !isEarlyAdopter && <Badge tone="success">Current</Badge>}
                    </InlineStack>
                    <Text as="h2" variant="heading2xl">
                      $0
                      <span style={{ fontSize: "1rem", color: "gray" }}>/mo</span>
                    </Text>
                    <Divider />
                    <BlockStack gap="200">
                      <FeatureRow included>Basic SEO Audit (1/day)</FeatureRow>
                      <FeatureRow included>5 AI Generations / day</FeatureRow>
                      <FeatureRow included>5 Image Compressions / day</FeatureRow>
                      <FeatureRow included>Meta Tags (view only)</FeatureRow>
                      <FeatureRow included>Basic Schema (Product)</FeatureRow>
                      <FeatureRow included>View Broken Links</FeatureRow>
                      <FeatureRow included={false}>AI Blog Writer</FeatureRow>
                      <FeatureRow included={false}>Bulk Editor</FeatureRow>
                      <FeatureRow included={false}>Automations</FeatureRow>
                    </BlockStack>
                    <Button disabled={isFree && !isEarlyAdopter} fullWidth>
                      {isFree && !isEarlyAdopter ? "Active" : "Downgrade"}
                    </Button>
                  </BlockStack>
                </Card>
              </Grid.Cell>

              {/* PRO */}
              <Grid.Cell columnSpan={{ xs: 6, sm: 4, md: 4, lg: 4, xl: 4 }}>
                <Card background="bg-surface-secondary">
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="h3" variant="headingMd">Pro</Text>
                        <Badge tone="attention">Most Popular</Badge>
                      </InlineStack>
                      {(isPro || isEarlyAdopter) && (
                        <Badge tone="success">
                          {isEarlyAdopter ? "Early Adopter" : "Current"}
                        </Badge>
                      )}
                    </InlineStack>

                    {isEarlyAdopter ? (
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="end">
                          <Text as="h2" variant="heading2xl">FREE</Text>
                          <Text as="span" variant="bodyMd" tone="subdued">
                            <s>$8.99/mo</s>
                          </Text>
                        </InlineStack>
                        <Badge tone="success">Early Adopter Pricing</Badge>
                      </BlockStack>
                    ) : (
                      <Text as="h2" variant="heading2xl">
                        $8.99
                        <span style={{ fontSize: "1rem", color: "gray" }}>/mo</span>
                      </Text>
                    )}

                    <Divider />
                    <BlockStack gap="200">
                      <FeatureRow included>Unlimited SEO Audits</FeatureRow>
                      <FeatureRow included>100 AI Generations / mo</FeatureRow>
                      <FeatureRow included>50 Image Compressions / mo</FeatureRow>
                      <FeatureRow included>5 AI Blog Posts / mo</FeatureRow>
                      <FeatureRow included>Edit + Bulk Meta Tags</FeatureRow>
                      <FeatureRow included>All Schema Types</FeatureRow>
                      <FeatureRow included>Internal Link Suggestions</FeatureRow>
                      <FeatureRow included>Broken Link Monitoring</FeatureRow>
                      <FeatureRow included>Bulk Editor</FeatureRow>
                      <FeatureRow included>Weekly Automated Scans</FeatureRow>
                      <FeatureRow included={false}>Custom AI Prompts</FeatureRow>
                      <FeatureRow included={false}>One-Click Fix</FeatureRow>
                    </BlockStack>

                    {isEarlyAdopter ? (
                      <Button disabled fullWidth>
                        Active (Early Adopter)
                      </Button>
                    ) : (
                      <Button
                        variant={isPro ? "plain" : "primary"}
                        disabled={isPro}
                        loading={isSubmitting && submittingPlan === CLIENT_PLAN_PRO}
                        onClick={() => handleSubscribe(CLIENT_PLAN_PRO)}
                        fullWidth
                      >
                        {isPro ? "Active" : "Start 7-Day Free Trial"}
                      </Button>
                    )}
                  </BlockStack>
                </Card>
              </Grid.Cell>

              {/* PREMIUM */}
              <Grid.Cell columnSpan={{ xs: 6, sm: 4, md: 4, lg: 4, xl: 4 }}>
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text as="h3" variant="headingMd">Premium</Text>
                      {isPremium && <Badge tone="success">Current</Badge>}
                    </InlineStack>
                    <Text as="h2" variant="heading2xl">
                      $14.99
                      <span style={{ fontSize: "1rem", color: "gray" }}>/mo</span>
                    </Text>
                    <Divider />
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        Everything in Pro, plus:
                      </Text>
                      <FeatureRow included>Unlimited AI Generations</FeatureRow>
                      <FeatureRow included>Unlimited Image Compressions</FeatureRow>
                      <FeatureRow included>Unlimited AI Blog Posts</FeatureRow>
                      <FeatureRow included>AI Auto Meta Tags</FeatureRow>
                      <FeatureRow included>Custom AI Prompt Templates</FeatureRow>
                      <FeatureRow included>One-Click Fix</FeatureRow>
                      <FeatureRow included>Daily Automated Scans</FeatureRow>
                      <FeatureRow included>Auto-Redirect Broken Links</FeatureRow>
                      <FeatureRow included>Priority Support</FeatureRow>
                    </BlockStack>
                    <Button
                      variant={isPremium ? "plain" : "primary"}
                      disabled={isPremium}
                      loading={isSubmitting && submittingPlan === CLIENT_PLAN_PREMIUM}
                      onClick={() => handleSubscribe(CLIENT_PLAN_PREMIUM)}
                      fullWidth
                    >
                      {isPremium ? "Active" : "Start 7-Day Free Trial"}
                    </Button>
                  </BlockStack>
                </Card>
              </Grid.Cell>
            </Grid>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
