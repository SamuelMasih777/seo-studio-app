import { useState, useEffect } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate, useRevalidator } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Button,
  InlineStack,
  DataTable,
  Badge,
  ProgressBar,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

// We run the scan when the loader loads so it's always real-time
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
    query getStoreData {
      products(first: 50) {
        edges {
          node {
            id
            title
            seo { title, description }
            images(first: 5) { edges { node { altText } } }
          }
        }
      }
      pages(first: 50) {
        edges {
          node {
            id
            title
          }
        }
      }
    }`
  );

  const json = await response.json();
  const products = json.data.products.edges.map((e: any) => e.node);
  const pages = json.data.pages.edges.map((e: any) => e.node);

  const auditResults = [];

  // Evaluate Products
  products.forEach((product: any) => {
    let score = 100;
    const issues = [];
    
    if (!product.seo?.title) {
      score -= 20;
      issues.push("Missing custom SEO Title");
    }
    if (!product.seo?.description) {
      score -= 30;
      issues.push("Missing custom SEO Description");
    }
    
    let missingAlts = 0;
    product.images.edges.forEach((img: any) => {
      if (!img.node.altText) missingAlts++;
    });
    
    if (missingAlts > 0) {
      score -= (10 * missingAlts);
      issues.push(`${missingAlts} image(s) missing Alt Text`);
    }

    if (score < 0) score = 0;

    auditResults.push({
      page: `Product: ${product.title}`,
      score,
      issues: issues.length > 0 ? issues : ["None"],
      status: score >= 90 ? "success" : score >= 60 ? "warning" : "critical",
      actionLink: missingAlts > 0 ? "/app/image-optimization" : "/app/meta-tags",
    });
  });

  // Evaluate Pages (Pages don't have an 'seo' field in Shopify Admin API, they use 'metafield' or rely on theme defaults)
  pages.forEach((page: any) => {
    let score = 100;
    const issues = [];
    
    // As a placeholder for pages, we'll just check if the title is too long or short
    if (page.title.length < 5) {
      score -= 20;
      issues.push("Title is too short");
    }
    if (page.title.length > 60) {
      score -= 10;
      issues.push("Title is too long");
    }

    if (score < 0) score = 0;

    auditResults.push({
      page: `Page: ${page.title}`,
      score,
      issues: issues.length > 0 ? issues : ["None"],
      status: score >= 90 ? "success" : score >= 60 ? "warning" : "critical",
      actionLink: "/app/meta-tags",
    });
  });

  return { auditResults };
};

export default function SeoAuditPage() {
  const { auditResults } = useLoaderData<typeof loader>();
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  const averageScore = auditResults.length > 0 
    ? Math.round(auditResults.reduce((acc: number, curr: any) => acc + curr.score, 0) / auditResults.length)
    : 0;

  const [displayedScore, setDisplayedScore] = useState(averageScore);

  useEffect(() => {
    if (!isScanning) {
      setDisplayedScore(averageScore);
      setScanProgress(100);
    }
  }, [averageScore, isScanning]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isScanning) {
      interval = setInterval(() => {
        setScanProgress((prev) => {
          if (prev >= 100) {
            clearInterval(interval);
            setIsScanning(false);
            return 100;
          }
          return prev + 5;
        });
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isScanning]);

  useEffect(() => {
    if (isScanning) {
      // Animate score from 0 to averageScore based on progress
      setDisplayedScore(Math.round((scanProgress / 100) * averageScore));
    }
  }, [scanProgress, averageScore, isScanning]);

  const handleScan = () => {
    setIsScanning(true);
    setScanProgress(0);
    setDisplayedScore(0);
    revalidator.revalidate(); // Re-fetch the fresh data in the background
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "critical":
        return <Badge tone="critical">Critical</Badge>;
      case "warning":
        return <Badge tone="warning">Warning</Badge>;
      case "success":
        return <Badge tone="success">Good</Badge>;
      default:
        return <Badge>Unknown</Badge>;
    }
  };

  const rows = auditResults.map((result: any) => [
    result.page,
    <ProgressBar
      key={result.page}
      progress={result.score}
      color={result.score >= 90 ? "success" : result.score >= 60 ? "primary" : "critical"}
      size="small"
    />,
    <BlockStack gap="100" key={result.page + "-issues"}>
      {result.issues.map((issue: string, idx: number) => (
        <Text as="p" key={idx} tone={result.status === "success" ? "subdued" : "critical"}>
          • {issue}
        </Text>
      ))}
    </BlockStack>,
    getStatusBadge(result.status),
    <Button 
      size="micro" 
      onClick={() => navigate(result.actionLink)} 
      key={result.page + "-btn"} 
      disabled={result.status === "success"}
    >
      Fix Issues
    </Button>,
  ]);

  return (
    <Page>
      <TitleBar title="SEO Audit Dashboard" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="400" inlineAlign="start">
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingLg">
                      Store-wide SEO Audit
                    </Text>
                    <Text as="p" tone="subdued">
                      Live evaluation of your store's products and pages for missing meta tags, missing alt texts, and structure issues.
                    </Text>
                  </BlockStack>
                  <Button variant="primary" loading={isScanning} onClick={handleScan}>
                    Run Full Audit
                  </Button>
                </BlockStack>

                <BlockStack gap="200" inlineAlign="center">
                  <Text as="h3" variant="headingSm" tone="subdued">
                    {isScanning ? "Scanning..." : "Overall SEO Score"}
                  </Text>
                  <div style={{ position: 'relative', width: '120px', height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', border: `8px solid ${displayedScore >= 90 ? '#2e8e36' : displayedScore >= 60 ? '#e49f0a' : '#d82c0d'}` }}>
                      <Text as="h2" variant="heading3xl">
                        {displayedScore}
                      </Text>
                  </div>
                </BlockStack>
              </InlineStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="300" blockAlign="center">
                  <Text as="h3" variant="headingMd">
                    Live Scan Results
                  </Text>
                  <Badge tone={averageScore >= 90 ? "success" : averageScore >= 60 ? "warning" : "critical"}>
                    Average Store Score: {averageScore}/100
                  </Badge>
                </InlineStack>
              </InlineStack>

              <Card padding="0">
                <DataTable
                  columnContentTypes={[
                    "text",
                    "text",
                    "text",
                    "text",
                    "text",
                  ]}
                  headings={[
                    "Resource",
                    "SEO Score",
                    "Detected Issues",
                    "Status",
                    "Action",
                  ]}
                  rows={rows}
                />
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}