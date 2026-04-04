import { useState, useCallback, useEffect } from "react";
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
  Tabs,
  Badge,
  Banner,
  IndexTable,
  Thumbnail,
  useIndexResourceState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { MagicIcon, ImageIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  
  // Extract cursors and active tab from URL search params
  const productCursor = url.searchParams.get("productCursor");
  const collectionCursor = url.searchParams.get("collectionCursor");
  const pageCursor = url.searchParams.get("pageCursor");
  
  const productDirection = url.searchParams.get("productDirection") || "next";
  const collectionDirection = url.searchParams.get("collectionDirection") || "next";
  const pageDirection = url.searchParams.get("pageDirection") || "next";

  // Build the arguments string for each resource
  const getArgs = (cursor: string | null, direction: string) => {
    if (!cursor) return `first: 50, sortKey: UPDATED_AT, reverse: true`;
    if (direction === "prev") return `last: 50, before: "${cursor}", sortKey: UPDATED_AT, reverse: true`;
    return `first: 50, after: "${cursor}", sortKey: UPDATED_AT, reverse: true`;
  };

  const response = await admin.graphql(
    `#graphql
    query getData {
      products(${getArgs(productCursor, productDirection)}) {
        pageInfo { hasNextPage, hasPreviousPage, startCursor, endCursor }
        edges {
          node {
            id
            title
            handle
            description
            featuredImage {
              url
              altText
            }
            seo {
              title
              description
            }
          }
        }
      }
      collections(${getArgs(collectionCursor, collectionDirection)}) {
        pageInfo { hasNextPage, hasPreviousPage, startCursor, endCursor }
        edges {
          node {
            id
            title
            handle
            description
            image {
              url
              altText
            }
            seo {
              title
              description
            }
          }
        }
      }
      pages(${getArgs(pageCursor, pageDirection)}) {
        pageInfo { hasNextPage, hasPreviousPage, startCursor, endCursor }
        edges {
          node {
            id
            title
            handle
            body
            metafields(first: 2, namespace: "global") {
              edges {
                node {
                  id
                  key
                  value
                }
              }
            }
          }
        }
      }
    }`
  );

  const json = await response.json();
  return { 
    products: {
      data: json.data.products.edges.map((e: any) => e.node),
      pageInfo: json.data.products.pageInfo,
    },
    collections: {
      data: json.data.collections.edges.map((e: any) => e.node),
      pageInfo: json.data.collections.pageInfo,
    },
    pages: {
      data: json.data.pages.edges.map((e: any) => e.node),
      pageInfo: json.data.pages.pageInfo,
    }
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  
  const intent = formData.get("intent") as string;

  if (intent === "bulk_optimize") {
    const selectedIds = JSON.parse(formData.get("selectedIds") as string);
    let successCount = 0;

    for (const id of selectedIds) {
      // 1. Fetch the title to use as the keyword based on resource type
      let title = "Resource";
      if (id.includes("Product")) {
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
        title = fetchJson.data.product?.title || "Product";
      } else if (id.includes("Collection")) {
        const fetchResponse = await admin.graphql(
          `#graphql
          query getCollectionTitle($id: ID!) {
            collection(id: $id) {
              title
            }
          }`,
          { variables: { id } }
        );
        const fetchJson = await fetchResponse.json();
        title = fetchJson.data.collection?.title || "Collection";
      } else if (id.includes("Page")) {
        const fetchResponse = await admin.graphql(
          `#graphql
          query getPageTitle($id: ID!) {
            page(id: $id) {
              title
            }
          }`,
          { variables: { id } }
        );
        const fetchJson = await fetchResponse.json();
        title = fetchJson.data.page?.title || "Page";
      }

      // 2. Simulate AI Generation
      await new Promise((resolve) => setTimeout(resolve, 800)); // Simulate AI delay
      const generatedTitle = `Buy ${title} | Best Winter Gear 2024`;
      const generatedDescription = `Shop the latest ${title}. High quality, durable, and affordable. Enjoy free shipping on all orders today!`;

      // 3. Save to Shopify
      if (id.includes("Product")) {
        await admin.graphql(
          `#graphql
          mutation productUpdateBulk($input: ProductInput!) {
            productUpdate(input: $input) {
              product { id }
            }
          }`,
          { variables: { input: { id, seo: { title: generatedTitle, description: generatedDescription } } } }
        );
      } else if (id.includes("Collection")) {
        await admin.graphql(
          `#graphql
          mutation collectionUpdateBulk($input: CollectionInput!) {
            collectionUpdate(input: $input) {
              collection { id }
            }
          }`,
          { variables: { input: { id, seo: { title: generatedTitle, description: generatedDescription } } } }
        );
      } else if (id.includes("Page")) {
        await admin.graphql(
          `#graphql
          mutation pageUpdateBulk($id: ID!, $page: PageUpdateInput!) {
            pageUpdate(id: $id, page: $page) {
              page { id }
            }
          }`,
          { 
            variables: { 
              id, 
              page: { 
                metafields: [
                  { namespace: "global", key: "title_tag", type: "single_line_text_field", value: generatedTitle },
                  { namespace: "global", key: "description_tag", type: "single_line_text_field", value: generatedDescription }
                ]
              } 
            } 
          }
        );
      }
      successCount++;
    }
    
    return { success: true, type: "bulk", count: successCount };
  }

  // Single Save
  const id = formData.get("id") as string;
  const seoTitle = formData.get("seoTitle") as string;
  const seoDescription = formData.get("seoDescription") as string;

  let response;
  if (id.includes("Product")) {
    response = await admin.graphql(
      `#graphql
      mutation productUpdate($input: ProductInput!) {
        productUpdate(input: $input) {
          product {
            id
            seo { title description }
          }
        }
      }`,
      { variables: { input: { id, seo: { title: seoTitle, description: seoDescription } } } }
    );
  } else if (id.includes("Collection")) {
    response = await admin.graphql(
      `#graphql
      mutation collectionUpdate($input: CollectionInput!) {
        collectionUpdate(input: $input) {
          collection {
            id
            seo { title description }
          }
        }
      }`,
      { variables: { input: { id, seo: { title: seoTitle, description: seoDescription } } } }
    );
  } else if (id.includes("Page")) {
    response = await admin.graphql(
      `#graphql
      mutation pageUpdate($id: ID!, $page: PageUpdateInput!) {
        pageUpdate(id: $id, page: $page) {
          page {
            id
            metafields(first: 2, namespace: "global") {
              edges {
                node {
                  id
                  key
                  value
                }
              }
            }
          }
        }
      }`,
      { 
        variables: { 
          id, 
          page: { 
            metafields: [
              { namespace: "global", key: "title_tag", type: "single_line_text_field", value: seoTitle },
              { namespace: "global", key: "description_tag", type: "single_line_text_field", value: seoDescription }
            ]
          } 
        } 
      }
    );
  }

  const json = await response?.json();
  return { success: true, type: "single", data: json?.data };
};

export default function MetaTagsPage() {
  const { products, collections, pages } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  
  const [selected, setSelected] = useState(0);
  const [selectedResource, setSelectedResource] = useState<any>(null);
  
  const activeResources = selected === 0 ? products.data : selected === 1 ? collections.data : pages.data;
  const activePageInfo = selected === 0 ? products.pageInfo : selected === 1 ? collections.pageInfo : pages.pageInfo;

  const handleNextPage = () => {
    const params = new URLSearchParams(window.location.search);
    if (selected === 0) {
      params.set("productCursor", activePageInfo.endCursor);
      params.set("productDirection", "next");
    } else if (selected === 1) {
      params.set("collectionCursor", activePageInfo.endCursor);
      params.set("collectionDirection", "next");
    } else {
      params.set("pageCursor", activePageInfo.endCursor);
      params.set("pageDirection", "next");
    }
    navigate(`?${params.toString()}`);
  };

  const handlePrevPage = () => {
    const params = new URLSearchParams(window.location.search);
    if (selected === 0) {
      params.set("productCursor", activePageInfo.startCursor);
      params.set("productDirection", "prev");
    } else if (selected === 1) {
      params.set("collectionCursor", activePageInfo.startCursor);
      params.set("collectionDirection", "prev");
    } else {
      params.set("pageCursor", activePageInfo.startCursor);
      params.set("pageDirection", "prev");
    }
    navigate(`?${params.toString()}`);
  };

  const getSeoFromResource = (resource: any) => {
    if (resource.id.includes("Page")) {
      const titleMetafield = resource.metafields?.edges?.find((e: any) => e.node.key === "title_tag")?.node?.value;
      const descMetafield = resource.metafields?.edges?.find((e: any) => e.node.key === "description_tag")?.node?.value;
      return { title: titleMetafield, description: descMetafield };
    }
    return resource.seo;
  };

  const {
    selectedResources,
    allResourcesSelected,
    handleSelectionChange,
    clearSelection,
  } = useIndexResourceState(activeResources);
  const [showBanner, setShowBanner] = useState<{show: boolean, type: string, count: number}>({show: false, type: "", count: 0});

  // Form State
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (fetcher.data?.success) {
      if (fetcher.data.type === "bulk") {
        setShowBanner({ show: true, type: "bulk", count: fetcher.data.count });
        clearSelection(); // clear selection
      } else {
        setShowBanner({ show: true, type: "single", count: 1 });
      }
    }
  }, [fetcher.data, clearSelection]);

  const handleTabChange = useCallback((selectedTabIndex: number) => {
    setSelected(selectedTabIndex);
    setSelectedResource(null);
    clearSelection();
  }, [clearSelection]);

  const tabs = [
    { id: "products", content: "Products" },
    { id: "collections", content: "Collections" },
    { id: "pages", content: "Pages" },
  ];

  const handleSelectResource = (resource: any) => {
    setSelectedResource(resource);
    const seo = getSeoFromResource(resource);
    setTitle(seo?.title || resource.title);
    
    let textContent = "";
    if (resource.description) {
      textContent = resource.description;
    } else if (resource.body) {
      textContent = resource.body;
    }
    
    const plainTextDescription = textContent.replace(/<[^>]+>/g, '').substring(0, 160);
    setDescription(seo?.description || plainTextDescription);
    setShowBanner({show: false, type: "", count: 0});
  };

  const handleSave = () => {
    fetcher.submit(
      { 
        intent: "single",
        id: selectedResource.id, 
        seoTitle: title, 
        seoDescription: description 
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

  const isSaving = fetcher.state === "submitting" && fetcher.formData?.get("intent") === "single";
  const isBulkOptimizing = fetcher.state === "submitting" && fetcher.formData?.get("intent") === "bulk_optimize";

  const titleLength = title.length;
  const descriptionLength = description.length;

  const rowMarkup = activeResources.map(
    (resource: any, index: number) => {
      let imageUrl: any = ImageIcon;
      let imageAlt = resource.title;
      if (resource.featuredImage?.url) {
        imageUrl = resource.featuredImage.url;
        imageAlt = resource.featuredImage.altText || resource.title;
      } else if (resource.image?.url) {
        imageUrl = resource.image.url;
        imageAlt = resource.image.altText || resource.title;
      }
      
      const seo = getSeoFromResource(resource);

      return (
        <IndexTable.Row
          id={resource.id}
          key={resource.id}
          position={index}
          selected={selectedResources.includes(resource.id)}
        >
          <IndexTable.Cell>
            <Thumbnail
              source={imageUrl}
              alt={imageAlt}
              size="small"
            />
          </IndexTable.Cell>
          <IndexTable.Cell>
            <Text variant="bodyMd" fontWeight="bold" as="span">
              {resource.title}
            </Text>
          </IndexTable.Cell>
          <IndexTable.Cell>
            {seo?.title ? (
              <Badge tone="success">Custom Title</Badge>
            ) : (
              <Badge tone="warning">Default</Badge>
            )}
          </IndexTable.Cell>
          <IndexTable.Cell>
            {seo?.description ? (
              <Badge tone="success">Custom Desc</Badge>
            ) : (
              <Badge tone="critical">Missing</Badge>
            )}
          </IndexTable.Cell>
          <IndexTable.Cell>
            <Button size="micro" onClick={() => handleSelectResource(resource)}>
              Edit Tags
            </Button>
          </IndexTable.Cell>
        </IndexTable.Row>
      );
    }
  );

  const promotedBulkActions = [
    {
      content: 'Auto-Generate AI Meta Tags',
      onAction: handleBulkOptimize,
    },
  ];

  const resourceNameString = selected === 0 ? "products" : selected === 1 ? "collections" : "pages";
  const resourceNameSingular = selected === 0 ? "product" : selected === 1 ? "collection" : "page";

  return (
    <Page>
      <TitleBar title="Meta Tags Manager" />
      <BlockStack gap="500">
        <Layout>
          {showBanner.show && (
            <Layout.Section>
              <Banner 
                tone="success" 
                title={showBanner.type === "bulk" ? `Successfully auto-generated and saved meta tags for ${showBanner.count} ${resourceNameString}!` : "Meta tags updated successfully!"} 
                onDismiss={() => setShowBanner({show: false, type: "", count: 0})} 
              />
            </Layout.Section>
          )}
          
          <Layout.Section>
            <Card padding="0">
              <Tabs tabs={tabs} selected={selected} onSelect={handleTabChange}>
                {!selectedResource ? (
                  <Card>
                    <BlockStack gap="400">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h2" variant="headingMd">
                          Select {resourceNameString.charAt(0).toUpperCase() + resourceNameString.slice(1)} to Optimize
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
                        resourceName={{ singular: resourceNameSingular, plural: resourceNameString }}
                        itemCount={activeResources.length}
                        selectedItemsCount={
                          allResourcesSelected ? 'All' : selectedResources.length
                        }
                        onSelectionChange={handleSelectionChange}
                        promotedBulkActions={promotedBulkActions}
                        headings={[
                          { title: 'Image' },
                          { title: 'Name' },
                          { title: 'Meta Title' },
                          { title: 'Meta Description' },
                          { title: 'Action' },
                        ]}
                        pagination={{
                          hasNext: activePageInfo.hasNextPage,
                          hasPrevious: activePageInfo.hasPreviousPage,
                          onNext: handleNextPage,
                          onPrevious: handlePrevPage,
                        }}
                      >
                        {rowMarkup}
                      </IndexTable>
                    </BlockStack>
                  </Card>
                ) : (
                  <Card>
                    <BlockStack gap="400">
                      <InlineStack align="space-between" blockAlign="center">
                        <InlineStack gap="300" blockAlign="center">
                          <Button 
                            variant="plain" 
                            onClick={() => setSelectedResource(null)}
                          >
                            &larr; Back to List
                          </Button>
                          <Text as="h2" variant="headingMd">
                            Editing: {selectedResource.title}
                          </Text>
                        </InlineStack>
                        <Button icon={MagicIcon}>Auto-generate with AI</Button>
                      </InlineStack>

                      <BlockStack gap="200">
                        <TextField
                          label="Meta Title"
                          value={title}
                          onChange={setTitle}
                          autoComplete="off"
                          helpText={
                            <InlineStack align="space-between">
                              <Text as="span" tone="subdued">
                                Recommended length: 50-60 characters
                              </Text>
                              <Text as="span" tone={titleLength < 50 || titleLength > 60 ? "critical" : "success"}>
                                {titleLength} / 60
                              </Text>
                            </InlineStack>
                          }
                        />
                      </BlockStack>

                      <BlockStack gap="200">
                        <TextField
                          label="Meta Description"
                          value={description}
                          onChange={setDescription}
                          multiline={4}
                          autoComplete="off"
                          helpText={
                            <InlineStack align="space-between">
                              <Text as="span" tone="subdued">
                                Recommended length: 150-160 characters
                              </Text>
                              <Text as="span" tone={descriptionLength < 150 || descriptionLength > 160 ? "critical" : "success"}>
                                {descriptionLength} / 160
                              </Text>
                            </InlineStack>
                          }
                        />
                      </BlockStack>

                      <InlineStack align="end">
                        <Button variant="primary" loading={isSaving} onClick={handleSave}>
                          Save Changes
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                )}
              </Tabs>
            </Card>
          </Layout.Section>

          {selectedResource && (
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="400">
                  <Text as="h3" variant="headingMd">
                    Google SERP Preview
                  </Text>
                  <div
                    style={{
                      backgroundColor: "#f8f9fa",
                      padding: "16px",
                      borderRadius: "8px",
                      border: "1px solid #dfe3e8",
                    }}
                  >
                    <BlockStack gap="100">
                      <InlineStack gap="100" blockAlign="center">
                        <Text as="span" tone="subdued" variant="bodySm">
                          https://yourstore.com › {resourceNameString} › {selectedResource.handle}
                        </Text>
                      </InlineStack>
                      <Text
                        as="h4"
                        variant="headingMd"
                        style={{ color: "#1a0dab", textDecoration: "none" }}
                      >
                        {title || selectedResource.title}
                      </Text>
                      <Text as="p" tone="subdued" style={{ wordBreak: 'break-word' }}>
                        {description || "Please enter a description to see preview."}
                      </Text>
                    </BlockStack>
                  </div>
                  <Banner tone="info">
                    Search engines may choose to display a different description depending on the user's search query.
                  </Banner>
                </BlockStack>
              </Card>
            </Layout.Section>
          )}
        </Layout>
      </BlockStack>
    </Page>
  );
}