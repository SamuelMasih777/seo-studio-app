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
  Select,
  Badge,
  Divider,
  IndexTable,
  Thumbnail,
  Banner,
  useIndexResourceState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { MagicIcon, CheckCircleIcon, ImageIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";

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
    query getProductsContent {
      products(${getArgs()}) {
        pageInfo { hasNextPage, hasPreviousPage, startCursor, endCursor }
        edges {
          node {
            id
            title
            descriptionHtml
            featuredImage {
              url
              altText
            }
          }
        }
      }
    }`
  );

  const json = await response.json();
  return { 
    products: json.data.products.edges.map((e: any) => e.node),
    pageInfo: json.data.products.pageInfo
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "bulk_optimize") {
    const { admin } = await authenticate.admin(request);
    const selectedIds = JSON.parse(formData.get("selectedIds") as string);
    
    // We will do a real loop to fetch, mock-generate, and save each product
    let successCount = 0;
    
    for (const id of selectedIds) {
      // 1. Fetch the product title to use as the keyword
      const fetchResponse = await admin.graphql(
        `#graphql
        query getProductTitle($id: ID!) {
          product(id: $id) {
            title
          }
        }`,
        { variables: { id } }
      );
      const fetchJson = await fetchResponse.json();
      const productTitle = fetchJson.data.product?.title || "product";

      // 2. Simulate AI Generation
      await new Promise((resolve) => setTimeout(resolve, 800)); // Simulate AI delay
      const generatedContent = `Conquer the mountain this winter with our premium ${productTitle}. Engineered for maximum control and speed, this board ensures you slide effortlessly through fresh powder and packed snow alike. Don't miss out on the ultimate winter upgrade.`;
      const htmlContent = `<p>${generatedContent}</p>`;

      // 3. Save to Shopify
      await admin.graphql(
        `#graphql
        mutation productUpdateBulk($input: ProductInput!) {
          productUpdate(input: $input) {
            product {
              id
            }
          }
        }`,
        {
          variables: {
            input: {
              id,
              descriptionHtml: htmlContent,
            },
          },
        }
      );
      successCount++;
    }
    
    return { success: true, type: "bulk", count: successCount };
  }

  // Intent 1: Generate AI Content (Mocked API Call for now)
  if (intent === "generate") {
    const keyword = formData.get("keyword") as string;
    const tone = formData.get("tone") as string;

    await new Promise((resolve) => setTimeout(resolve, 1500)); 
    
    let generatedContent = "";
    if (tone === "professional") {
      generatedContent = `Experience the peak of winter performance with our newly engineered ${keyword}. Crafted with premium materials to ensure durability and precision, this product is designed for serious enthusiasts looking to elevate their winter experience.`;
    } else if (tone === "casual") {
      generatedContent = `Get ready to shred! This ${keyword} is exactly what you need to hit the slopes this season. It's super fun, easy to ride, and looks amazing on the snow. Grab yours before they sell out!`;
    } else if (tone === "humorous") {
      generatedContent = `Look, we both know you're not going to the Olympics, but this ${keyword} will make you look like you could. It's fast, it's sleek, and it will distract everyone from your terrible form. You're welcome.`;
    } else {
      generatedContent = `Conquer the mountain this winter with our premium ${keyword}. Engineered for maximum control and speed, this board ensures you slide effortlessly through fresh powder and packed snow alike. Don't miss out on the ultimate winter upgrade.`;
    }

    return { success: true, type: "generation", generatedContent };
  }

  // Intent 2: Save to Shopify
  if (intent === "save") {
    const { admin } = await authenticate.admin(request);
    const id = formData.get("id") as string;
    const descriptionHtml = formData.get("descriptionHtml") as string;

    const response = await admin.graphql(
      `#graphql
      mutation productUpdate($input: ProductInput!) {
        productUpdate(input: $input) {
          product {
            id
            descriptionHtml
          }
        }
      }`,
      {
        variables: {
          input: {
            id,
            descriptionHtml,
          },
        },
      }
    );

    const json = await response.json();
    return { success: true, type: "save", data: json.data.productUpdate };
  }

  return { success: false, message: "Invalid intent" };
};

export default function ContentOptimizationPage() {
  const { products, pageInfo } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();

  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const {
    selectedResources,
    allResourcesSelected,
    handleSelectionChange,
    clearSelection,
  } = useIndexResourceState(products);
  const [showBanner, setShowBanner] = useState<{show: boolean, type: string, count: number}>({show: false, type: "", count: 0});

  // AI Config State
  const [keyword, setKeyword] = useState("");
  const [tone, setTone] = useState("persuasive");
  
  // Content State
  const [originalContent, setOriginalContent] = useState("");
  const [optimizedContent, setOptimizedContent] = useState("");

  useEffect(() => {
    if (fetcher.data?.success) {
      if (fetcher.data.type === "generation") {
        setOptimizedContent(fetcher.data.generatedContent);
      } else if (fetcher.data.type === "save") {
        setShowBanner({ show: true, type: "single", count: 1 });
      } else if (fetcher.data.type === "bulk") {
        setShowBanner({ show: true, type: "bulk", count: fetcher.data.count });
        clearSelection(); // clear selection
      }
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

  const toneOptions = [
    { label: "Professional", value: "professional" },
    { label: "Casual", value: "casual" },
    { label: "Persuasive", value: "persuasive" },
    { label: "Humorous", value: "humorous" },
  ];

  const handleSelectProduct = (product: any) => {
    setSelectedProduct(product);
    const plainText = product.descriptionHtml.replace(/<[^>]+>/g, '');
    setOriginalContent(plainText);
    setOptimizedContent(""); 
    setKeyword(product.title); 
    setShowBanner({show: false, type: "", count: 0});
  };

  const handleGenerate = () => {
    setShowBanner({show: false, type: "", count: 0});
    fetcher.submit(
      { 
        intent: "generate",
        keyword,
        tone,
        original: originalContent
      },
      { method: "POST" }
    );
  };

  const handleApplyToShopify = () => {
    const htmlContent = `<p>${optimizedContent.replace(/\n/g, '<br>')}</p>`;
    fetcher.submit(
      { 
        intent: "save",
        id: selectedProduct.id, 
        descriptionHtml: htmlContent 
      },
      { method: "POST" }
    );
  };

  const handleBulkOptimize = () => {
    fetcher.submit(
      {
        intent: "bulk_optimize",
        selectedIds: JSON.stringify(selectedResources)
      },
      { method: "POST" }
    );
  };

  const isGenerating = fetcher.state === "submitting" && fetcher.formData?.get("intent") === "generate";
  const isSaving = fetcher.state === "submitting" && fetcher.formData?.get("intent") === "save";
  const isBulkOptimizing = fetcher.state === "submitting" && fetcher.formData?.get("intent") === "bulk_optimize";

  const rowMarkup = products.map((product: any, index: number) => (
    <IndexTable.Row
      id={product.id}
      key={product.id}
      position={index}
      selected={selectedResources.includes(product.id)}
    >
      <IndexTable.Cell>
        <Thumbnail
          source={product.featuredImage?.url || ImageIcon}
          alt={product.featuredImage?.altText || product.title}
          size="small"
        />
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="bold" as="span">
          {product.title}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {product.descriptionHtml.length > 50 ? (
          <Badge tone="success">Has Description</Badge>
        ) : (
          <Badge tone="warning">Short Description</Badge>
        )}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Button size="micro" onClick={() => handleSelectProduct(product)}>
          Optimize
        </Button>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  const promotedBulkActions = [
    {
      content: 'Auto-Generate AI Descriptions',
      onAction: handleBulkOptimize,
    },
  ];

  return (
    <Page>
      <TitleBar title="AI Content Optimization" />
      <BlockStack gap="500">
        <Layout>
          {showBanner.show && (
            <Layout.Section>
              <Banner 
                tone="success" 
                title={showBanner.type === "bulk" ? `Successfully auto-generated and saved descriptions for ${showBanner.count} products!` : "Product description updated in Shopify!"} 
                onDismiss={() => setShowBanner({show: false, type: "", count: 0})} 
              />
            </Layout.Section>
          )}

          {!selectedProduct ? (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      Select Products to Optimize
                    </Text>
                    <Button 
                      variant="primary" 
                      icon={MagicIcon} 
                      disabled={selectedResources.length === 0}
                      loading={isBulkOptimizing}
                      onClick={handleBulkOptimize}
                    >
                      Bulk Auto-Generate Selected ({selectedResources.length})
                    </Button>
                  </InlineStack>
                  <IndexTable
                    resourceName={{ singular: 'product', plural: 'products' }}
                    itemCount={products.length}
                    selectedItemsCount={
                      allResourcesSelected ? 'All' : selectedResources.length
                    }
                    onSelectionChange={handleSelectionChange}
                    promotedBulkActions={promotedBulkActions}
                    headings={[
                      { title: 'Image' },
                      { title: 'Product Name' },
                      { title: 'Status' },
                      { title: 'Action' },
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
          ) : (
            <>
              <Layout.Section>
                <Card>
                  <BlockStack gap="400">
                    <InlineStack gap="300" blockAlign="center">
                      <Button variant="plain" onClick={() => setSelectedProduct(null)}>
                        &larr; Back to List
                      </Button>
                      <Text as="h2" variant="headingLg">
                        Editing: {selectedProduct.title}
                      </Text>
                    </InlineStack>
                  </BlockStack>
                </Card>
              </Layout.Section>

              {/* Configuration Panel */}
              <Layout.Section variant="oneThird">
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">
                      AI Settings
                    </Text>
                    
                    <TextField
                      label="Target Keyword"
                      value={keyword}
                      onChange={setKeyword}
                      autoComplete="off"
                      helpText="The main SEO keyword you want to rank for."
                    />

                    <Select
                      label="Brand Tone"
                      options={toneOptions}
                      onChange={setTone}
                      value={tone}
                    />

                    <Button
                      icon={MagicIcon}
                      variant="primary"
                      loading={isGenerating}
                      onClick={handleGenerate}
                      fullWidth
                    >
                      {isGenerating ? "Generating..." : "Generate AI Content"}
                    </Button>

                    <Divider />

                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">
                        Content Word Count
                      </Text>
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="p" tone="subdued">Before:</Text>
                        <Badge>{originalContent.split(' ').filter(Boolean).length} words</Badge>
                      </InlineStack>
                      {optimizedContent && (
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="p" tone="subdued">After AI:</Text>
                          <Badge tone="success">{optimizedContent.split(' ').filter(Boolean).length} words</Badge>
                        </InlineStack>
                      )}
                    </BlockStack>
                  </BlockStack>
                </Card>
              </Layout.Section>

              {/* Content Editor */}
              <Layout.Section>
                <BlockStack gap="400">
                  <Card>
                    <BlockStack gap="400">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h3" variant="headingMd">
                          Original Description
                        </Text>
                      </InlineStack>
                      <TextField
                        labelHidden
                        label="Original Content"
                        value={originalContent}
                        onChange={setOriginalContent}
                        multiline={6}
                        autoComplete="off"
                      />
                    </BlockStack>
                  </Card>

                  {optimizedContent && (
                    <Card background="bg-surface-success">
                      <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="h3" variant="headingMd">
                              AI Optimized Result
                            </Text>
                            <Badge tone="success">Ready</Badge>
                          </InlineStack>
                          <Button 
                            variant="primary" 
                            loading={isSaving} 
                            onClick={handleApplyToShopify}
                          >
                            Save to Shopify
                          </Button>
                        </InlineStack>
                        
                        <TextField
                          labelHidden
                          label="Optimized Content"
                          value={optimizedContent}
                          onChange={setOptimizedContent}
                          multiline={6}
                          autoComplete="off"
                        />

                        <InlineStack gap="400">
                          <InlineStack gap="100" blockAlign="center">
                            <CheckCircleIcon fill="#008060" width={16} />
                            <Text as="span" tone="success" variant="bodySm">Keyword Included</Text>
                          </InlineStack>
                          <InlineStack gap="100" blockAlign="center">
                            <CheckCircleIcon fill="#008060" width={16} />
                            <Text as="span" tone="success" variant="bodySm">Tone Matched ({tone})</Text>
                          </InlineStack>
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  )}
                </BlockStack>
              </Layout.Section>
            </>
          )}
        </Layout>
      </BlockStack>
    </Page>
  );
}