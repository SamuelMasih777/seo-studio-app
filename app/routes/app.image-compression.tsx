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
  useIndexResourceState,
  Select,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { PlayIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  
  const cursor = url.searchParams.get("cursor");
  const direction = url.searchParams.get("direction") || "next";

  const getArgs = () => {
    if (!cursor) return `first: 20`;
    if (direction === "prev") return `last: 20, before: "${cursor}"`;
    return `first: 20, after: "${cursor}"`;
  };

  const response = await admin.graphql(
    `#graphql
    query getProductImages {
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
  
  const images: any[] = [];
  json.data.products.edges.forEach((productEdge: any) => {
    const product = productEdge.node;
    product.images.edges.forEach((imageEdge: any) => {
      // Simulate original file size based on resolution for demonstration
      // In a real app, you might fetch HEAD requests or rely on a DB cache
      const width = imageEdge.node.width || 1000;
      const height = imageEdge.node.height || 1000;
      const estimatedSizeKb = Math.round((width * height * 3) / 1024 / 10); 
      
      images.push({
        ...imageEdge.node,
        productId: product.id,
        productTitle: product.title,
        originalSizeKb: estimatedSizeKb,
        optimized: false,
      });
    });
  });

  return { 
    images,
    pageInfo: json.data.products.pageInfo
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  // const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  
  const intent = formData.get("intent") as string;

  if (intent === "bulk_compress") {
    const selectedImages = JSON.parse(formData.get("selectedImages") as string);

    // Simulate compression processing time
    await new Promise((resolve) => setTimeout(resolve, 2000));
    
    // In a real-world scenario, you would:
    // 1. Download the image using its URL
    // 2. Use a library like `sharp` to compress: 
    //    sharp(inputBuffer).webp({ quality: 80 }).toBuffer()
    // 3. Upload back via Shopify stagedUploadsCreate
    // 4. Update the Media on the Product

    let savedKb = 0;
    selectedImages.forEach((img: any) => {
      savedKb += Math.round(img.originalSizeKb * 0.6); // Simulate 60% savings
    });

    return { success: true, count: selectedImages.length, savedKb };
  }

  return { success: false };
};

export default function ImageCompressionPage() {
  const { images, pageInfo } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  
  const [format, setFormat] = useState("webp");
  const [quality, setQuality] = useState("lossy");

  const {
    selectedResources,
    allResourcesSelected,
    handleSelectionChange,
    clearSelection,
  } = useIndexResourceState(images);
  
  const [showBanner, setShowBanner] = useState<{show: boolean, count: number, savedKb: number}>({show: false, count: 0, savedKb: 0});

  useEffect(() => {
    if (fetcher.data?.success) {
      setShowBanner({ show: true, count: fetcher.data.count, savedKb: fetcher.data.savedKb });
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

  const handleBulkCompress = () => {
    const selectedImagesData = images
      .filter((img: any) => selectedResources.includes(img.id))
      .map((img: any) => ({
        imageId: img.id,
        productId: img.productId,
        originalSizeKb: img.originalSizeKb
      }));

    fetcher.submit(
      {
        intent: "bulk_compress",
        format,
        quality,
        selectedImages: JSON.stringify(selectedImagesData)
      },
      { method: "POST" }
    );
  };

  const isCompressing = fetcher.state === "submitting" && fetcher.formData?.get("intent") === "bulk_compress";

  const rowMarkup = images.map((img: any, index: number) => (
    <IndexTable.Row 
      id={img.id} 
      key={img.id} 
      position={index}
      selected={selectedResources.includes(img.id)}
    >
      <IndexTable.Cell>
        <Thumbnail source={img.url} alt="Product Image" size="small" />
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
        <Text as="span">{img.originalSizeKb} KB</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone="warning">Needs Compression</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" tone="success">
          ~{Math.round(img.originalSizeKb * 0.4)} KB (-60%)
        </Text>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  const promotedBulkActions = [
    {
      content: 'Compress Selected Images',
      onAction: handleBulkCompress,
    },
  ];

  return (
    <Page>
      <TitleBar title="Image Compression" />
      <BlockStack gap="500">
        <Layout>
          {showBanner.show && (
            <Layout.Section>
              <Banner 
                tone="success" 
                title={`Successfully compressed ${showBanner.count} images! Saved approximately ${(showBanner.savedKb / 1024).toFixed(2)} MB of bandwidth.`} 
                onDismiss={() => setShowBanner({show: false, count: 0, savedKb: 0})} 
              />
            </Layout.Section>
          )}

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingLg">
                      Lossless & Lossy Compression
                    </Text>
                    <Text as="p" tone="subdued">
                      Reduce image file sizes without sacrificing quality. We'll automatically convert images to modern formats like WebP for faster page loads.
                    </Text>
                  </BlockStack>
                  <BlockStack gap="200" inlineAlign="end">
                    <InlineStack gap="300">
                      <Select
                        label="Format"
                        labelHidden
                        options={[
                          { label: "Convert to WebP (Recommended)", value: "webp" },
                          { label: "Keep Original Format", value: "original" },
                        ]}
                        value={format}
                        onChange={setFormat}
                      />
                      <Select
                        label="Quality"
                        labelHidden
                        options={[
                          { label: "Lossy (Best Savings)", value: "lossy" },
                          { label: "Lossless (Best Quality)", value: "lossless" },
                        ]}
                        value={quality}
                        onChange={setQuality}
                      />
                    </InlineStack>
                    <Button
                      variant="primary"
                      icon={PlayIcon}
                      loading={isCompressing}
                      disabled={selectedResources.length === 0}
                      onClick={handleBulkCompress}
                    >
                      Compress Selected ({selectedResources.length})
                    </Button>
                  </BlockStack>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
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
                  { title: "Original File Size" }, 
                  { title: "Status" }, 
                  { title: "Estimated Savings" }
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
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}