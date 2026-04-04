import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
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
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const shop = session.shop;

  // Check current plan
  const check = await billing.check();
  let currentPlan = "Free";
  if (check.hasActivePayment) {
    currentPlan = check.appSubscriptions[0].name;
  }

  // Sync to database
  await prisma.storeSettings.upsert({
    where: { shop },
    update: { plan: currentPlan },
    create: { shop, plan: currentPlan },
  });

  return { currentPlan };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const plan = formData.get("plan") as string;

  if (plan === "Basic") {
    await billing.request({
      plan: "Basic",
      isTest: true,
      returnUrl: `https://${process.env.SHOP_CUSTOM_DOMAIN || "admin.shopify.com"}/store/${new URL(request.url).searchParams.get("shop")?.split(".")[0]}/apps/seo-suite/app/pricing`,
    });
  } else if (plan === "Pro") {
    await billing.request({
      plan: "Pro",
      isTest: true,
      returnUrl: `https://${process.env.SHOP_CUSTOM_DOMAIN || "admin.shopify.com"}/store/${new URL(request.url).searchParams.get("shop")?.split(".")[0]}/apps/seo-suite/app/pricing`,
    });
  }

  return null;
};

export default function PricingPage() {
  const { currentPlan } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const isSubmitting = fetcher.state === "submitting";
  const submittingPlan = fetcher.formData?.get("plan");

  const handleSubscribe = (plan: string) => {
    fetcher.submit({ plan }, { method: "POST" });
  };

  return (
    <Page>
      <TitleBar title="Subscription Plans" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <BlockStack gap="400" inlineAlign="center">
              <Text as="h2" variant="headingLg" alignment="center">
                Choose the right plan for your store
              </Text>
              <Text as="p" tone="subdued" alignment="center">
                Upgrade to unlock more AI generations and automated SEO scans.
              </Text>
            </BlockStack>
          </Layout.Section>

          <Layout.Section>
            <Grid>
              <Grid.Cell columnSpan={{xs: 6, sm: 4, md: 4, lg: 4, xl: 4}}>
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text as="h3" variant="headingMd">Free</Text>
                      {currentPlan === "Free" && <Badge tone="success">Current</Badge>}
                    </InlineStack>
                    <Text as="h2" variant="heading2xl">$0<span style={{ fontSize: '1rem', color: 'gray' }}>/mo</span></Text>
                    <List>
                      <List.Item>Basic SEO Audit</List.Item>
                      <List.Item>100 AI Generations / mo</List.Item>
                      <List.Item>Manual Image Compression</List.Item>
                      <List.Item>Basic Schema Markup</List.Item>
                    </List>
                    <Button 
                      disabled={currentPlan === "Free"} 
                      fullWidth
                    >
                      {currentPlan === "Free" ? "Active" : "Downgrade"}
                    </Button>
                  </BlockStack>
                </Card>
              </Grid.Cell>

              <Grid.Cell columnSpan={{xs: 6, sm: 4, md: 4, lg: 4, xl: 4}}>
                <Card background={currentPlan === "Basic" ? "bg-surface-secondary" : "bg-surface"}>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text as="h3" variant="headingMd">Basic</Text>
                      {currentPlan === "Basic" && <Badge tone="success">Current</Badge>}
                    </InlineStack>
                    <Text as="h2" variant="heading2xl">$9.99<span style={{ fontSize: '1rem', color: 'gray' }}>/mo</span></Text>
                    <List>
                      <List.Item>Advanced SEO Audit</List.Item>
                      <List.Item>1,000 AI Generations / mo</List.Item>
                      <List.Item>Bulk Image Compression</List.Item>
                      <List.Item>Weekly Automated Scans</List.Item>
                    </List>
                    <Button 
                      variant={currentPlan === "Basic" ? "plain" : "primary"}
                      disabled={currentPlan === "Basic"} 
                      loading={isSubmitting && submittingPlan === "Basic"}
                      onClick={() => handleSubscribe("Basic")}
                      fullWidth
                    >
                      {currentPlan === "Basic" ? "Active" : "Upgrade to Basic"}
                    </Button>
                  </BlockStack>
                </Card>
              </Grid.Cell>

              <Grid.Cell columnSpan={{xs: 6, sm: 4, md: 4, lg: 4, xl: 4}}>
                <Card background={currentPlan === "Pro" ? "bg-surface-secondary" : "bg-surface"}>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text as="h3" variant="headingMd">Pro</Text>
                      {currentPlan === "Pro" && <Badge tone="success">Current</Badge>}
                    </InlineStack>
                    <Text as="h2" variant="heading2xl">$29.99<span style={{ fontSize: '1rem', color: 'gray' }}>/mo</span></Text>
                    <List>
                      <List.Item>Unlimited AI Generations</List.Item>
                      <List.Item>Custom AI Prompt Templates</List.Item>
                      <List.Item>Daily Automated Scans</List.Item>
                      <List.Item>Priority Support</List.Item>
                    </List>
                    <Button 
                      variant={currentPlan === "Pro" ? "plain" : "primary"}
                      disabled={currentPlan === "Pro"} 
                      loading={isSubmitting && submittingPlan === "Pro"}
                      onClick={() => handleSubscribe("Pro")}
                      fullWidth
                    >
                      {currentPlan === "Pro" ? "Active" : "Upgrade to Pro"}
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