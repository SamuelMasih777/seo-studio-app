import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useNavigate,
  useLoaderData,
  useRevalidator,
  useFetcher,
} from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  InlineStack,
  Badge,
  Grid,
  Icon,
  Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  fetchShopDisplayName,
  getEmptyDashboardPayload,
  parseDashboardPayload,
  runFullDashboardScan,
} from "../seo-dashboard-scan.server";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  InfoIcon,
  RefreshIcon,
  SearchIcon,
} from "@shopify/polaris-icons";

const GAUGE_CX = 100;
const GAUGE_CY = 100;
const GAUGE_R = 78;

function polarOnGauge(r: number, angleRad: number) {
  return {
    x: GAUGE_CX + r * Math.cos(angleRad),
    y: GAUGE_CY - r * Math.sin(angleRad),
  };
}

function gaugeArcD(r: number, startAngle: number, endAngle: number): string {
  const s = polarOnGauge(r, startAngle);
  const e = polarOnGauge(r, endAngle);
  return `M ${s.x} ${s.y} A ${r} ${r} 0 0 1 ${e.x} ${e.y}`;
}

function healthScoreFill(health: "Low" | "Medium" | "High"): string {
  if (health === "Low") return "var(--p-color-text-critical)";
  if (health === "Medium") return "var(--p-color-text-warning)";
  return "var(--p-color-text-success)";
}

/** Semi-circular meter: 0 = left, 100 = right. */
function SeoScoreMeter({
  score,
  healthLabel,
}: {
  score: number;
  healthLabel: "Low" | "Medium" | "High";
}) {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const needleAngle = Math.PI * (1 - s / 100);
  const tip = polarOnGauge(62, needleAngle);
  const hubR = 5;
  const r = GAUGE_R - 4;

  const red = "var(--p-color-bg-fill-critical)";
  const orange = "var(--p-color-bg-fill-warning)";
  const green = "var(--p-color-bg-fill-success)";
  const track = "var(--p-color-border-secondary)";
  const scoreFill = healthScoreFill(healthLabel);

  return (
    <svg
      width="100%"
      height={120}
      viewBox="0 0 200 118"
      style={{ maxWidth: 280, display: "block", margin: "0 auto" }}
      role="img"
      aria-label={`SEO score ${s} out of 100`}
    >
      <path
        d={gaugeArcD(r, Math.PI, 0)}
        fill="none"
        stroke={track}
        strokeWidth={10}
        strokeLinecap="round"
      />
      <path
        d={gaugeArcD(r, Math.PI, (2 * Math.PI) / 3)}
        fill="none"
        stroke={red}
        strokeWidth={8}
        strokeLinecap="butt"
      />
      <path
        d={gaugeArcD(r, (2 * Math.PI) / 3, Math.PI / 3)}
        fill="none"
        stroke={orange}
        strokeWidth={8}
        strokeLinecap="butt"
      />
      <path
        d={gaugeArcD(r, Math.PI / 3, 0)}
        fill="none"
        stroke={green}
        strokeWidth={8}
        strokeLinecap="butt"
      />
      <line
        x1={GAUGE_CX}
        y1={GAUGE_CY}
        x2={tip.x}
        y2={tip.y}
        stroke="var(--p-color-text)"
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      <circle
        cx={GAUGE_CX}
        cy={GAUGE_CY}
        r={hubR}
        fill="var(--p-color-bg-surface)"
        stroke="var(--p-color-border)"
        strokeWidth={1.5}
      />
      <text
        x={GAUGE_CX}
        y={58}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={scoreFill}
        style={{
          fontSize: 32,
          fontWeight: 600,
          fontFamily: "var(--p-font-family-sans)",
        }}
      >
        {s}
      </text>
      <text
        x={GAUGE_CX}
        y={78}
        textAnchor="middle"
        fill="var(--p-color-text-secondary)"
        style={{
          fontSize: 12,
          fontFamily: "var(--p-font-family-sans)",
        }}
      >
        / 100
      </text>
    </svg>
  );
}

const AUDIT_STATUS_MESSAGES = [
  "We're working on your audit…",
  "Calculating your SEO score…",
  "Gathering storefront issues…",
  "Reading theme templates and live pages…",
] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const [snapshot, history, shopName] = await Promise.all([
    prisma.dashboardSeoSnapshot.findUnique({
      where: { shop: session.shop },
    }),
    prisma.auditHistory.findMany({
      where: { shop: session.shop },
      orderBy: { scannedAt: "asc" },
      take: 7,
    }),
    fetchShopDisplayName(admin),
  ]);

  const base =
    snapshot?.payload != null
      ? parseDashboardPayload(snapshot.payload)
      : getEmptyDashboardPayload();

  const shopDisplayName =
    shopName ||
    session.shop.replace(/\.myshopify\.com$/i, "").replace(/[-_]/g, " ");

  return {
    hasCachedScan: !!snapshot,
    scannedAt: snapshot?.scannedAt?.toISOString() ?? null,
    shopDisplayName,
    history,
    ...base,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const fd = await request.formData();
  if (fd.get("intent") !== "run_audit") {
    return json({ ok: false as const, error: "Invalid intent" });
  }

  try {
    const payload = await runFullDashboardScan(admin);
    await prisma.dashboardSeoSnapshot.upsert({
      where: { shop: session.shop },
      create: {
        shop: session.shop,
        payload: JSON.parse(JSON.stringify(payload)),
      },
      update: {
        payload: JSON.parse(JSON.stringify(payload)),
      },
    });

    await prisma.auditHistory.create({
      data: {
        shop: session.shop,
        score: payload.seoScore,
        metaIssuesCount: payload.metaIssuesCount,
        missingAltCount: payload.missingAltCount,
        brokenLinksCount: payload.brokenLinksCount,
        duplicateContentCount: payload.duplicateContentCount,
      },
    });

    return json({ ok: true as const });
  } catch (e) {
    return json({
      ok: false as const,
      error: e instanceof Error ? e.message : "Audit failed",
    });
  }
};

export default function Index() {
  const navigate = useNavigate();
  const {
    hasCachedScan,
    scannedAt,
    shopDisplayName,
    seoScore,
    healthLabel,
    metaIssuesCount,
    missingAltCount,
    brokenLinksCount,
    duplicateContentCount,
    totalIssueSignals,
    history,
    scanSummary,
    pagesScanned,
    criticalIssue,
    needImprovement,
    goodResult,
    themeIssuesCount,
  } = useLoaderData<typeof loader>();

  const revalidator = useRevalidator();
  const fetcher = useFetcher<typeof action>();

  const isAuditing = fetcher.state !== "idle";
  const [statusIdx, setStatusIdx] = useState(0);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok === true) {
      revalidator.revalidate();
    }
  }, [fetcher.state, fetcher.data, revalidator]);

  useEffect(() => {
    if (!isAuditing) {
      setStatusIdx(0);
      return;
    }
    const t = setInterval(() => {
      setStatusIdx((i) => (i + 1) % AUDIT_STATUS_MESSAGES.length);
    }, 2200);
    return () => clearInterval(t);
  }, [isAuditing]);

  const auditError =
    fetcher.state === "idle" && fetcher.data && !fetcher.data.ok
      ? fetcher.data.error
      : null;

  const lastScanLabel = useMemo(() => {
    if (!scannedAt) return "No scan yet — run an audit to see live data.";
    try {
      return new Date(scannedAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch {
      return scannedAt;
    }
  }, [scannedAt]);

  const healthToneForLabel =
    healthLabel === "Low"
      ? "critical"
      : healthLabel === "Medium"
        ? "warning"
        : "success";

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
      description:
        duplicateContentCount > 0
          ? "Duplicate titles detected"
          : "No duplicate content detected",
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

  function metricCard(icon: ReactNode, title: string, value: number) {
    return (
      <Card padding="400">
        <BlockStack gap="200">
          <InlineStack gap="100" blockAlign="center" wrap={false}>
            <span style={{ display: "flex", flexShrink: 0 }}>{icon}</span>
            <Text as="span" variant="bodySm" fontWeight="semibold">
              {title}
            </Text>
          </InlineStack>
          <Text as="p" variant="headingXl">
            {value.toLocaleString()}
          </Text>
        </BlockStack>
      </Card>
    );
  }

  return (
    <Page fullWidth>
      <TitleBar title="SEO Suite Dashboard" />
      <BlockStack gap="500">
        {isAuditing ? (
          <Banner tone="info">
            <Text as="p" variant="bodyMd">
              {AUDIT_STATUS_MESSAGES[statusIdx]}
            </Text>
          </Banner>
        ) : null}
        {auditError ? (
          <Banner tone="critical">
            <Text as="p" variant="bodyMd">
              {auditError}
            </Text>
          </Banner>
        ) : null}

        <Layout>
          <Layout.Section>
            <Card padding="500">
              <Grid>
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                  <BlockStack gap="400">
                    <SeoScoreMeter
                      score={hasCachedScan ? seoScore : 0}
                      healthLabel={hasCachedScan ? healthLabel : "Low"}
                    />
                    <Text as="p" variant="bodyMd" alignment="center">
                      SEO Health Score:{" "}
                      <Text as="span" tone={healthToneForLabel} fontWeight="bold">
                        {hasCachedScan ? healthLabel : "—"}
                      </Text>
                    </Text>
                    <InlineStack gap="200" wrap>
                      {hasCachedScan ? (
                        <>
                          <Button
                            variant="primary"
                            onClick={() => navigate("/app/meta-tags")}
                          >
                            One-Click Fix
                          </Button>
                          <fetcher.Form method="post">
                            <input
                              type="hidden"
                              name="intent"
                              value="run_audit"
                            />
                            <Button
                              submit
                              variant="secondary"
                              icon={RefreshIcon}
                              loading={isAuditing}
                            >
                              Rescan
                            </Button>
                          </fetcher.Form>
                        </>
                      ) : (
                        <>
                          <fetcher.Form method="post">
                            <input
                              type="hidden"
                              name="intent"
                              value="run_audit"
                            />
                            <Button
                              submit
                              variant="primary"
                              icon={RefreshIcon}
                              loading={isAuditing}
                            >
                              Run full audit
                            </Button>
                          </fetcher.Form>
                          <Button
                            variant="secondary"
                            onClick={() => navigate("/app/meta-tags")}
                          >
                            One-Click Fix
                          </Button>
                        </>
                      )}
                    </InlineStack>
                  </BlockStack>
                </Grid.Cell>

                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 8, lg: 8, xl: 8 }}>
                  <BlockStack gap="400">
                    <Text as="p" variant="headingLg">
                      Hi, {shopDisplayName} 👋
                    </Text>
                    <Text as="p" variant="bodyLg">
                      {hasCachedScan ? (
                        <>
                          We found{" "}
                          <Text as="span" tone="critical" fontWeight="bold">
                            {totalIssueSignals.toLocaleString()}
                          </Text>{" "}
                          SEO issue
                          {totalIssueSignals === 1 ? "" : "s"} affecting your
                          store (catalog + live pages + theme files).
                        </>
                      ) : (
                        <>
                          Run a full audit to score SEO health across your
                          catalog, key storefront URLs, and main theme templates.
                        </>
                      )}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Last scan time: {lastScanLabel}
                    </Text>

                    <Grid>
                      <Grid.Cell
                        columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}
                      >
                        {metricCard(
                          <Icon source={SearchIcon} tone="subdued" />,
                          "Pages scanned",
                          hasCachedScan ? pagesScanned : 0,
                        )}
                      </Grid.Cell>
                      <Grid.Cell
                        columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}
                      >
                        {metricCard(
                          <Icon source={AlertCircleIcon} tone="critical" />,
                          "Critical issues",
                          hasCachedScan ? criticalIssue : 0,
                        )}
                      </Grid.Cell>
                      <Grid.Cell
                        columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}
                      >
                        {metricCard(
                          <Icon source={InfoIcon} tone="warning" />,
                          "Need improvement",
                          hasCachedScan ? needImprovement : 0,
                        )}
                      </Grid.Cell>
                      <Grid.Cell
                        columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}
                      >
                        {metricCard(
                          <Icon source={CheckCircleIcon} tone="success" />,
                          "Good results",
                          hasCachedScan ? goodResult : 0,
                        )}
                      </Grid.Cell>
                    </Grid>

                    <Text as="p" variant="bodySm" tone="subdued">
                      {hasCachedScan
                        ? `${scanSummary.productCount.toLocaleString()} products (${scanSummary.productImageCount.toLocaleString()} images), ${scanSummary.pageCount} pages, ${scanSummary.articleCount} articles (Admin API). Live URLs fetched: ${scanSummary.liveUrlsOk}/${scanSummary.liveUrls.length}. Theme ${scanSummary.themeName ? `"${scanSummary.themeName}"` : ""}: ${scanSummary.themeScanOk ? `${scanSummary.themeFilesRead} SEO-related file(s)` : scanSummary.themeScanError || "unavailable"}.`
                        : "Cached results load instantly; use Rescan after you publish theme or content changes."}
                    </Text>
                  </BlockStack>
                </Grid.Cell>
              </Grid>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Grid>
              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingLg">
                      Historical Analytics
                    </Text>
                    <Text as="p" tone="subdued">
                      Your SEO progress over the last 7 audits.
                    </Text>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-end",
                        height: "100px",
                        gap: "8px",
                        paddingTop: "10px",
                      }}
                    >
                      {history && history.length > 0 ? (
                        history.map((audit: { score: number; scannedAt: string }, index: number) => (
                          <div
                            key={index}
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              flex: 1,
                            }}
                          >
                            <div
                              style={{
                                width: "100%",
                                height: `${Math.max(10, audit.score)}%`,
                                backgroundColor:
                                  audit.score >= 80
                                    ? "#2e8e36"
                                    : audit.score >= 50
                                      ? "#e49f0a"
                                      : "#d82c0d",
                                borderRadius: "4px 4px 0 0",
                                transition: "height 0.5s ease-out",
                              }}
                            />
                            <Text
                              as="span"
                              variant="bodySm"
                              tone="subdued"
                              alignment="center"
                            >
                              {new Date(audit.scannedAt).toLocaleDateString(
                                undefined,
                                { month: "short", day: "numeric" },
                              )}
                            </Text>
                          </div>
                        ))
                      ) : (
                        <div
                          style={{
                            width: "100%",
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "center",
                            height: "100%",
                          }}
                        >
                          <Text as="p" tone="subdued">
                            No history yet. Run an audit to start tracking.
                          </Text>
                        </div>
                      )}
                    </div>
                  </BlockStack>
                </Card>
              </Grid.Cell>
              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                <Card>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">
                      Theme & live checks
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Viewport and lazy-loading hints are sampled from your main
                      theme JSON/Liquid. Live fetches cover home, products,
                      collections, FAQ/about-style pages, and blog URLs when
                      present.
                    </Text>
                    {!hasCachedScan ? (
                      <Text as="p" variant="bodySm" tone="subdued">
                        Run an audit to evaluate viewport and lazy-loading hints
                        from your main theme.
                      </Text>
                    ) : themeIssuesCount > 0 ? (
                      <Text as="p" variant="bodySm" tone="critical">
                        Theme: missing viewport meta in sampled files — fix in{" "}
                        <Text
                          as="span"
                          variant="bodySm"
                          fontWeight="semibold"
                        >
                          theme.liquid
                        </Text>{" "}
                        or theme settings.
                      </Text>
                    ) : (
                      <Text as="p" variant="bodySm" tone="success">
                        No viewport warning from the sampled theme files.
                      </Text>
                    )}
                  </BlockStack>
                </Card>
              </Grid.Cell>
            </Grid>
          </Layout.Section>

          <Layout.Section>
            <Text as="h3" variant="headingMd">
              Health Indicators
            </Text>
            <div style={{ marginTop: "16px" }}>
              <Grid>
                {healthIndicators.map((item, index) => (
                  <Grid.Cell
                    key={index}
                    columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}
                  >
                    <Card>
                      <BlockStack gap="300">
                        <InlineStack gap="200" blockAlign="center" wrap={false}>
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

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">
                  Module Status
                </Text>
                <Grid>
                  {modules.map((mod, index) => (
                    <Grid.Cell
                      key={index}
                      columnSpan={{ xs: 6, sm: 4, md: 4, lg: 4, xl: 4 }}
                    >
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="p" fontWeight="bold">
                          {mod.name}
                        </Text>
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
