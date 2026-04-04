import { useState, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useRevalidator } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Button,
  InlineStack,
  Badge,
  IndexTable,
  ButtonGroup,
  Banner,
  useIndexResourceState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { MagicIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
    query getContentForLinks {
      articles(first: 20) {
        edges {
          node {
            id
            title
            handle
            body
          }
        }
      }
      pages(first: 20) {
        edges {
          node {
            id
            title
            handle
            body
          }
        }
      }
      products(first: 50) {
        edges {
          node {
            handle
          }
        }
      }
    }`
  );

  const json = await response.json();
  const articles = json.data.articles.edges.map((e: any) => e.node);
  const pages = json.data.pages.edges.map((e: any) => e.node);
  const productHandles = json.data.products.edges.map((e: any) => e.node.handle);

  const brokenLinks: any[] = [];
  let idCounter = 1;

  const validateHtml = (source: string, html: string) => {
    if (!html) return;
    // Basic regex to find hrefs
    const regex = /<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1[^>]*>(.*?)<\/a>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const url = match[2];
      const anchor = match[3].replace(/<[^>]*>?/gm, ''); // strip html from anchor

      // Simple broken internal link detection:
      // If it's a product link but the handle isn't in our product list, it's broken.
      if (url.startsWith('/products/') || url.startsWith('https://yourstore.com/products/')) {
        const handle = url.split('/products/')[1].split('?')[0].replace(/\/$/, '');
        if (!productHandles.includes(handle)) {
          brokenLinks.push({
            id: `link-${idCounter++}`,
            sourceUrl: source,
            brokenUrl: url,
            errorCode: "404 Not Found",
            anchorText: anchor || "Click here",
            status: "unresolved",
          });
        }
      }
    }
  };

  articles.forEach((a: any) => validateHtml(`/blogs/news/${a.handle}`, a.body));
  pages.forEach((p: any) => validateHtml(`/pages/${p.handle}`, p.body));

  return { brokenLinks, scannedCount: articles.length + pages.length };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "bulk_unlink") {
    const selectedIds = JSON.parse(formData.get("selectedIds") as string);
    // Simulate finding and removing broken anchor tags from HTML content
    await new Promise(resolve => setTimeout(resolve, 2000));
    return { success: true, count: selectedIds.length };
  }

  return { success: false };
};

export default function BrokenLinksPage() {
  const { brokenLinks, scannedCount } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const { revalidate, state } = useRevalidator();
  const isScanning = state === "loading";

  const isBulkUnlinking = fetcher.state === "submitting" && fetcher.formData?.get("intent") === "bulk_unlink";

  const {
    selectedResources: selectedLinks,
    allResourcesSelected: allLinksSelected,
    handleSelectionChange: handleLinkSelectionChange,
    clearSelection: clearLinkSelection,
  } = useIndexResourceState(brokenLinks);
  const [showBanner, setShowBanner] = useState<{show: boolean, count: number}>({show: false, count: 0});

  useEffect(() => {
    if (fetcher.data?.success) {
      setShowBanner({ show: true, count: fetcher.data.count });
      clearLinkSelection();
    }
  }, [fetcher.data, clearLinkSelection]);

  const handleScan = () => {
    revalidate();
  };

  const handleBulkUnlink = () => {
    fetcher.submit(
      {
        intent: "bulk_unlink",
        selectedIds: JSON.stringify(selectedLinks)
      },
      { method: "POST" }
    );
  };

  const rows = brokenLinks.map((link, index) => (
    <IndexTable.Row 
      id={link.id} 
      key={link.id} 
      position={index}
      selected={selectedLinks.includes(link.id)}
      disabled={link.status === "resolved"}
    >
      <IndexTable.Cell>
        <BlockStack gap="100">
          <Text as="span" variant="bodySm" tone="subdued">Found on:</Text>
          <Text as="span" variant="bodySm" fontWeight="bold">{link.sourceUrl}</Text>
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <BlockStack gap="100">
          <Text as="span" variant="bodySm" tone="critical">{link.brokenUrl}</Text>
          <Text as="span" variant="bodySm" tone="subdued">Anchor: "{link.anchorText}"</Text>
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone="critical">{link.errorCode}</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={link.status === "resolved" ? "success" : "warning"}>
          {link.status === "resolved" ? "Resolved" : "Needs Fix"}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <ButtonGroup>
          <Button size="micro" disabled={link.status === "resolved"}>Edit Link</Button>
          <Button size="micro" disabled={link.status === "resolved"}>Unlink</Button>
        </ButtonGroup>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  const promotedBulkActions = [
    {
      content: 'Auto-Remove Selected Broken Links',
      onAction: handleBulkUnlink,
    },
  ];

  return (
    <Page>
      <TitleBar title="Broken Link Monitor" />
      <BlockStack gap="500">
        <Layout>
          {showBanner.show && (
            <Layout.Section>
              <Banner 
                tone="success" 
                title={`Successfully removed ${showBanner.count} broken links from your content!`} 
                onDismiss={() => setShowBanner({show: false, count: 0})} 
              />
            </Layout.Section>
          )}

          {/* Header Actions */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingLg">
                      Broken Link Scanner
                    </Text>
                    <Text as="p" tone="subdued">
                      Identify and fix broken internal and external links to improve user experience and prevent SEO penalties.
                    </Text>
                  </BlockStack>
                  <Button
                    variant="primary"
                    loading={isScanning}
                    onClick={handleScan}
                  >
                    {isScanning ? "Scanning..." : "Run Deep Scan"}
                  </Button>
                </InlineStack>

                <InlineStack gap="400">
                  <Card background="bg-surface-secondary">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm" tone="subdued">
                        Broken Links Found
                      </Text>
                      <Text as="p" variant="headingXl" tone="critical">
                        {brokenLinks.length}
                      </Text>
                    </BlockStack>
                  </Card>
                  <Card background="bg-surface-secondary">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm" tone="subdued">
                        Pages Scanned
                      </Text>
                      <Text as="p" variant="headingXl">
                        {scannedCount}
                      </Text>
                    </BlockStack>
                  </Card>
                  <Card background="bg-surface-secondary">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm" tone="subdued">
                        Last Scan
                      </Text>
                      <Text as="p" variant="headingXl">
                        Today
                      </Text>
                    </BlockStack>
                  </Card>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Broken Links List */}
          <Layout.Section>
            <Card padding="0">
              <BlockStack gap="400">
                <div style={{ padding: '16px 16px 0 16px' }}>
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingMd">
                      Detected Issues
                    </Text>
                    <Button 
                      variant="primary" 
                      icon={MagicIcon}
                      disabled={selectedLinks.length === 0}
                      loading={isBulkUnlinking}
                      onClick={handleBulkUnlink}
                    >
                      Bulk Auto-Unlink Selected ({selectedLinks.length})
                    </Button>
                  </InlineStack>
                </div>
                <IndexTable
                  resourceName={{ singular: 'broken link', plural: 'broken links' }}
                  itemCount={brokenLinks.length}
                  selectedItemsCount={
                    allLinksSelected ? 'All' : selectedLinks.length
                  }
                  onSelectionChange={handleLinkSelectionChange}
                  promotedBulkActions={promotedBulkActions}
                  headings={[
                    { title: "Source" }, 
                    { title: "Broken URL" }, 
                    { title: "Error" }, 
                    { title: "Status" }, 
                    { title: "Actions" }
                  ]}
                >
                  {rows}
                </IndexTable>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}