import { useState, useEffect, useRef } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import {
  useLoaderData,
  useFetcher,
  useNavigate,
  useRouteError,
  isRouteErrorResponse,
} from "@remix-run/react";
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
  IndexTable,
  Thumbnail,
  Banner,
  useIndexResourceState,
  InlineGrid,
  Box,
  Spinner,
  Modal,
  Scrollable,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { MagicIcon, CheckCircleIcon, ImageIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import {
  generateProductDescriptionPlain,
  isGeminiConfigured,
  plainTextProductDescriptionToHtml,
} from "../gemini-content.server";
import { resolvePromptForShop } from "../prompt-resolver.server";
import prisma from "../db.server";

type ContentLengthOption = "short" | "medium" | "long";

type BulkReviewRow = {
  id: string;
  title: string;
  text: string;
  error?: string;
  saved: boolean;
};

type GraphqlMutationJson = {
  errors?: { message?: string }[];
  data?: {
    productUpdate?: {
      userErrors?: { message: string }[];
      product?: { id: string };
    };
  };
};

function stripHtmlToPlain(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
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
  const productsConnection = json.data?.products;

  let promptTemplates: { id: string; name: string; isDefault: boolean }[] = [];
  try {
    promptTemplates = await prisma.aIPromptTemplate.findMany({
      where: { shop: session.shop },
      select: { id: true, name: true, isDefault: true },
      orderBy: { createdAt: "desc" },
    });
  } catch {}

  if (!productsConnection?.edges) {
    console.error(
      "[content-optimization] products query missing data",
      JSON.stringify(json).slice(0, 2000),
    );
    return {
      products: [],
      pageInfo: {
        hasNextPage: false,
        hasPreviousPage: false,
        startCursor: null,
        endCursor: null,
      },
      generationConfigured: isGeminiConfigured(),
      promptTemplates,
    };
  }

  return {
    products: productsConnection.edges.map((e: any) => e.node),
    pageInfo: productsConnection.pageInfo,
    generationConfigured: isGeminiConfigured(),
    promptTemplates,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const formData = await request.formData();
    const intent = formData.get("intent") as string;

    if (intent === "bulk_preview") {
      const { admin, session } = await authenticate.admin(request);
      let selectedIds: string[];
      try {
        selectedIds = JSON.parse(formData.get("selectedIds") as string) as string[];
      } catch {
        return { success: false, error: "Invalid product selection." };
      }
      const tone = (formData.get("tone") as string) || "persuasive";
      const length = (formData.get("length") as ContentLengthOption) || "medium";
      const audienceHint = (formData.get("audienceHint") as string) || "";
      const templateId = (formData.get("templateId") as string) || "";

      if (!isGeminiConfigured()) {
        return {
          success: false,
          error:
            "AI content generation is not configured. Ask the app developer to set the API key.",
        };
      }

      const results: {
        id: string;
        title: string;
        text?: string;
        error?: string;
      }[] = [];

      for (const id of selectedIds) {
        const fetchResponse = await admin.graphql(
          `#graphql
          query getProductForContent($id: ID!) {
            product(id: $id) {
              title
              descriptionHtml
            }
          }`,
          { variables: { id } },
        );
        const fetchJson = await fetchResponse.json();
        const product = fetchJson.data?.product;
        const productTitle = product?.title || "Product";
        const originalPlain = stripHtmlToPlain(product?.descriptionHtml || "");

        const customPrompt = await resolvePromptForShop(session.shop, {
          product_title: productTitle,
          product_description: originalPlain,
          tone,
        }, templateId || undefined);

        const gen = await generateProductDescriptionPlain({
          productTitle,
          targetKeyword: productTitle,
          tone,
          length,
          audienceHint: audienceHint || undefined,
          originalDescriptionPlain: originalPlain || undefined,
          customPrompt,
        });

        if (!gen.ok) {
          results.push({ id, title: productTitle, error: gen.error });
        } else {
          results.push({ id, title: productTitle, text: gen.text });
        }

        await new Promise((r) => setTimeout(r, 350));
      }

      return {
        success: true,
        type: "bulk_preview" as const,
        results,
      };
    }

    if (intent === "bulk_save") {
      const { admin } = await authenticate.admin(request);
      let items: { id: string; descriptionPlain: string }[];
      try {
        items = JSON.parse(formData.get("items") as string) as {
          id: string;
          descriptionPlain: string;
        }[];
      } catch {
        return { success: false, error: "Invalid save payload." };
      }

      const warnings: string[] = [];
      const savedIds: string[] = [];

      for (const { id, descriptionPlain } of items) {
        if (!descriptionPlain?.trim()) continue;
        const descriptionHtml = plainTextProductDescriptionToHtml(descriptionPlain);
        const updateRes = await admin.graphql(
          `#graphql
          mutation productBulkSaveDesc($input: ProductInput!) {
            productUpdate(input: $input) {
              userErrors { field message }
              product { id }
            }
          }`,
          {
            variables: {
              input: {
                id,
                descriptionHtml,
              },
            },
          },
        );
        const updateJson = (await updateRes.json()) as GraphqlMutationJson;
        if (updateJson.errors?.length) {
          warnings.push(
            `${id}: ${updateJson.errors.map((e) => e.message ?? "").join("; ")}`,
          );
        } else {
          const userErrors = updateJson.data?.productUpdate?.userErrors;
          if (userErrors?.length) {
            warnings.push(
              `${id}: ${userErrors.map((e: { message: string }) => e.message).join("; ")}`,
            );
          } else {
            savedIds.push(id);
          }
        }
        await new Promise((r) => setTimeout(r, 250));
      }

      return {
        success: true,
        type: "bulk_save" as const,
        savedCount: savedIds.length,
        savedIds,
        ...(warnings.length ? { warnings } : {}),
      };
    }

    if (intent === "generate") {
      const { session } = await authenticate.admin(request);

      if (!isGeminiConfigured()) {
        return {
          success: false,
          error:
            "AI content generation is not configured. Ask the app developer to set the API key.",
        };
      }

      const keyword = (formData.get("keyword") as string) || "";
      const tone = (formData.get("tone") as string) || "persuasive";
      const length = (formData.get("length") as ContentLengthOption) || "medium";
      const audienceHint = (formData.get("audienceHint") as string) || "";
      const templateId = (formData.get("templateId") as string) || "";
      const productTitle =
        (formData.get("productTitle") as string) || keyword || "Product";
      const original = (formData.get("original") as string) || "";

      if (!keyword.trim()) {
        return {
          success: false,
          error: "Add a target keyword before generating with AI.",
        };
      }

      const customPrompt = await resolvePromptForShop(session.shop, {
        product_title: productTitle,
        product_description: original,
        tone,
        keyword: keyword.trim(),
      }, templateId || undefined);

      const gen = await generateProductDescriptionPlain({
        productTitle,
        targetKeyword: keyword.trim(),
        tone,
        length,
        audienceHint: audienceHint.trim() || undefined,
        originalDescriptionPlain: original.trim() || undefined,
        customPrompt,
      });

      if (!gen.ok) {
        return { success: false, error: gen.error };
      }

      return {
        success: true,
        type: "generation" as const,
        generatedContent: gen.text,
      };
    }

    if (intent === "save") {
      const { admin } = await authenticate.admin(request);
      const id = formData.get("id") as string;
      const descriptionPlain = formData.get("descriptionPlain") as string;
      const descriptionHtml = plainTextProductDescriptionToHtml(descriptionPlain);

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
        },
      );

      const json = await response.json();
      return {
        success: true,
        type: "save" as const,
        productId: id,
        data: json.data?.productUpdate,
      };
    }

    return { success: false, error: "Invalid intent" };
  } catch (e) {
    if (e instanceof Response) throw e;
    console.error("[content-optimization] action", e);
    return {
      success: false,
      error:
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
    };
  }
};

/** Matches successful `action` JSON payloads after `data.success === true`. */
type ContentActionSuccess =
  | { success: true; type: "generation"; generatedContent?: string }
  | { success: true; type: "save"; productId?: string; data?: unknown }
  | {
      success: true;
      type: "bulk_preview";
      results: {
        id: string;
        title: string;
        text?: string;
        error?: string;
      }[];
    }
  | {
      success: true;
      type: "bulk_save";
      savedCount: number;
      savedIds: string[];
      warnings?: string[];
    };

export function ErrorBoundary() {
  const error = useRouteError();
  let message = "An unexpected error occurred.";
  if (isRouteErrorResponse(error)) {
    message =
      typeof error.data === "string" && error.data.trim()
        ? error.data
        : `${error.status} ${error.statusText || "Error"}`;
  } else if (error instanceof Error) {
    message = error.message || message;
  }

  return (
    <Page>
      <TitleBar title="AI Content Optimization" />
      <Layout>
        <Layout.Section>
          <Banner tone="critical" title="Application error">
            <Text as="p">{message}</Text>
          </Banner>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export default function ContentOptimizationPage() {
  const { products, pageInfo, generationConfigured, promptTemplates } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();

  const defaultTplId = promptTemplates.find((t: any) => t.isDefault)?.id || "";
  const [selectedTemplateId, setSelectedTemplateId] = useState(defaultTplId);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const {
    selectedResources,
    allResourcesSelected,
    handleSelectionChange,
    clearSelection,
  } = useIndexResourceState(products);
  const [showBanner, setShowBanner] = useState<{
    show: boolean;
    type: string;
    count: number;
    warnings?: string[];
  }>({ show: false, type: "", count: 0 });
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // AI writing options (single-product editor)
  const [keyword, setKeyword] = useState("");
  const [tone, setTone] = useState("persuasive");
  const [length, setLength] = useState<ContentLengthOption>("medium");
  const [audienceHint, setAudienceHint] = useState("");

  // Bulk list - same options apply to each selected product
  const [bulkTone, setBulkTone] = useState("persuasive");
  const [bulkLength, setBulkLength] = useState<ContentLengthOption>("medium");
  const [bulkAudienceHint, setBulkAudienceHint] = useState("");

  const [bulkReviewOpen, setBulkReviewOpen] = useState(false);
  const [bulkReviewRows, setBulkReviewRows] = useState<BulkReviewRow[]>([]);
  const [discardWarningOpen, setDiscardWarningOpen] = useState(false);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const bulkReviewOpenRef = useRef(false);

  // Content State
  const [originalContent, setOriginalContent] = useState("");
  const [optimizedContent, setOptimizedContent] = useState("");

  useEffect(() => {
    bulkReviewOpenRef.current = bulkReviewOpen;
  }, [bulkReviewOpen]);

  useEffect(() => {
    const data = fetcher.data;
    if (!data) return;

    if (!data.success) {
      setErrorBanner("error" in data && data.error ? data.error : "Request failed.");
      setSavingRowId(null);
      return;
    }

    setErrorBanner(null);
    const ok = data as ContentActionSuccess;
    if (ok.type === "generation") {
      setOptimizedContent(ok.generatedContent ?? "");
    } else if (ok.type === "save") {
      if (bulkReviewOpenRef.current && ok.productId) {
        setBulkReviewRows((prev) =>
          prev.map((r) =>
            r.id === ok.productId ? { ...r, saved: true } : r,
          ),
        );
      } else {
        setShowBanner({ show: true, type: "single", count: 1 });
      }
      setSavingRowId(null);
    } else if (ok.type === "bulk_preview") {
      setBulkReviewRows(
        ok.results.map((r) => ({
          id: r.id,
          title: r.title,
          text: r.text ?? "",
          error: r.error,
          saved: false,
        })),
      );
      setBulkReviewOpen(true);
      clearSelection();
    } else if (ok.type === "bulk_save") {
      setBulkReviewRows((prev) =>
        prev.map((row) =>
          ok.savedIds.includes(row.id) ? { ...row, saved: true } : row,
        ),
      );
      setShowBanner({
        show: true,
        type: "bulk_saved",
        count: ok.savedCount,
        warnings: ok.warnings,
      });
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
    { label: "Friendly", value: "friendly" },
    { label: "Luxury / premium", value: "luxury" },
    { label: "Technical / spec-focused", value: "technical" },
    { label: "Minimal / concise", value: "minimal" },
  ];

  const lengthOptions = [
    { label: "Short (60–100 words)", value: "short" },
    { label: "Medium (120–180 words)", value: "medium" },
    { label: "Long (200–320 words)", value: "long" },
  ];

  const handleSelectProduct = (product: any) => {
    setSelectedProduct(product);
    const plainText = stripHtmlToPlain(product.descriptionHtml || "");
    setOriginalContent(plainText);
    setOptimizedContent(""); 
    setKeyword(product.title); 
    setShowBanner({show: false, type: "", count: 0});
  };

  const handleGenerate = () => {
    setShowBanner({ show: false, type: "", count: 0 });
    setErrorBanner(null);
    fetcher.submit(
      {
        intent: "generate",
        keyword,
        tone,
        length,
        audienceHint,
        productTitle: selectedProduct?.title || "",
        original: originalContent,
        templateId: selectedTemplateId,
      },
      { method: "POST" },
    );
  };

  const handleApplyToShopify = () => {
    fetcher.submit(
      {
        intent: "save",
        id: selectedProduct.id,
        descriptionPlain: optimizedContent,
      },
      { method: "POST" },
    );
  };

  const handleBulkPreview = () => {
    setErrorBanner(null);
    fetcher.submit(
      {
        intent: "bulk_preview",
        selectedIds: JSON.stringify(selectedResources),
        tone: bulkTone,
        length: bulkLength,
        audienceHint: bulkAudienceHint,
        templateId: selectedTemplateId,
      },
      { method: "POST" },
    );
  };

  const hasUnsavedBulkDrafts = bulkReviewRows.some(
    (r) => !r.saved && r.text.trim().length > 0,
  );

  const attemptCloseBulkReview = () => {
    if (hasUnsavedBulkDrafts) {
      setDiscardWarningOpen(true);
      return;
    }
    setBulkReviewOpen(false);
    setBulkReviewRows([]);
  };

  const confirmDiscardBulkReview = () => {
    setDiscardWarningOpen(false);
    setBulkReviewOpen(false);
    setBulkReviewRows([]);
  };

  const handleSaveAllUnsavedInModal = () => {
    const items = bulkReviewRows
      .filter((r) => !r.saved && r.text.trim())
      .map((r) => ({ id: r.id, descriptionPlain: r.text }));
    if (items.length === 0) return;
    fetcher.submit(
      {
        intent: "bulk_save",
        items: JSON.stringify(items),
      },
      { method: "POST" },
    );
  };

  const handleSaveBulkRow = (id: string, text: string) => {
    setSavingRowId(id);
    fetcher.submit(
      {
        intent: "save",
        id,
        descriptionPlain: text,
      },
      { method: "POST" },
    );
  };

  const updateBulkRowText = (id: string, text: string) => {
    setBulkReviewRows((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, text, saved: false } : r,
      ),
    );
  };

  const isGenerating = fetcher.state === "submitting" && fetcher.formData?.get("intent") === "generate";
  const isSaving =
    fetcher.state === "submitting" &&
    fetcher.formData?.get("intent") === "save" &&
    Boolean(selectedProduct) &&
    !bulkReviewOpen;
  const isBulkPreviewing =
    fetcher.state === "submitting" &&
    fetcher.formData?.get("intent") === "bulk_preview";
  const isBulkSaving =
    fetcher.state === "submitting" &&
    fetcher.formData?.get("intent") === "bulk_save";

  const originalWordCount = originalContent.split(/\s+/).filter(Boolean).length;
  const optimizedWordCount = optimizedContent.split(/\s+/).filter(Boolean).length;

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
        {(product.descriptionHtml ?? "").length > 50 ? (
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
      content: "Auto-generate AI descriptions",
      onAction: handleBulkPreview,
    },
  ];

  return (
    <Page>
      <TitleBar title="AI Content Optimization" />
      <BlockStack gap="500">
        <Layout>
          {!generationConfigured && (
            <Layout.Section>
              <Banner tone="warning" title="AI content generation unavailable">
                <Text as="p">
                  AI-powered descriptions are not enabled for this installation yet. The app
                  developer needs to configure the server environment.
                </Text>
              </Banner>
            </Layout.Section>
          )}

          {errorBanner && (
            <Layout.Section>
              <Banner
                tone="critical"
                title="Could not complete request"
                onDismiss={() => setErrorBanner(null)}
              >
                <Text as="p">{errorBanner}</Text>
              </Banner>
            </Layout.Section>
          )}

          <Layout.Section>
            <InlineStack gap="300" blockAlign="end">
              <div style={{ minWidth: 220 }}>
                <Select
                  label="AI Prompt Template"
                  options={[
                    { label: "Built-in (default)", value: "" },
                    ...promptTemplates.map((t: any) => ({
                      label: `${t.name}${t.isDefault ? " ★" : ""}`,
                      value: t.id,
                    })),
                  ]}
                  value={selectedTemplateId}
                  onChange={setSelectedTemplateId}
                />
              </div>
              <Text as="p" variant="bodySm" tone="subdued">
                {selectedTemplateId
                  ? "Using custom template for AI generation"
                  : "Using built-in prompts"}
              </Text>
            </InlineStack>
          </Layout.Section>

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
                    ? `Saved ${showBanner.count} product description(s) to Shopify.`
                    : "Product description updated in Shopify!"
                }
                onDismiss={() => setShowBanner({ show: false, type: "", count: 0 })}
              >
                {showBanner.type === "bulk_saved" &&
                showBanner.warnings &&
                showBanner.warnings.length > 0 ? (
                  <BlockStack gap="200">
                    <Text as="p" tone="subdued">
                      Some rows were skipped ({showBanner.warnings.length} note
                      {showBanner.warnings.length === 1 ? "" : "s"}):
                    </Text>
                    <Text as="p" tone="subdued">
                      {showBanner.warnings.slice(0, 5).join(" · ")}
                      {showBanner.warnings.length > 5 ? " …" : ""}
                    </Text>
                  </BlockStack>
                ) : null}
              </Banner>
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
                      disabled={
                        selectedResources.length === 0 || !generationConfigured
                      }
                      loading={isBulkPreviewing}
                      onClick={handleBulkPreview}
                    >
                      {`Generate Via AI for selected (${selectedResources.length})`}
                    </Button>
                  </InlineStack>
                  <Card background="bg-surface-secondary">
                    <BlockStack gap="300">
                      <Text as="p" variant="bodySm" tone="subdued">
                        AI drafts open in a review window - nothing is saved to Shopify until you
                        confirm. Options below apply to each selected product (keyword defaults to
                        title).
                      </Text>
                      <InlineStack gap="400" wrap>
                        <Select
                          label="Tone"
                          options={toneOptions}
                          value={bulkTone}
                          onChange={setBulkTone}
                        />
                        <Select
                          label="Length"
                          options={lengthOptions}
                          value={bulkLength}
                          onChange={(v) => setBulkLength(v as ContentLengthOption)}
                        />
                      </InlineStack>
                      <TextField
                        label="Audience or brand notes (optional)"
                        value={bulkAudienceHint}
                        onChange={setBulkAudienceHint}
                        autoComplete="off"
                        multiline={2}
                        helpText='Optional context for every product (e.g. outdoor enthusiasts, eco-conscious).'
                      />
                    </BlockStack>
                  </Card>
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
                  <InlineStack
                    align="space-between"
                    blockAlign="start"
                    wrap
                    gap="400"
                  >
                    <BlockStack gap="200">
                      <Button
                        variant="plain"
                        onClick={() => setSelectedProduct(null)}
                      >
                        ← Back to products
                      </Button>
                      <Text as="h2" variant="headingLg">
                        {selectedProduct.title}
                      </Text>
                      <Text as="p" tone="subdued" variant="bodySm">
                        Work top to bottom: refine the source text, tune AI options on the right,
                        generate a draft, then save when you are happy with it.
                      </Text>
                    </BlockStack>
                    <InlineStack gap="200" blockAlign="center" wrap>
                      <Badge tone="info">{`${originalWordCount} words · source`}</Badge>
                      {optimizedContent ? (
                        <Badge tone="success">
                          {`${optimizedWordCount} words · draft`}
                        </Badge>
                      ) : null}
                    </InlineStack>
                  </InlineStack>
                </Card>
              </Layout.Section>

              <Layout.Section>
                <InlineGrid
                  columns={{ xs: 1, lg: ["twoThirds", "oneThird"] }}
                  gap="500"
                  alignItems="start"
                >
                  <BlockStack gap="400">
                    <Card>
                      <BlockStack gap="300">
                        <Text as="h3" variant="headingMd">
                          1. Source description
                        </Text>
                        <Text as="p" tone="subdued" variant="bodySm">
                          What is on the product today. Edit this if you want new copy to reflect
                          different details.
                        </Text>
                        <Box maxWidth="720px">
                          <TextField
                            labelHidden
                            label="Original content"
                            value={originalContent}
                            onChange={setOriginalContent}
                            multiline={8}
                            autoComplete="off"
                          />
                        </Box>
                      </BlockStack>
                    </Card>

                    <Card>
                      <BlockStack gap="400">
                        <InlineStack
                          align="space-between"
                          blockAlign="center"
                          wrap
                          gap="300"
                        >
                          <BlockStack gap="100">
                            <Text as="h3" variant="headingMd">
                              2. AI draft
                            </Text>
                            <Text as="p" tone="subdued" variant="bodySm">
                              Uses the AI options in the panel on the right.
                            </Text>
                          </BlockStack>
                          <InlineStack gap="200" wrap blockAlign="center">
                            <Button
                              icon={MagicIcon}
                              variant="primary"
                              loading={isGenerating}
                              onClick={handleGenerate}
                              disabled={!generationConfigured}
                            >
                              {isGenerating ? "Generating…" : "Generate with AI"}
                            </Button>
                            <Button
                              variant="secondary"
                              loading={isSaving}
                              disabled={!optimizedContent.trim()}
                              onClick={handleApplyToShopify}
                            >
                              Save to Shopify
                            </Button>
                          </InlineStack>
                        </InlineStack>

                        {isGenerating ? (
                          <InlineStack gap="300" blockAlign="center">
                            <Spinner size="small" />
                            <Text as="span" tone="subdued" variant="bodySm">
                              AI is writing your description - usually a few seconds.
                            </Text>
                          </InlineStack>
                        ) : null}

                        {optimizedContent ? (
                          <Box maxWidth="720px">
                            <TextField
                              labelHidden
                              label="AI draft"
                              value={optimizedContent}
                              onChange={setOptimizedContent}
                              multiline={8}
                              autoComplete="off"
                            />
                          </Box>
                        ) : (
                          <Box
                            padding="600"
                            background="bg-surface-secondary"
                            borderRadius="300"
                          >
                            <BlockStack gap="200" inlineAlign="center">
                              <Text
                                as="p"
                                tone="subdued"
                                variant="bodySm"
                                alignment="center"
                              >
                                Your AI-generated description will appear here. Set tone and length
                                on the right, then use Generate with AI above.
                              </Text>
                            </BlockStack>
                          </Box>
                        )}

                        <InlineStack gap="100" blockAlign="center">
                          <CheckCircleIcon fill="var(--p-color-icon-success)" width={16} />
                          <Text as="span" tone="subdued" variant="bodySm">
                            AI-generated text may be inaccurate - review before saving to the store.
                          </Text>
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  </BlockStack>

                  <Box position="sticky" insetBlockStart="400" width="100%">
                    <Card>
                      <BlockStack gap="400">
                        <Text as="h2" variant="headingMd">
                          AI style and length
                        </Text>
                        <TextField
                          label="Target keyword"
                          value={keyword}
                          onChange={setKeyword}
                          autoComplete="off"
                          helpText="Primary phrase to work into the copy naturally."
                        />
                        <Select
                          label="Brand tone"
                          options={toneOptions}
                          onChange={setTone}
                          value={tone}
                        />
                        <Select
                          label="Length"
                          options={lengthOptions}
                          value={length}
                          onChange={(v) => setLength(v as ContentLengthOption)}
                        />
                        <TextField
                          label="Audience or brand notes (optional)"
                          value={audienceHint}
                          onChange={setAudienceHint}
                          autoComplete="off"
                          multiline={3}
                        />
                        <Text as="p" tone="subdued" variant="bodySm">
                          When you are ready, use Generate with AI in the draft section on the left.
                        </Text>
                        <Text as="p" tone="subdued" variant="bodySm">
                          Word counts: {originalWordCount} source
                          {optimizedContent
                            ? ` → ${optimizedWordCount} draft`
                            : ""}
                        </Text>
                      </BlockStack>
                    </Card>
                  </Box>
                </InlineGrid>
              </Layout.Section>
            </>
          )}
        </Layout>
      </BlockStack>

      <Modal
        open={bulkReviewOpen}
        onClose={attemptCloseBulkReview}
        title="Review AI descriptions"
        size="large"
        primaryAction={{
          content: "Save all unsaved",
          onAction: handleSaveAllUnsavedInModal,
          loading: isBulkSaving,
          disabled: !bulkReviewRows.some((r) => !r.saved && r.text.trim()),
        }}
        secondaryActions={[
          { content: "Close", onAction: attemptCloseBulkReview },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p" tone="subdued">
              Edit drafts below, then save each product or use Save all unsaved. Nothing is written
              to the store until you save.
            </Text>
            <Scrollable style={{ maxHeight: "min(480px, 58vh)" }}>
              <BlockStack gap="400">
                {bulkReviewRows.map((row) => (
                  <Card key={row.id}>
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center" wrap gap="200">
                        <Text as="h3" variant="headingSm">
                          {row.title}
                        </Text>
                        {row.error ? (
                          <Badge tone="critical">Generation failed</Badge>
                        ) : row.saved ? (
                          <Badge tone="success">Saved</Badge>
                        ) : (
                          <Badge tone="warning">Not saved</Badge>
                        )}
                      </InlineStack>
                      {row.error ? (
                        <Banner tone="critical" title="Could not generate">
                          <Text as="p">{row.error}</Text>
                        </Banner>
                      ) : (
                        <>
                          <TextField
                            label="AI draft"
                            labelHidden
                            multiline={6}
                            value={row.text}
                            onChange={(v) => updateBulkRowText(row.id, v)}
                            autoComplete="off"
                            disabled={isBulkSaving}
                          />
                          <InlineStack gap="200" wrap>
                            <Button
                              variant="primary"
                              disabled={
                                !row.text.trim() ||
                                isBulkSaving ||
                                (fetcher.state === "submitting" &&
                                  savingRowId === row.id)
                              }
                              loading={
                                fetcher.state === "submitting" &&
                                fetcher.formData?.get("intent") === "save" &&
                                savingRowId === row.id
                              }
                              onClick={() => handleSaveBulkRow(row.id, row.text)}
                            >
                              Save to Shopify
                            </Button>
                          </InlineStack>
                        </>
                      )}
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
        title="Discard unsaved drafts?"
        primaryAction={{
          content: "Discard",
          destructive: true,
          onAction: confirmDiscardBulkReview,
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
            You have AI-generated descriptions that are not saved to Shopify. If you continue, those
            drafts will be lost.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}