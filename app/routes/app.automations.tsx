import { useState, useCallback } from "react";
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
  Badge,
  Select,
  IndexTable,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const automations = await prisma.scheduledAutomation.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });

  return { automations };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  
  const intent = formData.get("intent") as string;
  const type = formData.get("type") as string;
  const frequency = formData.get("frequency") as string;

  if (intent === "toggle") {
    const id = formData.get("id") as string;
    const currentStatus = formData.get("status") as string;
    
    await prisma.scheduledAutomation.update({
      where: { id, shop },
      data: { status: currentStatus === "active" ? "paused" : "active" },
    });
    return { success: true };
  }

  if (intent === "create") {
    // Check if one already exists for this type
    const existing = await prisma.scheduledAutomation.findFirst({
      where: { shop, type }
    });

    if (existing) {
      await prisma.scheduledAutomation.update({
        where: { id: existing.id },
        data: { frequency, status: "active" },
      });
    } else {
      await prisma.scheduledAutomation.create({
        data: { shop, type, frequency },
      });
    }
    return { success: true };
  }

  return null;
};

export default function AutomationsPage() {
  const { automations } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const [type, setType] = useState("seo_audit");
  const [frequency, setFrequency] = useState("weekly");

  const handleToggle = (id: string, status: string) => {
    fetcher.submit(
      { intent: "toggle", id, status },
      { method: "POST" }
    );
  };

  const handleCreate = () => {
    fetcher.submit(
      { intent: "create", type, frequency },
      { method: "POST" }
    );
  };

  const isSubmitting = fetcher.state === "submitting";

  const rowMarkup = automations.map((auto: any, index: number) => (
    <IndexTable.Row id={auto.id} key={auto.id} position={index}>
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="bold" as="span">
          {auto.type === "seo_audit" ? "Full Store SEO Audit" : "Broken Link Scanner"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone="info">{auto.frequency.charAt(0).toUpperCase() + auto.frequency.slice(1)}</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {auto.lastRunAt ? new Date(auto.lastRunAt).toLocaleDateString() : "Never"}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={auto.status === "active" ? "success" : "warning"}>
          {auto.status === "active" ? "Active" : "Paused"}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Button 
          size="micro" 
          onClick={() => handleToggle(auto.id, auto.status)}
          tone={auto.status === "active" ? "critical" : "success"}
        >
          {auto.status === "active" ? "Pause" : "Resume"}
        </Button>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page>
      <TitleBar title="Scheduled Automations" />

      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card padding="0">
              <BlockStack gap="400">
                <div style={{ padding: '16px 16px 0 16px' }}>
                  <Text as="h2" variant="headingLg">Your Active Jobs</Text>
                  <Text as="p" tone="subdued">Manage automated background tasks running on your store.</Text>
                </div>
                
                {automations.length === 0 ? (
                  <div style={{ padding: '16px' }}>
                    <Text as="p" tone="subdued">No scheduled automations found.</Text>
                  </div>
                ) : (
                  <IndexTable
                    resourceName={{ singular: 'automation', plural: 'automations' }}
                    itemCount={automations.length}
                    headings={[
                      { title: 'Job Type' },
                      { title: 'Frequency' },
                      { title: 'Last Run' },
                      { title: 'Status' },
                      { title: 'Action' },
                    ]}
                    selectable={false}
                  >
                    {rowMarkup}
                  </IndexTable>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">Add New Automation</Text>
                <Text as="p" tone="subdued">Set up a new background job to keep your SEO healthy automatically.</Text>
                
                <Select
                  label="Job Type"
                  options={[
                    { label: "Full Store SEO Audit", value: "seo_audit" },
                    { label: "Broken Link Scanner", value: "broken_link_scan" },
                  ]}
                  value={type}
                  onChange={setType}
                />
                
                <Select
                  label="Run Frequency"
                  options={[
                    { label: "Daily", value: "daily" },
                    { label: "Weekly", value: "weekly" },
                    { label: "Monthly", value: "monthly" },
                  ]}
                  value={frequency}
                  onChange={setFrequency}
                />

                <Button variant="primary" loading={isSubmitting} onClick={handleCreate} fullWidth>
                  Schedule Job
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}