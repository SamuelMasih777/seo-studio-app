import { randomUUID } from "node:crypto";
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
import { resolveMediaImageForProduct } from "../shopify-product-media.server";
import {
  compressProductImage,
  type CompressFormatOption,
  type CompressQualityOption,
} from "../compress-image.server";
import { replaceProductMediaWithStagedUpload } from "../shopify-upload-compressed-media.server";

/** One unit only: use MB from 1 MiB upward, KB between 1 KiB and 1 MiB, bytes below. */
function formatFileSizeAdaptive(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  const mib = 1024 * 1024;
  const kib = 1024;
  if (bytes >= mib) {
    const mb = bytes / mib;
    return `${mb >= 10 ? mb.toFixed(1) : mb.toFixed(2)} MB`;
  }
  if (bytes >= kib) {
    const kb = bytes / kib;
    return `${kb >= 100 ? kb.toFixed(0) : kb.toFixed(1)} KB`;
  }
  return `${Math.round(bytes)} B`;
}

/** Rough output/input ratio for the selected options (not a guarantee). */
function estimatedCompressionRatio(format: string, quality: string): number {
  const webp = format === "webp";
  const lossless = quality === "lossless";
  if (webp && !lossless) return 0.4;
  if (webp && lossless) return 0.82;
  if (!webp && !lossless) return 0.78;
  return 0.9;
}

async function fetchImageContentLength(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: {
        Accept: "image/*",
        "User-Agent":
          "Mozilla/5.0 (compatible; ShopifySEOApp/1.0; +https://shopify.dev)",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const raw = res.headers.get("content-length");
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    out.push(...(await Promise.all(chunk.map(fn))));
  }
  return out;
}

async function downloadImageFromCdn(
  url: string,
): Promise<Buffer | { error: string }> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        Accept: "image/*",
        "User-Agent":
          "Mozilla/5.0 (compatible; ShopifySEOApp/1.0; +https://shopify.dev)",
      },
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      return { error: `Download failed (HTTP ${res.status}).` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > 20 * 1024 * 1024) {
      return { error: "Image exceeds 20 MB download limit." };
    }
    return buf;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

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
    query getProductImagesCompression {
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
    }`,
  );

  const json = await response.json();

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

  const currentBytesList = await mapWithConcurrency(
    images,
    6,
    async (img) => fetchImageContentLength(img.url as string),
  );
  images.forEach((img, i) => {
    img.currentBytes = currentBytesList[i];
  });

  return {
    images,
    pageInfo: json.data.products.pageInfo,
  };
};

type ImageCompressionActionJson =
  | { success: false; error: string }
  | {
      success: true;
      count: number;
      totalInputBytes: number;
      totalOutputBytes: number;
      warnings?: string[];
    };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent !== "bulk_compress") {
    return { success: false, error: "Unknown action." };
  }

  const format = formData.get("format") as CompressFormatOption;
  const quality = formData.get("quality") as CompressQualityOption;
  const selectedImages = JSON.parse(formData.get("selectedImages") as string) as {
    imageId: string;
    productId: string;
    productTitle: string;
    imageUrl: string;
    altText?: string | null;
  }[];

  if (!Array.isArray(selectedImages) || selectedImages.length === 0) {
    return { success: false, error: "No images selected." };
  }

  const fmt: CompressFormatOption =
    format === "original" ? "original" : "webp";
  const qual: CompressQualityOption =
    quality === "lossless" ? "lossless" : "lossy";

  let successCount = 0;
  let totalInputBytes = 0;
  let totalOutputBytes = 0;
  const warnings: string[] = [];

  for (const row of selectedImages) {
    const title = row.productTitle || "Product";

    const resolved = await resolveMediaImageForProduct(
      admin,
      row.productId,
      row.imageId,
      row.imageUrl,
    );
    if ("error" in resolved) {
      warnings.push(`${title}: ${resolved.error}`);
      continue;
    }

    const downloaded = await downloadImageFromCdn(row.imageUrl);
    if ("error" in downloaded) {
      warnings.push(`${title}: ${downloaded.error}`);
      continue;
    }

    const compressed = await compressProductImage(downloaded, fmt, qual);
    if ("error" in compressed) {
      warnings.push(`${title}: ${compressed.error}`);
      continue;
    }

    if (compressed.outputBytes >= compressed.inputBytes) {
      warnings.push(
        `${title}: Already optimized (output ${compressed.outputBytes} B ≥ input ${compressed.inputBytes} B); skipped.`,
      );
      continue;
    }

    const filename = `seo-compressed-${randomUUID()}.${compressed.extension}`;

    const replaced = await replaceProductMediaWithStagedUpload(admin, {
      productId: row.productId,
      oldMediaId: resolved.mediaId,
      buffer: compressed.buffer,
      mimeType: compressed.mimeType,
      filename,
      alt: row.altText,
    });

    if (replaced.kind === "failed") {
      warnings.push(`${title}: ${replaced.error}`);
      continue;
    }

    successCount += 1;
    totalInputBytes += compressed.inputBytes;
    totalOutputBytes += compressed.outputBytes;

    if (replaced.kind === "partial") {
      warnings.push(replaced.warning);
    }

    await new Promise((r) => setTimeout(r, 400));
  }

  return {
    success: true,
    count: successCount,
    totalInputBytes,
    totalOutputBytes,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
};

export default function ImageCompressionPage() {
  const { images, pageInfo } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ImageCompressionActionJson>();
  const navigate = useNavigate();

  const [format, setFormat] = useState("webp");
  const [quality, setQuality] = useState("lossy");

  const {
    selectedResources,
    allResourcesSelected,
    handleSelectionChange,
    clearSelection,
  } = useIndexResourceState(images);

  const [showBanner, setShowBanner] = useState<{
    show: boolean;
    count: number;
    savedBytes: number;
    warnings?: string[];
  }>({ show: false, count: 0, savedBytes: 0 });

  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  useEffect(() => {
    const data = fetcher.data;
    if (!data) return;

    if (!data.success) {
      setErrorBanner(data.error);
      return;
    }

    setErrorBanner(null);
    const savedBytes = Math.max(0, data.totalInputBytes - data.totalOutputBytes);
    setShowBanner({
      show: true,
      count: data.count,
      savedBytes,
      warnings: data.warnings,
    });
    clearSelection();
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
        productTitle: img.productTitle,
        imageUrl: img.url,
        altText: img.altText ?? "",
      }));

    fetcher.submit(
      {
        intent: "bulk_compress",
        format,
        quality,
        selectedImages: JSON.stringify(selectedImagesData),
      },
      { method: "POST" },
    );
  };

  const isCompressing =
    fetcher.state === "submitting" &&
    fetcher.formData?.get("intent") === "bulk_compress";

  const rowMarkup = images.map((img: any, index: number) => (
    <IndexTable.Row
      id={img.id}
      key={img.id}
      position={index}
      selected={selectedResources.includes(img.id)}
    >
      <IndexTable.Cell>
        <Thumbnail source={img.url} alt={img.altText || "Product"} size="small" />
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
        {img.currentBytes != null ? (
          <Text as="span" variant="bodyMd">
            {formatFileSizeAdaptive(img.currentBytes)}
          </Text>
        ) : (
          <BlockStack gap="100">
            <Text as="span" tone="subdued">
              -
            </Text>
            <Text as="span" variant="bodySm" tone="subdued">
              Size unavailable (CDN)
            </Text>
          </BlockStack>
        )}
      </IndexTable.Cell>
      <IndexTable.Cell>
        {img.currentBytes != null ? (
          <BlockStack gap="100">
            <Text as="span" variant="bodyMd" tone="subdued">
              ~
              {formatFileSizeAdaptive(
                Math.max(
                  1,
                  Math.round(
                    img.currentBytes *
                      estimatedCompressionRatio(format, quality),
                  ),
                ),
              )}
            </Text>
          </BlockStack>
        ) : (
          <BlockStack gap="100">
            <Text as="span" tone="subdued">
              -
            </Text>
            <Text as="span" variant="bodySm" tone="subdued">
              Needs current file size
            </Text>
          </BlockStack>
        )}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone="warning">Ready</Badge>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  const promotedBulkActions = [
    {
      content: "Compress selected images",
      onAction: handleBulkCompress,
    },
  ];

  const savedMb =
    showBanner.savedBytes > 0
      ? (showBanner.savedBytes / (1024 * 1024)).toFixed(2)
      : "0";

  return (
    <Page>
      <TitleBar title="Image Compression" />
      <BlockStack gap="500">
        <Layout>
          {errorBanner && (
            <Layout.Section>
              <Banner
                tone="critical"
                title="Compression failed"
                onDismiss={() => setErrorBanner(null)}
              >
                <Text as="p">{errorBanner}</Text>
              </Banner>
            </Layout.Section>
          )}

          {showBanner.show && (
            <Layout.Section>
              <Banner
                tone={
                  showBanner.warnings && showBanner.warnings.length > 0
                    ? "warning"
                    : "success"
                }
                title={`Compressed ${showBanner.count} image(s). Approx. ${savedMb} MB smaller file payload (byte-accurate for processed files).`}
                onDismiss={() =>
                  setShowBanner({ show: false, count: 0, savedBytes: 0 })
                }
              >
                {showBanner.warnings && showBanner.warnings.length > 0 ? (
                  <BlockStack gap="200">
                    <Text as="p">
                      Notes ({showBanner.warnings.length}):
                    </Text>
                    <Text as="p" tone="subdued">
                      {showBanner.warnings.slice(0, 6).join(" · ")}
                      {showBanner.warnings.length > 6 ? " …" : ""}
                    </Text>
                  </BlockStack>
                ) : null}
              </Banner>
            </Layout.Section>
          )}

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingLg">
                      Compress and replace product images
                    </Text>
                    <Text as="p" tone="subdued">
                      Downloads each image, re-encodes (WebP or original format), uploads via
                      Shopify staged upload, attaches new media, then removes the previous media
                      file. GIF and SVG are skipped. Est. compressed is a rough projection from the
                      measured file size and your Format / Quality choices, not a guarantee.
                      Requires the write_products scope.
                    </Text>
                  </BlockStack>
                  <BlockStack gap="200" inlineAlign="end">
                    <InlineStack gap="300">
                      <Select
                        label="Format"
                        labelHidden
                        options={[
                          { label: "WebP (recommended)", value: "webp" },
                          { label: "Keep JPEG/PNG family", value: "original" },
                        ]}
                        value={format}
                        onChange={setFormat}
                      />
                      <Select
                        label="Quality"
                        labelHidden
                        options={[
                          { label: "Lossy (smaller files)", value: "lossy" },
                          { label: "Lossless / high quality", value: "lossless" },
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
                      {`Compress selected (${selectedResources.length})`}
                    </Button>
                  </BlockStack>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card padding="0">
              <IndexTable
                resourceName={{ singular: "image", plural: "images" }}
                itemCount={images.length}
                selectedItemsCount={
                  allResourcesSelected ? "All" : selectedResources.length
                }
                onSelectionChange={handleSelectionChange}
                promotedBulkActions={promotedBulkActions}
                headings={[
                  { title: "Preview" },
                  { title: "Product / size" },
                  { title: "Current file size" },
                  { title: "Est. compressed" },
                  { title: "Status" },
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
