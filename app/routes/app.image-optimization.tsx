import { useState, useEffect, useMemo, useRef } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Button,
  ButtonGroup,
  InlineStack,
  Badge,
  Banner,
  Thumbnail,
  IndexTable,
  Modal,
  TextField,
  Select,
  useIndexResourceState,
  Scrollable,
  Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { ImageIcon, MagicIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import {
  resolveMediaImageForProduct,
  type ShopifyAdminClient,
} from "../shopify-product-media.server";
import {
  generateProductImageAltPlain,
  isGeminiConfigured,
} from "../gemini-content.server";

/** Minimum length for alt text to count as descriptive (not just a token). */
const ALT_MIN_QUALITY_LENGTH = 12;

type AltQualityStatus = "missing" | "needs_improvement" | "optimized";

function classifyAltQuality(
  altText: string | null | undefined,
  productTitle: string,
): AltQualityStatus {
  const alt = (altText || "").trim();
  if (!alt) return "missing";
  const title = (productTitle || "").trim();
  if (alt.length < ALT_MIN_QUALITY_LENGTH) return "needs_improvement";
  if (title && alt.toLowerCase() === title.toLowerCase()) {
    return "needs_improvement";
  }
  return "optimized";
}

function altStatusBadge(status: AltQualityStatus): { tone: "success" | "warning" | "critical"; label: string } {
  switch (status) {
    case "optimized":
      return { tone: "success", label: "Optimized" };
    case "needs_improvement":
      return { tone: "warning", label: "Needs optimization" };
    default:
      return { tone: "critical", label: "Missing alt" };
  }
}

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
    pageInfo: json.data.products.pageInfo,
    generationConfigured: isGeminiConfigured(),
  };
};

type MediaMutationJson = {
  errors?: { message?: string }[];
  data?: {
    productUpdateMedia?: {
      userErrors?: { message?: string }[];
      media?: { alt?: string }[];
    };
  };
};

type BulkImageInput = {
  id: string;
  productId: string;
  imageId: string;
  imageUrl: string;
  productTitle: string;
  currentAlt?: string;
};

function altFromPattern(
  img: BulkImageInput,
  altSource: string,
  shopName: string,
): string {
  if (altSource === "pattern_product_store") {
    const t = (img.productTitle || "").trim();
    return t ? `${t} - ${shopName}` : `Product image - ${shopName}`;
  }
  return (img.productTitle || "").trim() || "Product image";
}

async function updateProductImageAlt(
  admin: ShopifyAdminClient,
  productId: string,
  imageId: string,
  imageUrl: string | undefined,
  alt: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const resolved = await resolveMediaImageForProduct(
    admin,
    productId,
    imageId,
    imageUrl,
  );
  if ("error" in resolved) {
    return { ok: false, error: resolved.error };
  }

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
            id: resolved.mediaId,
            alt,
          },
        ],
      },
    },
  );

  const json = (await response.json()) as MediaMutationJson;
  if (json.errors?.length) {
    return {
      ok: false,
      error: json.errors.map((e) => e.message ?? "").join("; "),
    };
  }
  const userErrors = json.data?.productUpdateMedia?.userErrors ?? [];
  if (userErrors.length > 0) {
    return {
      ok: false,
      error: userErrors.map((e) => e.message).filter(Boolean).join("; "),
    };
  }
  return { ok: true };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "bulk_preview") {
    await authenticate.admin(request);
    let selected: BulkImageInput[];
    try {
      selected = JSON.parse(formData.get("imagesPayload") as string) as BulkImageInput[];
    } catch {
      return { success: false, error: "Invalid image selection." };
    }
    const altSource = (formData.get("altSource") as string) || "pattern_product_store";
    const shopName = (formData.get("shopName") as string) || "";

    if (altSource === "ai" && !isGeminiConfigured()) {
      return {
        success: false,
        error:
          "AI alt suggestions are not configured. Ask the app developer to set the API key, or choose a text pattern.",
      };
    }

    const results: {
      id: string;
      productId: string;
      imageId: string;
      imageUrl: string;
      productTitle: string;
      alt?: string;
      error?: string;
    }[] = [];

    for (const img of selected) {
      if (altSource === "ai") {
        const gen = await generateProductImageAltPlain({
          productTitle: img.productTitle || "Product",
          existingAlt: img.currentAlt?.trim() || undefined,
        });
        if (!gen.ok) {
          results.push({
            id: img.id,
            productId: img.productId,
            imageId: img.imageId,
            imageUrl: img.imageUrl,
            productTitle: img.productTitle,
            error: gen.error,
          });
        } else {
          results.push({
            id: img.id,
            productId: img.productId,
            imageId: img.imageId,
            imageUrl: img.imageUrl,
            productTitle: img.productTitle,
            alt: gen.text,
          });
        }
        await new Promise((r) => setTimeout(r, 300));
      } else {
        results.push({
          id: img.id,
          productId: img.productId,
          imageId: img.imageId,
          imageUrl: img.imageUrl,
          productTitle: img.productTitle,
          alt: altFromPattern(img, altSource, shopName),
        });
      }
    }

    return { success: true, type: "bulk_preview" as const, results };
  }

  if (intent === "bulk_save") {
    const { admin } = await authenticate.admin(request);
    let items: {
      productId: string;
      imageId: string;
      imageUrl: string;
      altText: string;
      id: string;
    }[];
    try {
      items = JSON.parse(formData.get("items") as string) as {
        productId: string;
        imageId: string;
        imageUrl: string;
        altText: string;
        id: string;
      }[];
    } catch {
      return { success: false, error: "Invalid save payload." };
    }

    const savedIds: string[] = [];
    const bulkWarnings: string[] = [];

    for (const item of items) {
      const trimmed = item.altText?.trim();
      if (!trimmed) continue;

      const out = await updateProductImageAlt(
        admin,
        item.productId,
        item.imageId,
        item.imageUrl || undefined,
        trimmed,
      );
      if (!out.ok) {
        bulkWarnings.push(`${item.id}: ${out.error}`);
      } else {
        savedIds.push(item.id);
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    return {
      success: true,
      type: "bulk_save" as const,
      count: savedIds.length,
      savedIds,
      ...(bulkWarnings.length > 0 ? { bulkWarnings } : {}),
    };
  }

  if (intent === "suggest_alt") {
    await authenticate.admin(request);
    if (!isGeminiConfigured()) {
      return {
        success: false,
        error:
          "AI alt suggestions are not configured. Ask the app developer to set the API key.",
      };
    }
    const productTitle = (formData.get("productTitle") as string) || "";
    const existingAlt = (formData.get("existingAlt") as string) || "";
    const gen = await generateProductImageAltPlain({
      productTitle: productTitle.trim() || "Product",
      existingAlt: existingAlt.trim() || undefined,
    });
    if (!gen.ok) {
      return { success: false, error: gen.error };
    }
    return {
      success: true,
      type: "suggest_alt" as const,
      altText: gen.text,
    };
  }

  if (intent === "single") {
    const { admin } = await authenticate.admin(request);
    const productId = formData.get("productId") as string;
    const imageId = formData.get("imageId") as string;
    const altText = formData.get("altText") as string;
    const imageUrl = (formData.get("imageUrl") as string) || "";

    const out = await updateProductImageAlt(
      admin,
      productId,
      imageId,
      imageUrl || undefined,
      altText,
    );
    if (!out.ok) {
      return { success: false, error: out.error };
    }
    return { success: true, type: "single" as const, imageId };
  }

  return { success: false, error: "Invalid action." };
};

/** Serialized action JSON - explicit union so useFetcher narrows (avoids JsonifyObject union issues). */
type ImageOptimizationActionJson =
  | { success: false; error: string }
  | {
      success: true;
      type: "bulk_preview";
      results: {
        id: string;
        productId: string;
        imageId: string;
        imageUrl: string;
        productTitle: string;
        alt?: string;
        error?: string;
      }[];
    }
  | {
      success: true;
      type: "bulk_save";
      count: number;
      savedIds: string[];
      bulkWarnings?: string[];
    }
  | { success: true; type: "single"; imageId?: string }
  | { success: true; type: "suggest_alt"; altText: string };

type AltSourceOption = "pattern_product" | "pattern_product_store" | "ai";

type AltReviewRow = {
  id: string;
  productId: string;
  imageId: string;
  imageUrl: string;
  productTitle: string;
  altDraft: string;
  saved: boolean;
  error?: string;
};

/** Matches successful image optimization action payloads after `success === true`. */
type AltActionSuccess = Extract<ImageOptimizationActionJson, { success: true }>;

export default function ImageOptimizationPage() {
  const { images, shopName, pageInfo, generationConfigured } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<ImageOptimizationActionJson>();
  const navigate = useNavigate();

  const [activeModal, setActiveModal] = useState(false);
  const [selectedImage, setSelectedImage] = useState<any>(null);
  const [editAltText, setEditAltText] = useState("");

  const [altSource, setAltSource] =
    useState<AltSourceOption>("pattern_product_store");

  const [altReviewOpen, setAltReviewOpen] = useState(false);
  const [altReviewRows, setAltReviewRows] = useState<AltReviewRow[]>([]);
  const [discardWarningOpen, setDiscardWarningOpen] = useState(false);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);

  const [listFilter, setListFilter] = useState<
    "all" | "missing_only" | "needs_optimization"
  >("all");
  const [pendingModalAiSuggest, setPendingModalAiSuggest] = useState(false);
  const modalSuggestAltRef = useRef<{
    productTitle: string;
    existingAlt: string;
  } | null>(null);

  const displayImages = useMemo(() => {
    if (listFilter === "missing_only") {
      return images.filter((img: { altText?: string | null }) => !(img.altText || "").trim());
    }
    if (listFilter === "needs_optimization") {
      return images.filter((img: { altText?: string | null; productTitle: string }) =>
        classifyAltQuality(img.altText, img.productTitle) !== "optimized",
      );
    }
    return images;
  }, [images, listFilter]);

  const {
    selectedResources,
    allResourcesSelected,
    handleSelectionChange,
    clearSelection,
  } = useIndexResourceState(displayImages);
  const [showBanner, setShowBanner] = useState<{
    show: boolean;
    type: string;
    count: number;
    warnings?: string[];
  }>({ show: false, type: "", count: 0 });

  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  useEffect(() => {
    if (altSource === "ai" && !generationConfigured) {
      setAltSource("pattern_product_store");
    }
  }, [altSource, generationConfigured]);

  useEffect(() => {
    clearSelection();
  }, [listFilter, clearSelection]);

  useEffect(() => {
    if (!pendingModalAiSuggest) return;
    const payload = modalSuggestAltRef.current;
    if (!payload || !generationConfigured) {
      setPendingModalAiSuggest(false);
      return;
    }
    setPendingModalAiSuggest(false);
    modalSuggestAltRef.current = null;
    fetcher.submit(
      {
        intent: "suggest_alt",
        productTitle: payload.productTitle,
        existingAlt: payload.existingAlt,
      },
      { method: "POST" },
    );
  }, [pendingModalAiSuggest, generationConfigured, fetcher]);

  useEffect(() => {
    const data = fetcher.data;
    if (!data) return;

    if (!data.success) {
      setErrorBanner(data.error);
      setSavingRowId(null);
      return;
    }

    setErrorBanner(null);
    const ok = data as AltActionSuccess;

    if (ok.type === "bulk_preview") {
      setAltReviewRows(
        ok.results.map((r) => ({
          id: r.id,
          productId: r.productId,
          imageId: r.imageId,
          imageUrl: r.imageUrl,
          productTitle: r.productTitle,
          altDraft: r.alt ?? "",
          error: r.error,
          saved: false,
        })),
      );
      setAltReviewOpen(true);
      clearSelection();
      return;
    }

    if (ok.type === "bulk_save") {
      setAltReviewRows((prev) =>
        prev.map((row) =>
          ok.savedIds.includes(row.id) ? { ...row, saved: true } : row,
        ),
      );
      setShowBanner({
        show: true,
        type: "bulk_saved",
        count: ok.count,
        warnings: ok.bulkWarnings,
      });
      setSavingRowId(null);
      return;
    }

    if (ok.type === "single") {
      setShowBanner({ show: true, type: "single", count: 1 });
      setActiveModal(false);
      setSelectedImage(null);
      setSavingRowId(null);
      return;
    }

    if (ok.type === "suggest_alt") {
      setEditAltText(ok.altText);
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

  const openAltModal = (image: any, opts?: { suggestAi?: boolean }) => {
    setSelectedImage(image);
    setEditAltText(image.altText || "");
    setActiveModal(true);
    if (opts?.suggestAi && generationConfigured) {
      modalSuggestAltRef.current = {
        productTitle: image.productTitle || "",
        existingAlt: (image.altText as string) || "",
      };
      setPendingModalAiSuggest(true);
    } else {
      modalSuggestAltRef.current = null;
      setPendingModalAiSuggest(false);
    }
  };

  const closeAltModal = () => {
    setActiveModal(false);
    setSelectedImage(null);
    setPendingModalAiSuggest(false);
    modalSuggestAltRef.current = null;
  };

  const handleSaveAltText = () => {
    if (!selectedImage) return;
    fetcher.submit(
      {
        intent: "single",
        productId: selectedImage.productId,
        imageId: selectedImage.id,
        imageUrl: selectedImage.url || "",
        altText: editAltText,
      },
      { method: "POST" },
    );
  };

  const handleSuggestAltForEditModal = () => {
    if (!selectedImage) return;
    fetcher.submit(
      {
        intent: "suggest_alt",
        productTitle: selectedImage.productTitle || "",
        existingAlt: editAltText || selectedImage.altText || "",
      },
      { method: "POST" },
    );
  };

  const buildImagesPayload = () =>
    displayImages
      .filter((img: any) => selectedResources.includes(img.id))
      .map((img: any) => ({
        id: img.id,
        productId: img.productId,
        imageId: img.id,
        imageUrl: img.url || "",
        productTitle: img.productTitle,
        currentAlt: img.altText || "",
      }));

  const handleBulkPreview = () => {
    setErrorBanner(null);
    const payload = buildImagesPayload();
    if (payload.length === 0) return;
    fetcher.submit(
      {
        intent: "bulk_preview",
        imagesPayload: JSON.stringify(payload),
        altSource,
        shopName,
      },
      { method: "POST" },
    );
  };

  const handleBulkGenerateWithAi = () => {
    setErrorBanner(null);
    const payload = buildImagesPayload();
    if (payload.length === 0) return;
    if (!generationConfigured) return;
    fetcher.submit(
      {
        intent: "bulk_preview",
        imagesPayload: JSON.stringify(payload),
        altSource: "ai",
        shopName,
      },
      { method: "POST" },
    );
  };

  const hasUnsavedAltDrafts = altReviewRows.some(
    (r) => !r.saved && r.altDraft.trim().length > 0,
  );

  const attemptCloseAltReview = () => {
    if (hasUnsavedAltDrafts) {
      setDiscardWarningOpen(true);
      return;
    }
    setAltReviewOpen(false);
    setAltReviewRows([]);
  };

  const confirmDiscardAltReview = () => {
    setDiscardWarningOpen(false);
    setAltReviewOpen(false);
    setAltReviewRows([]);
  };

  const handleSaveAllUnsavedInAltModal = () => {
    const items = altReviewRows
      .filter((r) => !r.saved && r.altDraft.trim() && !r.error)
      .map((r) => ({
        id: r.id,
        productId: r.productId,
        imageId: r.imageId,
        imageUrl: r.imageUrl,
        altText: r.altDraft,
      }));
    if (items.length === 0) return;
    fetcher.submit(
      {
        intent: "bulk_save",
        items: JSON.stringify(items),
      },
      { method: "POST" },
    );
  };

  const handleSaveAltReviewRow = (row: AltReviewRow) => {
    if (!row.altDraft.trim() || row.error) return;
    setSavingRowId(row.id);
    fetcher.submit(
      {
        intent: "bulk_save",
        items: JSON.stringify([
          {
            id: row.id,
            productId: row.productId,
            imageId: row.imageId,
            imageUrl: row.imageUrl,
            altText: row.altDraft,
          },
        ]),
      },
      { method: "POST" },
    );
  };

  const updateAltReviewRowDraft = (id: string, altDraft: string) => {
    setAltReviewRows((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, altDraft, saved: false } : r,
      ),
    );
  };

  const isSaving =
    fetcher.state === "submitting" &&
    fetcher.formData?.get("intent") === "single";
  const isBulkPreviewing =
    fetcher.state === "submitting" &&
    fetcher.formData?.get("intent") === "bulk_preview";
  const isBulkSaving =
    fetcher.state === "submitting" &&
    fetcher.formData?.get("intent") === "bulk_save";
  const isSuggestingAlt =
    fetcher.state === "submitting" &&
    fetcher.formData?.get("intent") === "suggest_alt";

  const altSourceOptions = [
    { label: "Product name - store name", value: "pattern_product_store" },
    { label: "Product name only", value: "pattern_product" },
    ...(generationConfigured
      ? [{ label: "AI Optimized", value: "ai" }]
      : []),
  ];

  const missingOnPage = images.filter(
    (i: { altText?: string | null }) => !(i.altText || "").trim(),
  ).length;
  const needsWorkOnPage = images.filter(
    (i: { altText?: string | null; productTitle: string }) =>
      classifyAltQuality(i.altText, i.productTitle) !== "optimized",
  ).length;

  const rowMarkup = displayImages.map((img: any, index: number) => {
    const quality = classifyAltQuality(img.altText, img.productTitle);
    const statusBadge = altStatusBadge(quality);
    const rawAlt = (img.altText || "").trim();
    const altPreview =
      rawAlt.length > 0 ? rawAlt : "-";
    return (
      <IndexTable.Row
        id={img.id}
        key={img.id}
        position={index}
        selected={selectedResources.includes(img.id)}
      >
        <IndexTable.Cell>
          <Thumbnail
            source={img.url || ImageIcon}
            alt={rawAlt || img.productTitle || "Product"}
            size="small"
          />
        </IndexTable.Cell>
        <IndexTable.Cell>
          <div
            style={{
              width: 250,
              maxWidth: 250,
              minWidth: 0,
              overflow: "hidden",
              boxSizing: "border-box",
            }}
          >
            <BlockStack gap="100">
              <Text as="p" variant="bodyMd" fontWeight="bold" breakWord>
                {img.productTitle}
              </Text>
              <Text as="p" tone="subdued" variant="bodySm" breakWord>
                {img.width}x{img.height}
              </Text>
            </BlockStack>
          </div>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <div
            title={rawAlt || undefined}
            style={{
              width: 250,
              maxWidth: 250,
              minWidth: 0,
              overflow: "hidden",
              boxSizing: "border-box",
              maxHeight: "2.75rem",
              lineHeight: "var(--p-font-line-height-400, 1.375)",
            }}
          >
            <Text
              as="p"
              variant="bodySm"
              tone={quality === "missing" ? "critical" : "subdued"}
              breakWord
            >
              {altPreview}
            </Text>
          </div>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <InlineStack gap="200" blockAlign="center" wrap={false}>
            <Button size="micro" onClick={() => openAltModal(img)}>
              Edit
            </Button>
            {generationConfigured ? (
              <Button
                size="micro"
                icon={MagicIcon}
                onClick={() => openAltModal(img, { suggestAi: true })}
              >
                Optimize with AI
              </Button>
            ) : null}
          </InlineStack>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  const promotedBulkActions = [
    ...(generationConfigured
      ? [
          {
            content: "Generate with AI",
            onAction: handleBulkGenerateWithAi,
          },
        ]
      : []),
    {
      content: "Review proposed alt text",
      onAction: handleBulkPreview,
    },
  ];

  return (
    <Page>
      <TitleBar title="Image Alt Text" />
      <BlockStack gap="500">
        <Layout>
          {errorBanner && (
            <Layout.Section>
              <Banner
                tone="critical"
                title="Could not complete action"
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
                title={
                  showBanner.type === "bulk_saved"
                    ? `Saved alt text for ${showBanner.count} image(s) to Shopify.`
                    : "Image alt text updated successfully."
                }
                onDismiss={() =>
                  setShowBanner({
                    show: false,
                    type: "",
                    count: 0,
                  })
                }
              >
                {showBanner.warnings && showBanner.warnings.length > 0 ? (
                  <BlockStack gap="200">
                    <Text as="p">
                      Some images were skipped ({showBanner.warnings.length}):
                    </Text>
                    <Text as="p" tone="subdued">
                      {showBanner.warnings.slice(0, 5).join(" · ")}
                      {showBanner.warnings.length > 5
                        ? " …"
                        : ""}
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
                      Image Alt Text Optimization
                    </Text>
                    <Text as="p" tone="subdued">
                      Choose a pattern or an AI suggestion (from the product title),
                      then review and save per image or all at once.
                    </Text>
                  </BlockStack>
                  <BlockStack gap="200" inlineAlign="end">
                    <InlineStack gap="300" wrap blockAlign="start">
                      {generationConfigured ? (
                        <Button
                          variant="primary"
                          icon={MagicIcon}
                          loading={isBulkPreviewing}
                          disabled={selectedResources.length === 0}
                          onClick={handleBulkGenerateWithAi}
                        >
                          {`Generate with AI (${selectedResources.length})`}
                        </Button>
                      ) : null}
                      <BlockStack gap="100">
                        <Select
                          label="Proposed alt text"
                          options={altSourceOptions}
                          value={altSource}
                          onChange={(v) => setAltSource(v as AltSourceOption)}
                        />
                        {altSource === "ai" ? (
                          <Text as="p" variant="bodySm" tone="subdued">
                            AI uses the product title as context (no image vision). Review every
                            suggestion before saving.
                          </Text>
                        ) : null}
                        <Button
                          variant="secondary"
                          loading={isBulkPreviewing}
                          disabled={
                            selectedResources.length === 0 ||
                            (altSource === "ai" && !generationConfigured)
                          }
                          onClick={handleBulkPreview}
                        >
                          {`Review alt text for selected (${selectedResources.length})`}
                        </Button>
                      </BlockStack>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {`Nothing is saved to Shopify until you confirm in the review window. Status: Optimized means descriptive alt otherwise Needs optimization or Missing alt.`}
                    </Text>
                  </BlockStack>
                </InlineStack>

                <InlineStack gap="400" wrap>
                  <Card background="bg-surface-secondary">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm" tone="subdued">
                        Images
                      </Text>
                      <Text as="p" variant="headingXl">
                        {images.length}
                      </Text>
                    </BlockStack>
                  </Card>
                  <Card background="bg-surface-secondary">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm" tone="subdued">
                        Missing alt
                      </Text>
                      <Text as="p" variant="headingXl" tone="critical">
                        {missingOnPage} / {images.length}
                      </Text>
                    </BlockStack>
                  </Card>
                  <Card background="bg-surface-secondary">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm" tone="subdued">
                        Needs optimization
                      </Text>
                      <Text as="p" variant="headingXl">
                        {needsWorkOnPage} / {images.length}
                      </Text>
                    </BlockStack>
                  </Card>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center" wrap gap="400">
                <Text as="h3" variant="headingMd">
                  Store Images
                </Text>
                <ButtonGroup variant="segmented">
                  <Button
                    pressed={listFilter === "all"}
                    onClick={() => setListFilter("all")}
                  >
                    All images
                  </Button>
                  <Button
                    pressed={listFilter === "missing_only"}
                    onClick={() => setListFilter("missing_only")}
                  >
                    Missing alt only
                  </Button>
                  <Button
                    pressed={listFilter === "needs_optimization"}
                    onClick={() => setListFilter("needs_optimization")}
                  >
                    Needs optimization
                  </Button>
                </ButtonGroup>
              </InlineStack>
              <Card padding="0">
                <IndexTable
                  resourceName={{ singular: 'image', plural: 'images' }}
                  itemCount={displayImages.length}
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
          content: "Save Alt Text",
          onAction: handleSaveAltText,
          loading: isSaving,
        }}
        secondaryActions={[
          {
            content: "Cancel",
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
            {generationConfigured ? (
              <InlineStack gap="200" blockAlign="center">
                <Button
                  icon={MagicIcon}
                  loading={isSuggestingAlt}
                  onClick={handleSuggestAltForEditModal}
                >
                  Optimize with AI
                </Button>
                <Text as="span" variant="bodySm" tone="subdued">
                  Regenerates from the product title and current field text; edit before saving.
                </Text>
              </InlineStack>
            ) : null}
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={altReviewOpen}
        onClose={attemptCloseAltReview}
        title="Review alt text"
        size="large"
        primaryAction={{
          content: "Save all unsaved",
          onAction: handleSaveAllUnsavedInAltModal,
          loading: isBulkSaving && savingRowId === null,
          disabled: !altReviewRows.some(
            (r) => !r.saved && r.altDraft.trim() && !r.error,
          ),
        }}
        secondaryActions={[
          { content: "Close", onAction: attemptCloseAltReview },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p" tone="subdued">
              Edit proposed alt text below, then save each image or use Save all unsaved. Nothing is
              written to the store until you save.
            </Text>
            <Scrollable style={{ maxHeight: "min(480px, 58vh)" }}>
              <BlockStack gap="400">
                {altReviewRows.map((row) => (
                  <Card key={row.id}>
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center" wrap gap="200">
                        <Text as="h3" variant="headingSm">
                          {row.productTitle}
                        </Text>
                        {row.error ? (
                          <Badge tone="critical">Could not propose</Badge>
                        ) : row.saved ? (
                          <Badge tone="success">Saved</Badge>
                        ) : (
                          <Badge tone="warning">Not saved</Badge>
                        )}
                      </InlineStack>
                      <InlineStack gap="300" blockAlign="start" wrap>
                        {row.imageUrl ? (
                          <img
                            src={row.imageUrl}
                            alt=""
                            style={{
                              maxHeight: 96,
                              maxWidth: 96,
                              objectFit: "contain",
                              borderRadius: 8,
                            }}
                          />
                        ) : null}
                        <Box minWidth="200px" maxWidth="100%">
                          {row.error ? (
                            <Banner tone="critical" title="Proposal failed">
                              <Text as="p">{row.error}</Text>
                            </Banner>
                          ) : (
                            <TextField
                              label="Alt text"
                              labelHidden
                              multiline={3}
                              value={row.altDraft}
                              onChange={(v) => updateAltReviewRowDraft(row.id, v)}
                              autoComplete="off"
                              disabled={isBulkSaving}
                            />
                          )}
                        </Box>
                      </InlineStack>
                      {!row.error ? (
                        <InlineStack gap="200" wrap>
                          <Button
                            variant="primary"
                            disabled={
                              !row.altDraft.trim() ||
                              isBulkSaving ||
                              (fetcher.state === "submitting" &&
                                savingRowId === row.id)
                            }
                            loading={
                              fetcher.state === "submitting" &&
                              fetcher.formData?.get("intent") === "bulk_save" &&
                              savingRowId === row.id
                            }
                            onClick={() => handleSaveAltReviewRow(row)}
                          >
                            Save to Shopify
                          </Button>
                        </InlineStack>
                      ) : null}
                    </BlockStack>
                  </Card>
                ))}
              </BlockStack>
            </Scrollable>
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={discardWarningOpen}
        onClose={() => setDiscardWarningOpen(false)}
        title="Discard unsaved alt text?"
        primaryAction={{
          content: "Discard",
          destructive: true,
          onAction: confirmDiscardAltReview,
        }}
        secondaryActions={[
          {
            content: "Keep editing",
            onAction: () => setDiscardWarningOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            You have alt text that is not saved to Shopify. If you continue, those drafts will be
            lost.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}