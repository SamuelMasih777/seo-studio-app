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
  Badge,
  Banner,
  Thumbnail,
  IndexTable,
  Modal,
  TextField,
  Select,
  useIndexResourceState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { ImageIcon, MagicIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  
  const cursor = url.searchParams.get("cursor");
  const direction = url.searchParams.get("direction") || "next";

  const getArgs = () => {
    if (!cursor) return `first: 50`;
    if (direction === "prev") return `last: 50, before: "${cursor}"`;
    return `first: 50, after: "${cursor}"`;
  };

  const response = await admin.graphql(
    `#graphql
    query getProductImages {
      shop { name }
      products(${getArgs()}) {
        pageInfo { hasNextPage, hasPreviousPage, startCursor, endCursor }
        edges {
          node {
            id
            title
            images(first: 5) {
              edges {
                node {
                  id
                  url
                  altText
                  width
                  height
                }
              }
            }
          }
        }
      }
    }`
  );

  const json = await response.json();
  const shopName = json.data.shop.name;
  
  const images: any[] = [];
  json.data.products.edges.forEach((productEdge: any) => {
    const product = productEdge.node;
    product.images.edges.forEach((imageEdge: any) => {
      images.push({
        ...imageEdge.node,
        productId: product.id,
        productTitle: product.title,
      });
    });
  });

  return { 
    images,
    shopName,
    pageInfo: json.data.products.pageInfo
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  
    const intent = formData.get("intent") as string;

  if (intent === "bulk_optimize") {
    const selectedImages = JSON.parse(formData.get("selectedImages") as string);
    const pattern = formData.get("pattern") as string;
    const shopName = formData.get("shopName") as string;
    let successCount = 0;

    for (const image of selectedImages) {
      let generatedAltText = "";

      if (pattern === "product_name") {
        generatedAltText = image.productTitle;
      } else if (pattern === "product_name_store_name") {
        generatedAltText = `${image.productTitle} - ${shopName}`;
      } else {
        // 1. Simulate AI generation for alt text
        await new Promise((resolve) => setTimeout(resolve, 800)); // Simulate AI delay
        generatedAltText = `High quality product view showing details and features`;
      }

      // The ID returned by `product.images` is an Image ID (gid://shopify/Image/...).
      // However, `productUpdateMedia` expects a Media ID (gid://shopify/MediaImage/...).
      // We must fetch the correct MediaImage ID for the product first.
      const mediaRes = await admin.graphql(
        `#graphql
        query getProductMedia($id: ID!) {
          product(id: $id) {
            media(first: 50) {
              edges {
                node {
                  ... on MediaImage {
                    id
                    image {
                      id
                    }
                  }
                }
              }
            }
          }
        }`,
        { variables: { id: image.productId } }
      );
      const mediaJson = await mediaRes.json();
      
      const mediaEdges = mediaJson.data?.product?.media?.edges || [];
      const matchingMedia = mediaEdges.find((edge: any) => edge.node.image?.id === image.imageId);

      if (!matchingMedia) continue;

      const mediaId = matchingMedia.node.id;

      // 2. Update media via GraphQL
      await admin.graphql(
        `#graphql
        mutation productUpdateMedia($media: [UpdateMediaInput!]!, $productId: ID!) {
          productUpdateMedia(media: $media, productId: $productId) {
            media {
              alt
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            productId: image.productId,
            media: [
              {
                id: mediaId,
                alt: generatedAltText,
              }
            ],
          },
        }
      );
      
      successCount++;
    }

    return { success: true, type: "bulk", count: successCount };
  }

  // Single Save
  const productId = formData.get("productId") as string;
  const imageId = formData.get("imageId") as string;
  const altText = formData.get("altText") as string;

  // Resolve Image ID to Media ID
  const mediaRes = await admin.graphql(
    `#graphql
    query getProductMedia($id: ID!) {
      product(id: $id) {
        media(first: 50) {
          edges {
            node {
              ... on MediaImage {
                id
                image {
                  id
                }
              }
            }
          }
        }
      }
    }`,
    { variables: { id: productId } }
  );
  const mediaJson = await mediaRes.json();
  const mediaEdges = mediaJson.data?.product?.media?.edges || [];
  const matchingMedia = mediaEdges.find((edge: any) => edge.node.image?.id === imageId);

  if (!matchingMedia) {
    return { success: false, error: "Media not found for image." };
  }

  const mediaId = matchingMedia.node.id;

  const response = await admin.graphql(
    `#graphql
    mutation productUpdateMedia($media: [UpdateMediaInput!]!, $productId: ID!) {
      productUpdateMedia(media: $media, productId: $productId) {
        media {
          alt
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        productId,
        media: [
          {
            id: mediaId,
            alt: altText,
          }
        ],
      },
    }
  );

  const json = await response.json();
  return { success: true, type: "single", data: json.data?.productUpdateMedia };
};

export default function ImageOptimizationPage() {
  const { images, shopName, pageInfo } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  
  const [activeModal, setActiveModal] = useState(false);
  const [selectedImage, setSelectedImage] = useState<any>(null);
  const [editAltText, setEditAltText] = useState("");
  
  const [altTextPattern, setAltTextPattern] = useState("product_name_store_name");

  const {
    selectedResources,
    allResourcesSelected,
    handleSelectionChange,
    clearSelection,
  } = useIndexResourceState(images);
  const [showBanner, setShowBanner] = useState<{show: boolean, type: string, count: number}>({show: false, type: "", count: 0});

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

  const openAltModal = (image: any) => {
    setSelectedImage(image);
    setEditAltText(image.altText || "");
    setActiveModal(true);
  };

  const closeAltModal = () => {
    setActiveModal(false);
    setSelectedImage(null);
  };

  const handleSaveAltText = () => {
    fetcher.submit(
      {
        intent: "single",
        productId: selectedImage.productId,
        imageId: selectedImage.id,
        altText: editAltText,
      },
      { method: "POST" }
    );
    closeAltModal();
  };

  const handleBulkOptimize = () => {
    // We need to pass both the imageId and its corresponding productId to the backend
    const selectedImagesData = images
      .filter((img: any) => selectedResources.includes(img.id))
      .map((img: any) => ({
        imageId: img.id,
        productId: img.productId,
        productTitle: img.productTitle
      }));

    fetcher.submit(
      {
        intent: "bulk_optimize",
        pattern: altTextPattern,
        shopName: shopName,
        selectedImages: JSON.stringify(selectedImagesData)
      },
      { method: "POST" }
    );
  };

  const isSaving = fetcher.state === "submitting" && fetcher.formData?.get("intent") === "single";
  const isBulkOptimizing = fetcher.state === "submitting" && fetcher.formData?.get("intent") === "bulk_optimize";

  const rowMarkup = images.map((img: any, index: number) => (
    <IndexTable.Row 
      id={img.id} 
      key={img.id} 
      position={index}
      selected={selectedResources.includes(img.id)}
    >
      <IndexTable.Cell>
        <Thumbnail source={img.url || ImageIcon} alt={img.altText || "Product Image"} size="small" />
      </IndexTable.Cell>
      <IndexTable.Cell>
        <BlockStack gap="100">
          <Text as="span" variant="bodyMd" fontWeight="bold">
            {img.productTitle}
          </Text>
          <Text as="span" tone="subdued" variant="bodySm">
            {img.width}x{img.height}
          </Text>
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <BlockStack gap="100">
          <Text as="span" tone={img.altText ? "success" : "critical"}>
            {img.altText || "Missing Alt Text"}
          </Text>
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone="warning">Needs Optimization</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="200">
          <Button size="micro" onClick={() => openAltModal(img)}>
            Edit Alt Text
          </Button>
        </InlineStack>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  const promotedBulkActions = [
    {
      content: 'Auto-Generate Alt Text',
      onAction: handleBulkOptimize,
    },
  ];

  return (
    <Page>
      <TitleBar title="Image Optimization" />
      <BlockStack gap="500">
        <Layout>
          {showBanner.show && (
            <Layout.Section>
              <Banner 
                tone="success" 
                title={showBanner.type === "bulk" ? `Successfully generated alt text for ${showBanner.count} images!` : "Image Alt Text updated successfully!"} 
                onDismiss={() => setShowBanner({show: false, type: "", count: 0})} 
              />
            </Layout.Section>
          )}

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingLg">
                      Image Alt Text Optimization
                    </Text>
                    <Text as="p" tone="subdued">
                      Automatically generate missing alt texts for better accessibility and SEO.
                    </Text>
                  </BlockStack>
                  <BlockStack gap="200" inlineAlign="end">
                    <Select
                      label="Alt Text Pattern"
                      options={[
                        { label: "Product Name - Store Name", value: "product_name_store_name" },
                        { label: "Product Name", value: "product_name" },
                        { label: "Generate With AI", value: "ai" }
                      ]}
                      value={altTextPattern}
                      onChange={setAltTextPattern}
                    />
                    <Button
                      variant="primary"
                      icon={MagicIcon}
                      loading={isBulkOptimizing}
                      disabled={selectedResources.length === 0}
                      onClick={handleBulkOptimize}
                    >
                      Bulk Optimize Selected ({selectedResources.length})
                    </Button>
                  </BlockStack>
                </InlineStack>

                <InlineStack gap="400">
                  <Card background="bg-surface-secondary">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm" tone="subdued">
                        Total Bandwidth Saved
                      </Text>
                      <Text as="p" variant="headingXl" tone="success">
                        0 MB
                      </Text>
                    </BlockStack>
                  </Card>
                  <Card background="bg-surface-secondary">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm" tone="subdued">
                        Images Missing Alt Text
                      </Text>
                      <Text as="p" variant="headingXl" tone="critical">
                        {images.filter(i => !i.altText).length} / {images.length}
                      </Text>
                    </BlockStack>
                  </Card>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">
                Store Images
              </Text>
              <Card padding="0">
                <IndexTable
                  resourceName={{ singular: 'image', plural: 'images' }}
                  itemCount={images.length}
                  selectedItemsCount={
                    allResourcesSelected ? 'All' : selectedResources.length
                  }
                  onSelectionChange={handleSelectionChange}
                  promotedBulkActions={promotedBulkActions}
                  headings={[
                    { title: "Preview" }, 
                    { title: "Product / Size" }, 
                    { title: "Alt Text" }, 
                    { title: "Status" }, 
                    { title: "Actions" }
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
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>

      <Modal
        open={activeModal}
        onClose={closeAltModal}
        title={`Edit Alt Text for ${selectedImage?.productTitle}`}
        primaryAction={{
          content: 'Save Alt Text',
          onAction: handleSaveAltText,
          loading: isSaving,
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: closeAltModal,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <InlineStack align="center">
              {selectedImage && (
                <img 
                  src={selectedImage.url} 
                  alt="Preview" 
                  style={{ maxHeight: '200px', objectFit: 'contain', borderRadius: '8px' }} 
                />
              )}
            </InlineStack>
            <TextField
              label="Image Alt Text"
              value={editAltText}
              onChange={setEditAltText}
              multiline={3}
              autoComplete="off"
              helpText="Describe the image for screen readers and search engines."
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}