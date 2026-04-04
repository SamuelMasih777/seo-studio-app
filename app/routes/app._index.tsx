import { useState, useEffect } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useNavigate, useLoaderData, useRevalidator } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  InlineStack,
  Badge,
  ProgressBar,
  Grid,
  Icon,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { AlertCircleIcon, CheckCircleIcon, InfoIcon } from "@shopify/polaris-icons";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  
  const response = await admin.graphql(
    `#graphql
    query getDashboardData {
      products(first: 50) {
        edges {
          node {
            id
            title
            handle
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
            handle
            body
          }
        }
      }
      articles(first: 50) {
        edges {
          node {
            id
            title
            handle
            body
          }
        }
      }
    }`
  );

  const json = await response.json();
  const products = json.data.products.edges.map((e: any) => e.node);
  const pages = json.data.pages.edges.map((e: any) => e.node);
  const articles = json.data.articles.edges.map((e: any) => e.node);
  const productHandles = products.map((p: any) => p.handle);

  let totalScore = 0;
  let metaIssuesCount = 0;
  let missingAltCount = 0;
  let brokenLinksCount = 0;
  let duplicateContentCount = 0;

  const titles = new Set<string>();

  // Evaluate Products
  products.forEach((product: any) => {
    let score = 100;
    
    if (!product.seo?.title) {
      metaIssuesCount++;
      score -= 20;
    } else {
      if (titles.has(product.seo.title)) {
        duplicateContentCount++;
      }
      titles.add(product.seo.title);
    }

    if (!product.seo?.description) {
      metaIssuesCount++;
      score -= 30;
    }
    
    let missingAlts = 0;
    product.images.edges.forEach((img: any) => {
      if (!img.node.altText) missingAlts++;
    });
    
    if (missingAlts > 0) {
      score -= (10 * missingAlts);
      missingAltCount += missingAlts;
    }

    if (score < 0) score = 0;
    totalScore += score;
  });

  // Evaluate Pages
  pages.forEach((page: any) => {
    let score = 100;
    if (page.title.length < 5) score -= 20;
    if (page.title.length > 60) score -= 10;
    if (score < 0) score = 0;
    totalScore += score;
  });

  const averageScore = (products.length + pages.length) > 0 
    ? Math.round(totalScore / (products.length + pages.length))
    : 0;

  // Evaluate Broken Links
  const validateHtml = (html: string) => {
    if (!html) return;
    const regex = /<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1[^>]*>(.*?)<\/a>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const url = match[2];
      if (url.startsWith('/products/') || url.startsWith('https://yourstore.com/products/')) {
        const handle = url.split('/products/')[1].split('?')[0].replace(/\/$/, '');
        if (!productHandles.includes(handle)) {
          brokenLinksCount++;
        }
      }
    }
  };

  articles.forEach((a: any) => validateHtml(a.body));
  pages.forEach((p: any) => validateHtml(p.body));

  // Update Audit History in DB (Limit to 1 per day roughly, or just push a new one)
  // For simplicity, we'll create a new audit record for history. In a real app, you might want to throttle this.
  const latestAudit = await prisma.auditHistory.findFirst({
    where: { shop: session.shop },
    orderBy: { scannedAt: "desc" },
  });

  const shouldCreateNewAudit = !latestAudit || (new Date().getTime() - new Date(latestAudit.scannedAt).getTime() > 1000 * 60 * 60 * 24); // 24 hours

  if (shouldCreateNewAudit) {
    await prisma.auditHistory.create({
      data: {
        shop: session.shop,
        score: averageScore,
        metaIssuesCount,
        missingAltCount,
        brokenLinksCount,
        duplicateContentCount,
      },
    });
  }

  // Fetch historical analytics
  const history = await prisma.auditHistory.findMany({
    where: { shop: session.shop },
    orderBy: { scannedAt: "asc" },
    take: 7, // Last 7 audits
  });

  return {
    seoScore: averageScore,
    metaIssuesCount,
    missingAltCount,
    brokenLinksCount,
    duplicateContentCount,
    history,
  };
};

export default function Index() {
  const navigate = useNavigate();
  const { seoScore, metaIssuesCount, missingAltCount, brokenLinksCount, duplicateContentCount, history } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [displayedScore, setDisplayedScore] = useState(seoScore);

  useEffect(() => {
    if (!isScanning) {
      setDisplayedScore(seoScore);
      setScanProgress(100);
    }
  }, [seoScore, isScanning]);

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
      setDisplayedScore(Math.round((scanProgress / 100) * seoScore));
    }
  }, [scanProgress, seoScore, isScanning]);

  const handleScan = () => {
    setIsScanning(true);
    setScanProgress(0);
    setDisplayedScore(0);
    revalidator.revalidate();
  };

  const healthIndicators = [
    {
      title: "Meta Issues",
      count: metaIssuesCount,
      status: metaIssuesCount > 0 ? "critical" : "success",
      description: "Missing or duplicate titles/descriptions",
      action: "Fix Meta Tags",
      link: "/app/meta-tags",
    },
    {
      title: "Missing Alt Texts",
      count: missingAltCount,
      status: missingAltCount > 0 ? "warning" : "success",
      description: "Images without alt attributes",
      action: "Optimize Images",
      link: "/app/image-optimization",
    },
    {
      title: "Broken Links",
      count: brokenLinksCount,
      status: brokenLinksCount > 0 ? "critical" : "success",
      description: "404 errors found on site",
      action: "Fix Links",
      link: "/app/broken-links",
    },
    {
      title: "Duplicate Content",
      count: duplicateContentCount,
      status: duplicateContentCount > 0 ? "warning" : "success",
      description: duplicateContentCount > 0 ? "Duplicate titles detected" : "No duplicate content detected",
      action: "View Report",
      link: "/app/seo-audit",
    },
  ];

  const modules = [
    { name: "SEO Audit", status: "Active" },
    { name: "Meta Tags Manager", status: "Active" },
    { name: "Image Alt Text", status: "Active" },
    { name: "Image Compression", status: "Active" },
    { name: "AI Content", status: "Active" },
    { name: "LLMs SEO", status: "Active" },
    { name: "Schema Markup", status: "Active" },
    { name: "Internal Linking", status: "Active" },
    { name: "Broken Links", status: "Active" },
    { name: "Sitemap & Robots", status: "Active" },
    { name: "Bulk Editor", status: "Active" },
  ];

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

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "critical":
        return <Icon source={AlertCircleIcon} tone="critical" />;
      case "warning":
        return <Icon source={InfoIcon} tone="warning" />;
      case "success":
        return <Icon source={CheckCircleIcon} tone="success" />;
      default:
        return null;
    }
  };

  return (
    <Page fullWidth>
      <TitleBar title="SEO Suite Dashboard" />
      <BlockStack gap="500">
        <Layout>
          {/* Overall SEO Score */}
          <Layout.Section>
            <Grid>
              <Grid.Cell columnSpan={{xs: 6, sm: 6, md: 6, lg: 6, xl: 6}}>
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingLg">
                        Overall SEO Score
                      </Text>
                      <Text as="p" variant="headingXl" tone={displayedScore > 80 ? "success" : displayedScore > 50 ? "caution" : "critical"}>
                        {displayedScore}/100
                      </Text>
                    </InlineStack>
                    <ProgressBar progress={displayedScore} color={displayedScore > 80 ? "success" : displayedScore > 50 ? "primary" : "critical"} />
                    <Text as="p" tone="subdued">
                      {displayedScore >= 90 ? "Your store's SEO score is excellent. Keep up the good work!" : 
                       displayedScore >= 60 ? "Your store's SEO score is fair. Fixing critical issues will improve your ranking." : 
                       "Your store's SEO score needs attention. Please address the critical issues below."}
                    </Text>
                    <InlineStack>
                      <Button variant="primary" loading={isScanning} onClick={handleScan}>
                        Run Full Audit
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              </Grid.Cell>
              <Grid.Cell columnSpan={{xs: 6, sm: 6, md: 6, lg: 6, xl: 6}}>
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingLg">
                      Historical Analytics
                    </Text>
                    <Text as="p" tone="subdued">
                      Your SEO progress over the last 7 audits.
                    </Text>
                    <div style={{ display: 'flex', alignItems: 'flex-end', height: '100px', gap: '8px', paddingTop: '10px' }}>
                      {history && history.length > 0 ? history.map((audit: any, index: number) => (
                        <div key={index} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                          <div style={{ 
                            width: '100%', 
                            height: `${Math.max(10, audit.score)}%`, 
                            backgroundColor: audit.score >= 80 ? '#2e8e36' : audit.score >= 50 ? '#e49f0a' : '#d82c0d',
                            borderRadius: '4px 4px 0 0',
                            transition: 'height 0.5s ease-out'
                          }}></div>
                          <Text as="span" variant="bodySm" tone="subdued" alignment="center">
                            {new Date(audit.scannedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </Text>
                        </div>
                      )) : (
                        <div style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                          <Text as="p" tone="subdued">No history available yet. Run an audit to start tracking.</Text>
                        </div>
                      )}
                    </div>
                  </BlockStack>
                </Card>
              </Grid.Cell>
            </Grid>
          </Layout.Section>

          {/* Health Indicators */}
          <Layout.Section>
            <Text as="h3" variant="headingMd">
              Health Indicators
            </Text>
            <div style={{ marginTop: '16px' }}>
              <Grid>
                {healthIndicators.map((item, index) => (
                  <Grid.Cell key={index} columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
                    <Card>
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="start">
                          <Text as="h4" variant="headingSm">
                            {item.title}
                          </Text>
                          {getStatusIcon(item.status)}
                        </InlineStack>
                        
                        <InlineStack align="start" blockAlign="center" gap="200">
                          <Text as="p" variant="headingLg">
                            {item.count}
                          </Text>
                          {getStatusBadge(item.status)}
                        </InlineStack>

                        <Text as="p" tone="subdued">
                          {item.description}
                        </Text>
                        
                        <Button 
                          onClick={() => navigate(item.link)} 
                          disabled={item.status === "success"}
                        >
                          {item.action}
                        </Button>
                      </BlockStack>
                    </Card>
                  </Grid.Cell>
                ))}
              </Grid>
            </div>
          </Layout.Section>

          {/* Module Status Overview */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">
                  Module Status
                </Text>
                <Grid>
                  {modules.map((mod, index) => (
                    <Grid.Cell key={index} columnSpan={{ xs: 6, sm: 4, md: 4, lg: 4, xl: 4 }}>
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="p" fontWeight="bold">{mod.name}</Text>
                        <Badge tone={mod.status === "Active" ? "success" : "new"}>
                          {mod.status}
                        </Badge>
                      </InlineStack>
                    </Grid.Cell>
                  ))}
                </Grid>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
