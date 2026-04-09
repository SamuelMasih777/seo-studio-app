import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  TextField,
  Select,
  Banner,
  Badge,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  isGeminiConfigured,
  generateBlogOutline,
  generateBlogPost,
} from "../gemini-content.server";
import {
  resolveShopPlan,
  checkAndIncrementUsage,
} from "../plan-gate.server";
import { resolvePromptForShop } from "../prompt-resolver.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);

  const billingCheck = await billing.check();
  const resolved = await resolveShopPlan(session.shop, billingCheck);

  const blogsRes = await admin.graphql(`#graphql
    query BlogsList {
      blogs(first: 20) {
        edges { node { id title handle } }
      }
    }
  `);
  const blogsData = (await blogsRes.json()) as {
    data?: { blogs: { edges: { node: { id: string; title: string; handle: string } }[] } };
  };
  const blogs = blogsData.data?.blogs.edges.map((e) => e.node) ?? [];

  let promptTemplates: { id: string; name: string; isDefault: boolean }[] = [];
  try {
    promptTemplates = await prisma.aIPromptTemplate.findMany({
      where: { shop: session.shop },
      select: { id: true, name: true, isDefault: true },
      orderBy: { createdAt: "desc" },
    });
  } catch {}

  return json({
    blogs,
    plan: resolved.plan,
    isEarlyAdopter: resolved.isEarlyAdopter,
    aiConfigured: isGeminiConfigured(),
    canWrite: resolved.limits.blogPostsPerMonth > 0,
    promptTemplates,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const fd = await request.formData();
  const intent = fd.get("intent") as string;

  const billingCheck = await billing.check();
  const resolved = await resolveShopPlan(session.shop, billingCheck);

  if (intent === "generate_outline") {
    const topic = (fd.get("topic") as string) || "";
    const tone = (fd.get("tone") as string) || "professional";
    const keywords = (fd.get("keywords") as string) || "";
    const templateId = (fd.get("templateId") as string) || "";

    const customPrompt = await resolvePromptForShop(session.shop, {
      topic,
      tone,
      keyword: keywords,
    }, templateId || undefined);

    const result = await generateBlogOutline({
      topic,
      tone,
      keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
      customPrompt,
    });

    if (!result.ok) return json({ intent, ok: false, error: result.error });
    return json({ intent, ok: true, outline: result.text });
  }

  if (intent === "generate_post") {
    const outline = (fd.get("outline") as string) || "";
    const topic = (fd.get("topic") as string) || "";
    const tone = (fd.get("tone") as string) || "professional";
    const targetLength = (fd.get("targetLength") as string) || "medium";
    const templateId = (fd.get("templateId") as string) || "";

    const customPrompt = await resolvePromptForShop(session.shop, {
      topic,
      tone,
    }, templateId || undefined);

    const result = await generateBlogPost({
      outline,
      topic,
      tone,
      targetLength: targetLength as "short" | "medium" | "long",
      customPrompt,
    });

    if (!result.ok) return json({ intent, ok: false, error: result.error });
    return json({
      intent,
      ok: true,
      title: result.title,
      body: result.body,
      metaDescription: result.metaDescription,
    });
  }

  if (intent === "publish") {
    const usageCheck = await checkAndIncrementUsage(
      session.shop,
      "blogPostCount",
      resolved.plan,
    );
    if (!usageCheck.allowed) {
      return json({
        intent,
        ok: false,
        error: `Blog post limit reached (${usageCheck.used}/${usageCheck.limit} this month). Upgrade your plan for more.`,
      });
    }

    const blogId = fd.get("blogId") as string;
    const title = fd.get("title") as string;
    const body = fd.get("body") as string;
    const tags = (fd.get("tags") as string) || "";
    const published = fd.get("published") === "true";

    try {
      const res = await admin.graphql(
        `#graphql
        mutation CreateArticle($article: ArticleCreateInput!) {
          articleCreate(article: $article) {
            article { id title handle }
            userErrors { field message }
          }
        }`,
        {
          variables: {
            article: {
              blogId,
              title,
              body,
              tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
              isPublished: published,
            },
          },
        },
      );

      const data = (await res.json()) as {
        data?: {
          articleCreate: {
            article?: { id: string; title: string; handle: string };
            userErrors: { field: string; message: string }[];
          };
        };
      };

      const errors = data.data?.articleCreate?.userErrors ?? [];
      if (errors.length > 0) {
        return json({
          intent,
          ok: false,
          error: errors.map((e) => e.message).join("; "),
        });
      }

      return json({
        intent,
        ok: true,
        article: data.data?.articleCreate?.article,
      });
    } catch (e) {
      return json({
        intent,
        ok: false,
        error: e instanceof Error ? e.message : "Failed to publish article.",
      });
    }
  }

  return json({ intent: "", ok: false, error: "Unknown intent" });
};

type Step = "topic" | "outline" | "preview" | "published";

export default function AIBlogWriter() {
  const { blogs, plan, isEarlyAdopter, aiConfigured, canWrite, promptTemplates } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const isSubmitting = fetcher.state !== "idle";

  const defaultTplId = promptTemplates.find((t: any) => t.isDefault)?.id || "";
  const [selectedTemplateId, setSelectedTemplateId] = useState(defaultTplId);
  const [step, setStep] = useState<Step>("topic");
  const [topic, setTopic] = useState("");
  const [keywords, setKeywords] = useState("");
  const [tone, setTone] = useState("professional");
  const [targetLength, setTargetLength] = useState("medium");
  const [outline, setOutline] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [metaDesc, setMetaDesc] = useState("");
  const [selectedBlog, setSelectedBlog] = useState(blogs[0]?.id || "");
  const [publishAsDraft, setPublishAsDraft] = useState(true);
  const [tags, setTags] = useState("");

  const fetcherData = fetcher.data as Record<string, unknown> | undefined;

  const handleOutline = () => {
    fetcher.submit(
      { intent: "generate_outline", topic, tone, keywords, templateId: selectedTemplateId },
      { method: "POST" },
    );
  };

  const handlePost = () => {
    fetcher.submit(
      { intent: "generate_post", outline, topic, tone, targetLength, templateId: selectedTemplateId },
      { method: "POST" },
    );
  };

  const handlePublish = () => {
    fetcher.submit(
      {
        intent: "publish",
        blogId: selectedBlog,
        title,
        body,
        tags,
        published: publishAsDraft ? "false" : "true",
      },
      { method: "POST" },
    );
  };

  if (
    fetcher.state === "idle" &&
    fetcherData?.intent === "generate_outline" &&
    fetcherData?.ok === true &&
    step === "topic"
  ) {
    setOutline(fetcherData.outline as string);
    setStep("outline");
  }

  if (
    fetcher.state === "idle" &&
    fetcherData?.intent === "generate_post" &&
    fetcherData?.ok === true &&
    step === "outline"
  ) {
    setTitle(fetcherData.title as string);
    setBody(fetcherData.body as string);
    setMetaDesc(fetcherData.metaDescription as string);
    setStep("preview");
  }

  if (
    fetcher.state === "idle" &&
    fetcherData?.intent === "publish" &&
    fetcherData?.ok === true &&
    step === "preview"
  ) {
    setStep("published");
  }

  const error =
    fetcher.state === "idle" && fetcherData && fetcherData.ok === false
      ? (fetcherData.error as string)
      : null;

  const stepNumber = step === "topic" ? 1 : step === "outline" ? 2 : step === "preview" ? 3 : 4;

  return (
    <Page>
      <TitleBar title="AI Blog Writer" />
      <BlockStack gap="500">
        {!aiConfigured && (
          <Banner tone="warning">
            <Text as="p">AI is not configured. Set GEMINI_API_KEY in your environment.</Text>
          </Banner>
        )}
        {!canWrite && !isEarlyAdopter && (
          <Banner tone="warning">
            <Text as="p">AI Blog Writer requires a Pro or Premium plan. Upgrade to start writing.</Text>
          </Banner>
        )}
        {error && (
          <Banner tone="critical">
            <Text as="p">{error}</Text>
          </Banner>
        )}

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
              ? "Using custom template for blog generation"
              : "Using built-in prompts"}
          </Text>
        </InlineStack>

        {/* Steps indicator */}
        <Card>
          <InlineStack gap="400" align="center">
            {["Topic & Keywords", "Review Outline", "Preview & Edit", "Published"].map(
              (label, i) => (
                <InlineStack key={i} gap="200" blockAlign="center">
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                      fontWeight: 600,
                      backgroundColor:
                        i + 1 <= stepNumber
                          ? "var(--p-color-bg-fill-success)"
                          : "var(--p-color-bg-fill-secondary)",
                      color:
                        i + 1 <= stepNumber
                          ? "var(--p-color-text-on-color)"
                          : "var(--p-color-text-secondary)",
                    }}
                  >
                    {i + 1}
                  </div>
                  <Text
                    as="span"
                    variant="bodySm"
                    fontWeight={i + 1 === stepNumber ? "bold" : "regular"}
                  >
                    {label}
                  </Text>
                </InlineStack>
              ),
            )}
          </InlineStack>
        </Card>

        <Layout>
          <Layout.Section>
            {step === "topic" && (
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingLg">Step 1: Enter your topic</Text>
                  <TextField
                    label="Blog topic / primary keyword"
                    value={topic}
                    onChange={setTopic}
                    placeholder="e.g. best walking shoes for flat feet"
                    autoComplete="off"
                  />
                  <TextField
                    label="Additional keywords (comma separated)"
                    value={keywords}
                    onChange={setKeywords}
                    placeholder="e.g. arch support, comfort, running"
                    autoComplete="off"
                  />
                  <InlineStack gap="400">
                    <Select
                      label="Tone"
                      options={[
                        { label: "Professional", value: "professional" },
                        { label: "Casual", value: "casual" },
                        { label: "Persuasive", value: "persuasive" },
                        { label: "Informative", value: "informative" },
                        { label: "Friendly", value: "friendly" },
                      ]}
                      value={tone}
                      onChange={setTone}
                    />
                    <Select
                      label="Target length"
                      options={[
                        { label: "Short (600-900 words)", value: "short" },
                        { label: "Medium (900-1400 words)", value: "medium" },
                        { label: "Long (1500-2200 words)", value: "long" },
                      ]}
                      value={targetLength}
                      onChange={setTargetLength}
                    />
                  </InlineStack>
                  <Button
                    variant="primary"
                    onClick={handleOutline}
                    loading={isSubmitting}
                    disabled={!topic.trim() || !aiConfigured || (!canWrite && !isEarlyAdopter)}
                  >
                    Generate Outline
                  </Button>
                </BlockStack>
              </Card>
            )}

            {step === "outline" && (
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingLg">Step 2: Review & edit outline</Text>
                  <TextField
                    label="Outline"
                    value={outline}
                    onChange={setOutline}
                    multiline={12}
                    autoComplete="off"
                  />
                  <InlineStack gap="200">
                    <Button onClick={() => setStep("topic")}>Back</Button>
                    <Button
                      variant="primary"
                      onClick={handlePost}
                      loading={isSubmitting}
                    >
                      Generate Full Post
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            )}

            {step === "preview" && (
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingLg">Step 3: Preview & publish</Text>

                  <TextField
                    label="Blog post title"
                    value={title}
                    onChange={setTitle}
                    autoComplete="off"
                  />
                  <TextField
                    label="Meta description"
                    value={metaDesc}
                    onChange={setMetaDesc}
                    autoComplete="off"
                    maxLength={320}
                  />

                  <Divider />

                  <Text as="h3" variant="headingMd">Content preview</Text>
                  <div
                    style={{
                      border: "1px solid var(--p-color-border-secondary)",
                      borderRadius: 8,
                      padding: 16,
                      maxHeight: 500,
                      overflow: "auto",
                      fontSize: 14,
                      lineHeight: 1.6,
                    }}
                    dangerouslySetInnerHTML={{ __html: body }}
                  />

                  <Divider />

                  <InlineStack gap="400">
                    {blogs.length > 0 && (
                      <Select
                        label="Publish to blog"
                        options={blogs.map((b) => ({ label: b.title, value: b.id }))}
                        value={selectedBlog}
                        onChange={setSelectedBlog}
                      />
                    )}
                    <Select
                      label="Visibility"
                      options={[
                        { label: "Save as Draft", value: "draft" },
                        { label: "Publish Now", value: "publish" },
                      ]}
                      value={publishAsDraft ? "draft" : "publish"}
                      onChange={(v) => setPublishAsDraft(v === "draft")}
                    />
                  </InlineStack>
                  <TextField
                    label="Tags (comma separated)"
                    value={tags}
                    onChange={setTags}
                    placeholder="e.g. shoes, walking, health"
                    autoComplete="off"
                  />

                  <InlineStack gap="200">
                    <Button onClick={() => setStep("outline")}>Back to Outline</Button>
                    <Button
                      variant="primary"
                      onClick={handlePublish}
                      loading={isSubmitting}
                      disabled={!selectedBlog || !title.trim()}
                    >
                      {publishAsDraft ? "Save as Draft" : "Publish Now"}
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            )}

            {step === "published" && (
              <Card>
                <BlockStack gap="400" inlineAlign="center">
                  <Badge tone="success">Published</Badge>
                  <Text as="h2" variant="headingLg" alignment="center">
                    Blog post created successfully!
                  </Text>
                  <Text as="p" tone="subdued" alignment="center">
                    Your article "{title}" has been {publishAsDraft ? "saved as a draft" : "published"}.
                    You can view and edit it in your Shopify admin under Blog posts.
                  </Text>
                  <Button
                    variant="primary"
                    onClick={() => {
                      setStep("topic");
                      setTopic("");
                      setOutline("");
                      setTitle("");
                      setBody("");
                      setMetaDesc("");
                      setTags("");
                    }}
                  >
                    Write Another Blog Post
                  </Button>
                </BlockStack>
              </Card>
            )}
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
