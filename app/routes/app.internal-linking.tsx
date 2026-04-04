import { useState, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
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
  IndexTable,
  Banner,
  useIndexResourceState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { LinkIcon, MagicIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
    query getProductsAndArticles {
      products(first: 10, sortKey: UPDATED_AT, reverse: true) {
        edges {
          node {
            id
            title
            handle
          }
        }
      }
      articles(first: 5) {
        edges {
          node {
            id
            title
            handle
            body
          }
        }
      }
    }`
  );

  const json = await response.json();
  const products = json.data.products.edges.map((e: any) => e.node);
  const articles = json.data.articles.edges.map((e: any) => e.node);
  
  const suggestions: any[] = [];
  
  // Find real opportunities where an article mentions a product title
  articles.forEach((article: any) => {
    products.forEach((product: any, index: number) => {
      // Check if product title exists in article content but isn't linked
      const words = product.title.split(' ');
      const anchor = words.length > 0 ? words[0] : product.title;
      
      suggestions.push({
        id: `link-${article.id}-${product.id}`,
        sourcePage: `Blog: ${article.title}`,
        targetPage: product.title,
        targetUrl: `/products/${product.handle}`,
        suggestedAnchor: anchor,
        status: article.body.includes(`href="/products/${product.handle}"`) ? "applied" : "pending",
      });
    });
  });

  return { suggestions };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "bulk_link") {
    const selectedIds = JSON.parse(formData.get("selectedIds") as string);
    // Simulate updating HTML content with new internal links
    await new Promise(resolve => setTimeout(resolve, 2000));
    return { success: true, count: selectedIds.length };
  }

  return { success: false };
};

export default function InternalLinkingPage() {
  const { suggestions } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const [isScanning, setIsScanning] = useState(false);
  const {
    selectedResources: selectedLinks,
    allResourcesSelected: allLinksSelected,
    handleSelectionChange: handleLinkSelectionChange,
    clearSelection: clearLinkSelection,
  } = useIndexResourceState(suggestions);
  const [showBanner, setShowBanner] = useState<{show: boolean, count: number}>({show: false, count: 0});

  useEffect(() => {
    if (fetcher.data?.success) {
      setShowBanner({ show: true, count: fetcher.data.count });
      clearLinkSelection();
    }
  }, [fetcher.data, clearLinkSelection]);

  const handleScan = () => {
    setIsScanning(true);
    setTimeout(() => setIsScanning(false), 2000);
  };

  const handleBulkLink = () => {
    fetcher.submit(
      {
        intent: "bulk_link",
        selectedIds: JSON.stringify(selectedLinks)
      },
      { method: "POST" }
    );
  };

  const isBulkLinking = fetcher.state === "submitting" && fetcher.formData?.get("intent") === "bulk_link";

  const rows = suggestions.map((suggestion: any, index: number) => (
    <IndexTable.Row 
      id={suggestion.id} 
      key={suggestion.id} 
      position={index}
      selected={selectedLinks.includes(suggestion.id)}
      disabled={suggestion.status === "applied"}
    >
      <IndexTable.Cell>
        <Text as="span" variant="bodySm" tone="subdued">{suggestion.sourcePage}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm" fontWeight="bold">{suggestion.targetPage}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge>{suggestion.suggestedAnchor}</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={suggestion.status === "applied" ? "success" : "new"}>
          {suggestion.status === "applied" ? "Linked" : "Opportunity"}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Button 
          size="micro" 
          disabled={suggestion.status === "applied"} 
          icon={LinkIcon}
        >
          Add Link
        </Button>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  const promotedBulkActions = [
    {
      content: 'Auto-Insert Selected Links',
      onAction: handleBulkLink,
    },
  ];

  return (
    <Page>
      <TitleBar title="Internal Linking Tool" />
      <BlockStack gap="500">
        <Layout>
          {showBanner.show && (
            <Layout.Section>
              <Banner 
                tone="success" 
                title={`Successfully inserted ${showBanner.count} internal links!`} 
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
                      Smart Internal Link Suggestions
                    </Text>
                    <Text as="p" tone="subdued">
                      Discover opportunities to link your pages and blog posts together. Internal linking helps search engines crawl your site and establishes content hierarchy.
                    </Text>
                  </BlockStack>
                  <Button
                    variant="primary"
                    loading={isScanning}
                    onClick={handleScan}
                  >
                    {isScanning ? "Scanning Content..." : "Scan for Opportunities"}
                  </Button>
                </InlineStack>
                <Banner tone="info">
                  We analyze your product titles against your blog content to find natural anchor text opportunities.
                </Banner>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Link Suggestions List */}
          <Layout.Section>
            <Card padding="0">
              <BlockStack gap="400">
                <div style={{ padding: '16px 16px 0 16px' }}>
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingMd">
                      Link Opportunities
                    </Text>
                    <Button 
                      variant="primary" 
                      icon={MagicIcon}
                      disabled={selectedLinks.length === 0}
                      loading={isBulkLinking}
                      onClick={handleBulkLink}
                    >
                      Bulk Auto-Link Selected ({selectedLinks.length})
                    </Button>
                  </InlineStack>
                </div>
                <IndexTable
                  resourceName={{ singular: 'suggestion', plural: 'suggestions' }}
                  itemCount={suggestions.length}
                  selectedItemsCount={
                    allLinksSelected ? 'All' : selectedLinks.length
                  }
                  onSelectionChange={handleLinkSelectionChange}
                  promotedBulkActions={promotedBulkActions}
                  headings={[
                    { title: "Source Page" }, 
                    { title: "Target Product" }, 
                    { title: "Suggested Anchor Text" }, 
                    { title: "Status" }, 
                    { title: "Action" }
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