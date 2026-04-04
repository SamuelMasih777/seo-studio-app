import { useState, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Button,
  InlineStack,
  TextField,
  IndexTable,
  Badge,
  Banner,
  useIndexResourceState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

// 1. Fetch products for bulk editing
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  
  const cursor = url.searchParams.get("cursor");
  const direction = url.searchParams.get("direction") || "next";

  const getArgs = () => {
    if (!cursor) return `first: 50, sortKey: UPDATED_AT, reverse: true`;
    if (direction === "prev") return `last: 50, before: "${cursor}", sortKey: UPDATED_AT, reverse: true`;
    return `first: 50, after: "${cursor}", sortKey: UPDATED_AT, reverse: true`;
  };

  const response = await admin.graphql(
    `#graphql
    query getProductsBulk {
      products(${getArgs()}) {
        pageInfo { hasNextPage, hasPreviousPage, startCursor, endCursor }
        edges {
          node {
            id
            title
            seo {
              title
              description
            }
          }
        }
      }
    }`
  );

  const json = await response.json();
  const products = json.data.products.edges.map((e: any) => ({
    id: e.node.id,
    title: e.node.title,
    seoTitle: e.node.seo?.title || "",
    seoDescription: e.node.seo?.description || "",
  }));

  return { 
    products,
    pageInfo: json.data.products.pageInfo
  };
};

// 2. Real Bulk update action using individual mutations (since BulkOperations requires staging files)
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  
  const updatesString = formData.get("updates") as string;
  const updates = JSON.parse(updatesString);

  const errors = [];
  let successCount = 0;

  // Execute mutations sequentially to avoid rate limits on small batches
  for (const update of updates) {
    try {
      const response = await admin.graphql(
        `#graphql
        mutation productUpdateBulk($input: ProductInput!) {
          productUpdate(input: $input) {
            product {
              id
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            input: {
              id: update.id,
              seo: {
                title: update.seoTitle,
                description: update.seoDescription,
              },
            },
          },
        }
      );
      
      const json = await response.json();
      if (json.data?.productUpdate?.userErrors?.length > 0) {
        errors.push({ id: update.id, errors: json.data.productUpdate.userErrors });
      } else {
        successCount++;
      }
    } catch (e) {
      errors.push({ id: update.id, error: String(e) });
    }
  }

  return { success: true, count: successCount, errors };
};

export default function BulkEditorPage() {
  const { products, pageInfo } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  
  const {
    selectedResources,
    allResourcesSelected,
    handleSelectionChange,
    clearSelection,
  } = useIndexResourceState(products);
  
  // Track edits in state
  const [edits, setEdits] = useState<{ [key: string]: any }>({});
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    if (fetcher.data?.success) {
      setShowBanner(true);
      setEdits({}); // Clear edits on successful save
      clearSelection();
    }
  }, [fetcher.data, clearSelection]);

  const handleNextPage = () => {
    const params = new URLSearchParams(window.location.search);
    params.set("cursor", pageInfo.endCursor);
    params.set("direction", "next");
    navigate(`?${params.toString()}`);
  };

  const handlePrevPage = () => {
    const params = new URLSearchParams(window.location.search);
    params.set("cursor", pageInfo.startCursor);
    params.set("direction", "prev");
    navigate(`?${params.toString()}`);
  };

  const handleEdit = (id: string, field: string, value: string) => {
    setEdits((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        [field]: value,
      },
    }));
  };

  const handleBulkSave = () => {
    setShowBanner(false);
    // Collect all edits into an array, falling back to original values if a field wasn't edited
    const updatesToSave = Object.keys(edits).map((id) => {
      const originalProduct = products.find((p: any) => p.id === id);
      return {
        id,
        seoTitle: edits[id].seoTitle ?? originalProduct?.seoTitle,
        seoDescription: edits[id].seoDescription ?? originalProduct?.seoDescription,
      };
    });

    fetcher.submit(
      { updates: JSON.stringify(updatesToSave) },
      { method: "POST" }
    );
  };

  const isSaving = fetcher.state === "submitting";
  const hasEdits = Object.keys(edits).length > 0;

  const rowMarkup = products.map(
    (product: any, index: number) => {
      // Use edited value if it exists, otherwise fallback to original
      const currentSeoTitle = edits[product.id]?.seoTitle ?? product.seoTitle;
      const currentSeoDescription = edits[product.id]?.seoDescription ?? product.seoDescription;

      const titleLength = currentSeoTitle.length;
      const descLength = currentSeoDescription.length;

      return (
        <IndexTable.Row
          id={product.id}
          key={product.id}
          position={index}
          selected={selectedResources.includes(product.id)}
        >
          <IndexTable.Cell>
            <Text variant="bodyMd" fontWeight="bold" as="span">
              {product.title}
            </Text>
          </IndexTable.Cell>
          
          <IndexTable.Cell>
            <div style={{ padding: '8px 0' }}>
              <TextField
                labelHidden
                label="Meta Title"
                value={currentSeoTitle}
                onChange={(value) => handleEdit(product.id, "seoTitle", value)}
                autoComplete="off"
                placeholder="Custom meta title..."
              />
              <div style={{ marginTop: '4px' }}>
                <Text as="span" variant="bodySm" tone={titleLength > 60 ? "critical" : "subdued"}>
                  {titleLength} / 60
                </Text>
              </div>
            </div>
          </IndexTable.Cell>

          <IndexTable.Cell>
            <div style={{ padding: '8px 0' }}>
              <TextField
                labelHidden
                label="Meta Description"
                value={currentSeoDescription}
                onChange={(value) => handleEdit(product.id, "seoDescription", value)}
                autoComplete="off"
                multiline={2}
                placeholder="Custom meta description..."
              />
              <div style={{ marginTop: '4px' }}>
                <Text as="span" variant="bodySm" tone={descLength > 160 ? "critical" : "subdued"}>
                  {descLength} / 160
                </Text>
              </div>
            </div>
          </IndexTable.Cell>

          <IndexTable.Cell>
            {edits[product.id] ? (
              <Badge tone="warning">Edited</Badge>
            ) : (
              <Badge>Unchanged</Badge>
            )}
          </IndexTable.Cell>
        </IndexTable.Row>
      );
    }
  );

  return (
    <Page fullWidth>
      <TitleBar title="Bulk SEO Editor" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card padding="0">
              <BlockStack gap="400">
                <div style={{ padding: '16px' }}>
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="200">
                      <Text as="h2" variant="headingLg">
                        Spreadsheet Editor
                      </Text>
                      <Text as="p" tone="subdued">
                        Quickly edit Meta Titles and Descriptions for multiple products at once. Changes are saved locally until you hit "Save All Edits".
                      </Text>
                    </BlockStack>
                    <Button 
                      variant="primary" 
                      disabled={!hasEdits} 
                      loading={isSaving}
                      onClick={handleBulkSave}
                    >
                      Save All Edits ({Object.keys(edits).length})
                    </Button>
                  </InlineStack>
                </div>

                {showBanner && fetcher.data && (
                  <div style={{ padding: '0 16px', paddingBottom: '16px' }}>
                    {fetcher.data.errors && fetcher.data.errors.length > 0 ? (
                      <Banner tone="warning" title={`Saved ${fetcher.data.count} products. Encountered errors on ${fetcher.data.errors.length} items.`} onDismiss={() => setShowBanner(false)} />
                    ) : (
                      <Banner tone="success" title={`Successfully updated ${fetcher.data.count} products!`} onDismiss={() => setShowBanner(false)} />
                    )}
                  </div>
                )}

                <IndexTable
                  resourceName={{ singular: 'product', plural: 'products' }}
                  itemCount={products.length}
                  selectedItemsCount={
                    allResourcesSelected ? 'All' : selectedResources.length
                  }
                  onSelectionChange={handleSelectionChange}
                  headings={[
                    { title: 'Product Name' },
                    { title: 'Meta Title (60 chars max)' },
                    { title: 'Meta Description (160 chars max)' },
                    { title: 'Status' },
                  ]}
                  pagination={{
                    hasNext: pageInfo.hasNextPage,
                    hasPrevious: pageInfo.hasPreviousPage,
                    onNext: handleNextPage,
                    onPrevious: handlePrevPage,
                  }}
                >
                  {rowMarkup}
                </IndexTable>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}