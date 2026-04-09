import { useState, useCallback } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Divider,
  Collapsible,
  Icon,
  Link,
  Badge,
  Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { ChevronDownIcon, ChevronUpIcon } from "@shopify/polaris-icons";

const SUPPORT_EMAIL = "support@designflowdigitals.com";

interface FaqItem {
  q: string;
  a: string;
  category: string;
}

const FAQ_DATA: FaqItem[] = [
  // General
  {
    category: "General",
    q: "What is SEO Suite AI?",
    a: "SEO Suite AI is an all-in-one Shopify SEO toolkit that helps you audit your store's SEO health, optimize meta tags, generate AI-powered product descriptions and blog posts, compress images, fix broken links, manage schema markup, and much more — all from a single dashboard.",
  },
  {
    category: "General",
    q: "Do I need any technical knowledge to use this app?",
    a: "Not at all. The app is designed for store owners of all skill levels. Every feature includes guided interfaces, and our AI handles the heavy lifting for content generation, alt text, and SEO fixes.",
  },

  // Dashboard & Audits
  {
    category: "SEO Audit & Dashboard",
    q: "How does the SEO audit work?",
    a: "When you click \"Run Full Audit\" on the dashboard, the app scans your products, collections, pages, blog articles, and theme files for SEO issues — including missing meta titles and descriptions, missing image alt text, broken internal links, duplicate content, and theme-level SEO problems. The results are scored out of 100 and cached so you don't have to rescan every visit.",
  },
  {
    category: "SEO Audit & Dashboard",
    q: "How is the SEO score calculated?",
    a: "The score starts at 100 and deducts points for issues found during the audit — for example, missing meta descriptions, products without alt text, broken links, and theme SEO problems. Each category has a capped penalty to keep the scoring fair and balanced.",
  },
  {
    category: "SEO Audit & Dashboard",
    q: "How often should I run an audit?",
    a: "We recommend at least weekly. If you're on a Pro or Premium plan, you can set up automated scheduled audits (daily, weekly, or monthly) through the Automations page so you never have to remember.",
  },

  // Meta Tags
  {
    category: "Meta Tags",
    q: "Can I edit meta titles and descriptions for all my products at once?",
    a: "Yes! The Meta Tags page lets you view and edit titles and descriptions for all products, collections, pages, and articles. The Bulk Editor page also lets you make mass changes efficiently.",
  },

  // AI Content
  {
    category: "AI Content",
    q: "What does AI Content Optimization do?",
    a: "It uses Google's Gemini AI to generate SEO-optimized product descriptions based on your product title, target keywords, writing tone, and desired length. You can preview the generated text, edit it, and save it directly to your product — individually or in bulk.",
  },
  {
    category: "AI Content",
    q: "Can I customize the AI prompts?",
    a: "Absolutely. Go to AI Settings (AI Prompt Templates) to create custom prompt templates with variables like {{product_title}}, {{tone}}, {{keyword}}, and {{shop_name}}. Set one as the default and it will be used across all AI generation features — content optimization, image alt text, and blog writing.",
  },
  {
    category: "AI Content",
    q: "What is the AI Blog Writer?",
    a: "The AI Blog Writer lets you generate full SEO-optimized blog posts using AI. You provide a topic, keywords, and tone — the app generates an outline, then a full post with a meta description. You can review, edit, and publish it directly to your Shopify blog as a draft or live article.",
  },

  // Images
  {
    category: "Images",
    q: "How does Image Alt Text optimization work?",
    a: "The Image Alt Text page scans all your product images and flags those with missing or low-quality alt text. You can generate AI-suggested alt text or apply text patterns in bulk, then save them directly to Shopify.",
  },
  {
    category: "Images",
    q: "How does Image Compression work?",
    a: "The Image Compression feature shows your product, collection, and blog images with their file sizes. You can select images to compress, choose a quality level, and the app compresses them directly — reducing page load time and improving Core Web Vitals, which helps SEO.",
  },

  // Schema & Technical
  {
    category: "Technical SEO",
    q: "What is Schema Markup and why does it matter?",
    a: "Schema markup is structured data that helps search engines understand your content better. It can enable rich snippets in search results (like star ratings, prices, and FAQ dropdowns). The Schema page lets you add Product, Organization, FAQ, Breadcrumb, and Article schema to your store.",
  },
  {
    category: "Technical SEO",
    q: "What does the Sitemap & Robots page do?",
    a: "It helps you review your store's sitemap.xml and robots.txt configuration to make sure search engines can find and crawl all your important pages.",
  },
  {
    category: "Technical SEO",
    q: "What is the LLMs SEO feature?",
    a: "LLMs SEO generates a llms.txt file for your store — a structured text file that helps large language models (like ChatGPT, Perplexity, and others) better understand and reference your store's content. This is an emerging SEO practice for AI-powered search.",
  },

  // Links
  {
    category: "Links",
    q: "How does the Broken Links scanner work?",
    a: "It scans all your articles and pages for internal links that point to products or pages that no longer exist. You can then fix or remove these broken links to prevent 404 errors and improve user experience.",
  },
  {
    category: "Links",
    q: "What does Internal Linking do?",
    a: "The Internal Linking feature analyzes your content and suggests opportunities to link between related products, pages, and blog articles. Good internal linking helps search engines discover content and distributes page authority throughout your site.",
  },

  // Automations
  {
    category: "Automations",
    q: "How do automated scans work?",
    a: "You can schedule recurring SEO audits and broken link scans (daily, weekly, or monthly) from the Automations page. Jobs run automatically on schedule via a cron endpoint, and results are saved to your dashboard — so you always have fresh SEO data without manual effort.",
  },

  // Pricing & Plans
  {
    category: "Pricing & Plans",
    q: "What's included in the Free plan?",
    a: "The Free plan includes a basic daily SEO audit, 5 AI generations per day, 5 image compressions per day, read-only meta tag viewing, basic product schema, and broken link detection.",
  },
  {
    category: "Pricing & Plans",
    q: "What do I get with Pro ($8.99/mo)?",
    a: "Pro unlocks unlimited SEO audits, 100 AI generations per month, 50 image compressions, 5 AI blog posts, full meta tag editing, all schema types, internal link suggestions, the bulk editor, and weekly automated scans. It comes with a 7-day free trial.",
  },
  {
    category: "Pricing & Plans",
    q: "What does Premium ($14.99/mo) add?",
    a: "Premium includes everything in Pro, plus unlimited AI generations, unlimited image compressions, unlimited blog posts, custom AI prompt templates, daily automated scans, one-click SEO fixes, auto-redirect for broken links, and priority support.",
  },
  {
    category: "Pricing & Plans",
    q: "What is the Early Adopter program?",
    a: "We're offering Pro-level features for free to our first wave of users. If you installed during the early adopter period, you'll see an \"Early Adopter\" badge on your pricing page — enjoy Pro features at no cost while it lasts!",
  },
  {
    category: "Pricing & Plans",
    q: "Can I cancel or change my plan anytime?",
    a: "Yes. Shopify handles all billing. You can upgrade, downgrade, or cancel at any time from the Pricing page inside the app or through your Shopify admin.",
  },
];

function FaqAccordion({ item, open, onToggle }: { item: FaqItem; open: boolean; onToggle: () => void }) {
  return (
    <div
      style={{
        border: "1px solid var(--p-color-border-subdued)",
        borderRadius: 12,
        overflow: "hidden",
        transition: "box-shadow 0.2s",
        boxShadow: open ? "0 2px 8px rgba(0,0,0,0.06)" : "none",
      }}
    >
      <button
        onClick={onToggle}
        type="button"
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "14px 16px",
          background: open ? "var(--p-color-bg-surface-secondary)" : "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          gap: 12,
        }}
      >
        <Text as="span" variant="bodyMd" fontWeight="semibold">
          {item.q}
        </Text>
        <div style={{ flexShrink: 0 }}>
          <Icon source={open ? ChevronUpIcon : ChevronDownIcon} />
        </div>
      </button>
      <Collapsible open={open} id={`faq-${item.q}`}>
        <div style={{ padding: "0 16px 14px 16px" }}>
          <Text as="p" variant="bodySm" tone="subdued">
            {item.a}
          </Text>
        </div>
      </Collapsible>
    </div>
  );
}

export default function SupportPage() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("All");

  const toggleFaq = useCallback(
    (idx: number) => setOpenIndex((prev) => (prev === idx ? null : idx)),
    [],
  );

  const categories = ["All", ...Array.from(new Set(FAQ_DATA.map((f) => f.category)))];
  const filtered =
    activeCategory === "All"
      ? FAQ_DATA
      : FAQ_DATA.filter((f) => f.category === activeCategory);

  return (
    <Page>
      <TitleBar title="Support & FAQ" />
      <BlockStack gap="600">
        {/* Contact Card */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    Need help? We're here for you.
                  </Text>
                  <Text as="p" tone="subdued">
                    Whether you have a question about features, pricing, or need
                    technical assistance — our team is ready to help.
                  </Text>
                </BlockStack>

                <Divider />

                <InlineStack gap="400" wrap blockAlign="start">
                  {/* Email */}
                  <div
                    style={{
                      flex: "1 1 280px",
                      padding: 20,
                      borderRadius: 12,
                      background: "var(--p-color-bg-surface-secondary)",
                    }}
                  >
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingMd">
                        Email Support
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Send us an email and we'll respond within 24 hours (usually
                        much faster).
                      </Text>
                      <div>
                        <Link url={`mailto:${SUPPORT_EMAIL}`} monochrome>
                          <Text as="span" variant="bodyMd" fontWeight="bold">
                            {SUPPORT_EMAIL}
                          </Text>
                        </Link>
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <Button
                          url={`mailto:${SUPPORT_EMAIL}?subject=SEO%20Suite%20AI%20-%20Support%20Request`}
                          variant="primary"
                        >
                          Send us an Email
                        </Button>
                      </div>
                    </BlockStack>
                  </div>

                  {/* Tips */}
                  <div
                    style={{
                      flex: "1 1 280px",
                      padding: 20,
                      borderRadius: 12,
                      background: "var(--p-color-bg-surface-secondary)",
                    }}
                  >
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingMd">
                        Tips for a quick resolution
                      </Text>
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">
                          1. Include your store URL (e.g. yourstore.myshopify.com)
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          2. Describe the issue or question in detail
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          3. Attach a screenshot if you're seeing an error
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          4. Mention which page / feature you were using
                        </Text>
                      </BlockStack>
                    </BlockStack>
                  </div>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* FAQ */}
        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              <BlockStack gap="200">
                <Text as="h2" variant="headingLg">
                  Frequently Asked Questions
                </Text>
                <Text as="p" tone="subdued">
                  Quick answers to common questions about SEO Suite AI.
                </Text>
              </BlockStack>

              {/* Category filter */}
              <InlineStack gap="200" wrap>
                {categories.map((cat) => (
                  <Button
                    key={cat}
                    size="micro"
                    variant={activeCategory === cat ? "primary" : "secondary"}
                    onClick={() => {
                      setActiveCategory(cat);
                      setOpenIndex(null);
                    }}
                  >
                    {cat}
                  </Button>
                ))}
              </InlineStack>

              <BlockStack gap="200">
                {filtered.map((item, idx) => {
                  const globalIdx = FAQ_DATA.indexOf(item);
                  return (
                    <FaqAccordion
                      key={globalIdx}
                      item={item}
                      open={openIndex === globalIdx}
                      onToggle={() => toggleFaq(globalIdx)}
                    />
                  );
                })}
              </BlockStack>
            </BlockStack>
          </Layout.Section>
        </Layout>

        {/* Still need help? */}
        <Layout>
          <Layout.Section>
            <Card>
              <InlineStack align="space-between" blockAlign="center" wrap>
                <BlockStack gap="100">
                  <Text as="h3" variant="headingMd">
                    Still have questions?
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Don't hesitate to reach out — we love hearing from our users.
                  </Text>
                </BlockStack>
                <Button
                  url={`mailto:${SUPPORT_EMAIL}?subject=SEO%20Suite%20AI%20-%20Question`}
                  variant="primary"
                >
                  Contact Support
                </Button>
              </InlineStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Footer */}
        <Divider />
        <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
          <InlineStack align="center" gap="300">
            <Link url="/app/privacy-policy" removeUnderline>
              <Text as="span" variant="bodySm" tone="subdued">Privacy Policy</Text>
            </Link>
            <Text as="span" variant="bodySm" tone="subdued">·</Text>
            <Link url={`mailto:${SUPPORT_EMAIL}`} removeUnderline>
              <Text as="span" variant="bodySm" tone="subdued">{SUPPORT_EMAIL}</Text>
            </Link>
            <Text as="span" variant="bodySm" tone="subdued">·</Text>
            <Text as="span" variant="bodySm" tone="subdued">
              © {new Date().getFullYear()} Design Flow Digitals
            </Text>
          </InlineStack>
        </div>
      </BlockStack>
    </Page>
  );
}
