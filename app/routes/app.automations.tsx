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
  Badge,
  Select,
  IndexTable,
  Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { computeNextRunAt } from "../automation-runner.server";

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
    const newStatus = currentStatus === "active" ? "paused" : "active";

    const job = await prisma.scheduledAutomation.findUnique({ where: { id } });

    await prisma.scheduledAutomation.update({
      where: { id, shop },
      data: {
        status: newStatus,
        nextRunAt: newStatus === "active" && job
          ? computeNextRunAt(job.frequency)
          : null,
      },
    });
    return { success: true };
  }

  if (intent === "create") {
    const nextRunAt = computeNextRunAt(frequency);

    const existing = await prisma.scheduledAutomation.findFirst({
      where: { shop, type },
    });

    if (existing) {
      await prisma.scheduledAutomation.update({
        where: { id: existing.id },
        data: { frequency, status: "active", nextRunAt },
      });
    } else {
      await prisma.scheduledAutomation.create({
        data: { shop, type, frequency, nextRunAt },
      });
    }
    return { success: true };
  }

  if (intent === "delete") {
    const id = formData.get("id") as string;
    await prisma.scheduledAutomation.delete({ where: { id, shop } });
    return { success: true };
  }

  return null;
};

function formatDate(d: string | Date | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return String(d);
  }
}

const JOB_LABELS: Record<string, string> = {
  seo_audit: "Full Store SEO Audit",
  broken_link_scan: "Broken Link Scanner",
};

export default function AutomationsPage() {
  const { automations } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const [type, setType] = useState("seo_audit");
  const [frequency, setFrequency] = useState("weekly");

  const handleToggle = (id: string, status: string) => {
    fetcher.submit(
      { intent: "toggle", id, status },
      { method: "POST" },
    );
  };

  const handleDelete = (id: string) => {
    if (confirm("Delete this automation?")) {
      fetcher.submit({ intent: "delete", id }, { method: "POST" });
    }
  };

  const handleCreate = () => {
    fetcher.submit(
      { intent: "create", type, frequency },
      { method: "POST" },
    );
  };

  const isSubmitting = fetcher.state === "submitting";

  const rowMarkup = automations.map((auto: any, index: number) => (
    <IndexTable.Row id={auto.id} key={auto.id} position={index}>
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="bold" as="span">
          {JOB_LABELS[auto.type] || auto.type}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone="info">
          {auto.frequency.charAt(0).toUpperCase() + auto.frequency.slice(1)}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>{formatDate(auto.lastRunAt)}</IndexTable.Cell>
      <IndexTable.Cell>{formatDate(auto.nextRunAt)}</IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={auto.status === "active" ? "success" : "warning"}>
          {auto.status === "active" ? "Active" : "Paused"}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="200">
          <Button
            size="micro"
            onClick={() => handleToggle(auto.id, auto.status)}
            tone={auto.status === "active" ? "critical" : undefined}
          >
            {auto.status === "active" ? "Pause" : "Resume"}
          </Button>
          <Button size="micro" tone="critical" onClick={() => handleDelete(auto.id)}>
            Delete
          </Button>
        </InlineStack>
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
                <div style={{ padding: "16px 16px 0 16px" }}>
                  <Text as="h2" variant="headingLg">Your Scheduled Jobs</Text>
                  <Text as="p" tone="subdued">
                    Automated SEO audits and broken link scans run on schedule via a cron endpoint.
                  </Text>
                </div>

                {automations.length === 0 ? (
                  <div style={{ padding: "16px" }}>
                    <Banner tone="info">
                      <Text as="p">No scheduled automations yet. Create one from the sidebar.</Text>
                    </Banner>
                  </div>
                ) : (
                  <IndexTable
                    resourceName={{ singular: "automation", plural: "automations" }}
                    itemCount={automations.length}
                    headings={[
                      { title: "Job Type" },
                      { title: "Frequency" },
                      { title: "Last Run" },
                      { title: "Next Run" },
                      { title: "Status" },
                      { title: "Actions" },
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
                <Text as="p" tone="subdued">
                  Schedule a recurring SEO audit or broken link scan. Jobs are executed automatically.
                </Text>

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

                <Button
                  variant="primary"
                  loading={isSubmitting}
                  onClick={handleCreate}
                  fullWidth
                >
                  Schedule Job
                </Button>
              </BlockStack>
            </Card>

            <div style={{ marginTop: 16 }}>
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingMd">How it works</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Jobs run on a scheduled interval. When a job is due, the system
                    automatically performs the scan using your store's data and updates
                    the dashboard with fresh results.
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Paused jobs will not run until resumed. You can delete jobs you no longer need.
                  </Text>
                </BlockStack>
              </Card>
            </div>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
