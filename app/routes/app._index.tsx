import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
  Tabs,
  Collapsible,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  fetchShopDisplayName,
  getEmptyDashboardPayload,
  parseDashboardPayload,
  runFullDashboardScan,
  type IssueDetail,
} from "../seo-dashboard-scan.server";
import { resolveShopPlan } from "../plan-gate.server";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  InfoIcon,
  RefreshIcon,
  SearchIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  AlertTriangleIcon,
  ImageIcon,
  LinkIcon,
  ContentIcon,
  CodeIcon,
} from "@shopify/polaris-icons";

/* ──────────────────────── Gradient-fill arc meter ──────────────────────── */

const ARC_CX = 120;
const ARC_CY = 110;
const ARC_R = 90;
const ARC_STROKE = 16;

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const x1 = cx + r * Math.cos(toRad(startDeg));
  const y1 = cy + r * Math.sin(toRad(startDeg));
  const x2 = cx + r * Math.cos(toRad(endDeg));
  const y2 = cy + r * Math.sin(toRad(endDeg));
  const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
}

function scoreColor(score: number): string {
  if (score < 40) return "#d82c0d";
  if (score < 70) return "#e49f0a";
  return "#2e8e36";
}

function healthLabelColor(label: string): string {
  if (label === "Low") return "var(--p-color-text-critical)";
  if (label === "Medium") return "var(--p-color-text-warning)";
  return "var(--p-color-text-success)";
}

function SeoScoreMeter({
  score,
  healthLabel,
  animate,
}: {
  score: number;
  healthLabel: "Low" | "Medium" | "High";
  animate?: boolean;
}) {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const arcLength = Math.PI * ARC_R;
  const fillLength = (s / 100) * arcLength;
  const dashOffset = arcLength - fillLength;
  const color = scoreColor(s);

  return (
    <div style={{ textAlign: "center" }}>
      <svg
        width="240"
        height="140"
        viewBox="0 0 240 140"
        style={{ display: "block", margin: "0 auto" }}
        role="img"
        aria-label={`SEO score ${s} out of 100`}
      >
        {/* Track */}
        <path
          d={describeArc(ARC_CX, ARC_CY, ARC_R, 180, 360)}
          fill="none"
          stroke="var(--p-color-border-secondary)"
          strokeWidth={ARC_STROKE}
          strokeLinecap="round"
        />
        {/* Fill */}
        <path
          d={describeArc(ARC_CX, ARC_CY, ARC_R, 180, 360)}
          fill="none"
          stroke={color}
          strokeWidth={ARC_STROKE}
          strokeLinecap="round"
          strokeDasharray={`${arcLength}`}
          strokeDashoffset={dashOffset}
          style={{
            transition: animate ? "stroke-dashoffset 1.2s ease-out, stroke 0.6s ease" : "none",
          }}
        />
        {/* Score */}
        <text
          x={ARC_CX}
          y={ARC_CY - 18}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={color}
          style={{ fontSize: 48, fontWeight: 700, fontFamily: "var(--p-font-family-sans)" }}
        >
          {s}
        </text>
        {/* / 100 */}
        <text
          x={ARC_CX}
          y={ARC_CY + 12}
          textAnchor="middle"
          fill="var(--p-color-text-secondary)"
          style={{ fontSize: 13, fontFamily: "var(--p-font-family-sans)" }}
        >
          / 100
        </text>
      </svg>
      <Text as="p" variant="bodyMd" alignment="center">
        SEO Health Score:{" "}
        <span style={{ color: healthLabelColor(healthLabel), fontWeight: 700 }}>
          {healthLabel}
        </span>
      </Text>
    </div>
  );
}

/* ──────────────────────── Status messages during audit ──────────────────────── */

const AUDIT_STATUS_MESSAGES = [
  "We're working on your audit…",
  "Scanning products and pages…",
  "Calculating your SEO score…",
  "Gathering storefront issues…",
  "Reading theme templates…",
] as const;

/* ──────────────────────── Collapsible issue row ──────────────────────── */

function severityDot(severity: string): string {
  if (severity === "critical") return "#d82c0d";
  if (severity === "warning") return "#e49f0a";
  return "#2e8e36";
}

function IssueRow({ issue }: { issue: IssueDetail }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  return (
    <div style={{ borderBottom: "1px solid var(--p-color-border-secondary)" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          padding: "12px 0",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          gap: "12px",
        }}
        type="button"
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            backgroundColor: severityDot(issue.severity),
            flexShrink: 0,
          }}
        />
        <span style={{ flex: 1 }}>
          <Text as="span" variant="bodySm" fontWeight="semibold">
            {issue.category}
          </Text>
          {"  "}
          <Text as="span" variant="bodySm">
            {issue.title}
          </Text>
        </span>
        <Text as="span" variant="bodySm" tone="subdued">
          {issue.count}
        </Text>
        <span style={{ display: "flex" }}>
          <Icon source={open ? ChevronUpIcon : ChevronDownIcon} tone="subdued" />
        </span>
      </button>
      <Collapsible open={open} id={`issue-${issue.title}`}>
        <div style={{ padding: "0 0 12px 22px" }}>
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" tone="subdued">
              {issue.description}
            </Text>
            {issue.link && (
              <Button size="slim" onClick={() => navigate(issue.link!)}>
                Fix this
              </Button>
            )}
          </BlockStack>
        </div>
      </Collapsible>
    </div>
  );
}

/* ──────────────────────── Loader & Action ──────────────────────── */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);

  const billingCheck = await billing.check();
  const resolved = await resolveShopPlan(session.shop, billingCheck);

  const [snapshot, history, shopName] = await Promise.all([
    prisma.dashboardSeoSnapshot.findUnique({ where: { shop: session.shop } }),
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

  return json({
    hasCachedScan: !!snapshot,
    scannedAt: snapshot?.scannedAt?.toISOString() ?? null,
    shopDisplayName,
    history,
    plan: resolved.plan,
    isEarlyAdopter: resolved.isEarlyAdopter,
    earlyAdopterSlotsLeft: resolved.earlyAdopterSlotsLeft,
    ...base,
  });
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
      create: { shop: session.shop, payload: JSON.parse(JSON.stringify(payload)) },
      update: { payload: JSON.parse(JSON.stringify(payload)) },
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

/* ──────────────────────── Page component ──────────────────────── */

export default function Index() {
  const navigate = useNavigate();
  const data = useLoaderData<typeof loader>();
  const {
    hasCachedScan,
    scannedAt,
    shopDisplayName,
    seoScore,
    healthLabel,
    totalIssueSignals,
    metaIssuesCount,
    missingAltCount,
    brokenLinksCount,
    duplicateContentCount,
    themeIssuesCount,
    history,
    scanSummary,
    pagesScanned,
    criticalIssue,
    needImprovement,
    goodResult,
    issues,
    isEarlyAdopter,
    earlyAdopterSlotsLeft,
  } = data;

  const revalidator = useRevalidator();
  const fetcher = useFetcher<typeof action>();
  const isAuditing = fetcher.state !== "idle";
  const [statusIdx, setStatusIdx] = useState(0);
  const [selectedTab, setSelectedTab] = useState(0);
  const [animateMeter, setAnimateMeter] = useState(false);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok === true) {
      revalidator.revalidate();
      setAnimateMeter(true);
    }
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    const t = setTimeout(() => setAnimateMeter(true), 200);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!isAuditing) { setStatusIdx(0); return; }
    const t = setInterval(() => {
      setStatusIdx((i) => (i + 1) % AUDIT_STATUS_MESSAGES.length);
    }, 2200);
    return () => clearInterval(t);
  }, [isAuditing]);

  const auditError =
    fetcher.state === "idle" && fetcher.data && !fetcher.data.ok
      ? (fetcher.data as { ok: false; error?: string }).error
      : null;

  const lastScanLabel = useMemo(() => {
    if (!scannedAt) return "No scan yet — run an audit to see live data.";
    try {
      return new Date(scannedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    } catch { return scannedAt; }
  }, [scannedAt]);

  const issuesList: IssueDetail[] = (issues ?? []) as IssueDetail[];
  const criticalIssues = issuesList.filter((i) => i.severity === "critical");
  const warningIssues = issuesList.filter((i) => i.severity === "warning");
  const goodIssues = issuesList.filter((i) => i.severity === "good");

  const tabs = [
    { id: "critical", content: `Critical Issue ${criticalIssue}`, badge: String(criticalIssue) },
    { id: "need", content: `Need Improvement ${needImprovement}`, badge: String(needImprovement) },
    { id: "good", content: `Good Result ${goodResult}`, badge: String(goodResult) },
  ];

  const activeIssueSet = selectedTab === 0 ? criticalIssues : selectedTab === 1 ? warningIssues : goodIssues;

  function metricCard(icon: ReactNode, title: string, value: number) {
    return (
      <Card padding="400">
        <BlockStack gap="200">
          <InlineStack gap="100" blockAlign="center" wrap={false}>
            <span style={{ display: "flex", flexShrink: 0 }}>{icon}</span>
            <Text as="span" variant="bodySm" fontWeight="semibold">{title}</Text>
          </InlineStack>
          <Text as="p" variant="headingXl">{value.toLocaleString()}</Text>
        </BlockStack>
      </Card>
    );
  }

  return (
    <Page fullWidth>
      <TitleBar title="SEO Suite Dashboard" />
      <BlockStack gap="500">
        {isEarlyAdopter && (
          <Banner tone="success">
            <Text as="p" variant="bodyMd">
              Welcome, early adopter! You have free access to all Pro features.
              {earlyAdopterSlotsLeft != null && earlyAdopterSlotsLeft > 0
                ? ` Only ${earlyAdopterSlotsLeft} early adopter spots remaining — invite your friends!`
                : ""}
            </Text>
          </Banner>
        )}

        {isAuditing && (
          <Banner tone="info">
            <Text as="p" variant="bodyMd">{AUDIT_STATUS_MESSAGES[statusIdx]}</Text>
          </Banner>
        )}
        {auditError && (
          <Banner tone="critical">
            <Text as="p" variant="bodyMd">{auditError}</Text>
          </Banner>
        )}

        {/* ── Hero card ── */}
        <Layout>
          <Layout.Section>
            <Card padding="500">
              <Grid>
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                  <BlockStack gap="400">
                    <SeoScoreMeter
                      score={hasCachedScan ? seoScore : 0}
                      healthLabel={hasCachedScan ? healthLabel : "Low"}
                      animate={animateMeter}
                    />
                    <InlineStack gap="200" wrap align="center">
                      {hasCachedScan ? (
                        <>
                          <Button variant="primary" onClick={() => navigate("/app/meta-tags")}>
                            One-Click Fix
                          </Button>
                          <fetcher.Form method="post">
                            <input type="hidden" name="intent" value="run_audit" />
                            <Button submit variant="secondary" icon={RefreshIcon} loading={isAuditing}>
                              Rescan
                            </Button>
                          </fetcher.Form>
                        </>
                      ) : (
                        <fetcher.Form method="post">
                          <input type="hidden" name="intent" value="run_audit" />
                          <Button submit variant="primary" icon={RefreshIcon} loading={isAuditing}>
                            Run full audit
                          </Button>
                        </fetcher.Form>
                      )}
                    </InlineStack>
                  </BlockStack>
                </Grid.Cell>

                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                  <BlockStack gap="400">
                    <Text as="p" variant="headingLg">Hi, {shopDisplayName} 👋</Text>
                    <Text as="p" variant="bodyLg">
                      {hasCachedScan ? (
                        <>
                          We found{" "}
                          <Text as="span" tone="critical" fontWeight="bold">
                            {totalIssueSignals.toLocaleString()}
                          </Text>{" "}
                          SEO issues affecting your website rankings.
                        </>
                      ) : (
                        <>Run a full audit to score SEO health across your catalog, key storefront URLs, and main theme templates.</>
                      )}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Last scan time: {lastScanLabel}
                    </Text>

                    <Grid>
                      <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                        {metricCard(<Icon source={SearchIcon} tone="subdued" />, "Pages scanned", hasCachedScan ? pagesScanned : 0)}
                      </Grid.Cell>
                      <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                        {metricCard(<Icon source={AlertCircleIcon} tone="critical" />, "Critical issues", hasCachedScan ? criticalIssue : 0)}
                      </Grid.Cell>
                      <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                        {metricCard(<Icon source={InfoIcon} tone="warning" />, "Need improvement", hasCachedScan ? needImprovement : 0)}
                      </Grid.Cell>
                      <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                        {metricCard(<Icon source={CheckCircleIcon} tone="success" />, "Good results", hasCachedScan ? goodResult : 0)}
                      </Grid.Cell>
                    </Grid>
                  </BlockStack>
                </Grid.Cell>
              </Grid>
            </Card>
          </Layout.Section>

          {/* ── Health indicator detail cards ── */}
          {hasCachedScan && (
            <Layout.Section>
              <Grid>
                <Grid.Cell columnSpan={{ xs: 6, sm: 4, md: 4, lg: 4, xl: 4 }}>
                  {metricCard(<Icon source={AlertTriangleIcon} tone="warning" />, "Meta issues", metaIssuesCount)}
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 4, md: 4, lg: 4, xl: 4 }}>
                  {metricCard(<Icon source={ImageIcon} tone="warning" />, "Missing alt text", missingAltCount)}
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 4, md: 4, lg: 4, xl: 4 }}>
                  {metricCard(<Icon source={LinkIcon} tone="critical" />, "Broken links", brokenLinksCount)}
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 4, md: 4, lg: 4, xl: 4 }}>
                  {metricCard(<Icon source={ContentIcon} tone="warning" />, "Duplicate content", duplicateContentCount)}
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 4, md: 4, lg: 4, xl: 4 }}>
                  {metricCard(<Icon source={CodeIcon} tone="subdued" />, "Theme issues", themeIssuesCount)}
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 4, md: 4, lg: 4, xl: 4 }}>
                  {metricCard(<Icon source={SearchIcon} tone="info" />, "Total issues", totalIssueSignals)}
                </Grid.Cell>
              </Grid>
            </Layout.Section>
          )}

          {/* ── Tabbed issue accordion ── */}
          {hasCachedScan && issuesList.length > 0 && (
            <Layout.Section>
              <Card>
                <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
                  <div style={{ padding: "16px 0" }}>
                    {activeIssueSet.length === 0 ? (
                      <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                        No issues in this category.
                      </Text>
                    ) : (
                      activeIssueSet.map((issue, i) => <IssueRow key={i} issue={issue} />)
                    )}
                  </div>
                </Tabs>
              </Card>
            </Layout.Section>
          )}

          {/* ── Historical analytics + Scan details ── */}
          <Layout.Section>
            <Grid>
              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingLg">Historical Analytics</Text>
                    <Text as="p" tone="subdued">Your SEO progress over the last 7 audits.</Text>
                    <div style={{ position: "relative", height: 160 }}>
                      {history && history.length > 0 ? (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "flex-end",
                            gap: 8,
                            height: 130,
                            paddingBottom: 0,
                          }}
                        >
                          {history.map((audit: { score: number; scannedAt: string }, index: number) => {
                            const barHeight = Math.max(8, Math.round((audit.score / 100) * 120));
                            return (
                              <div
                                key={index}
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "center",
                                  flex: 1,
                                  minWidth: 0,
                                }}
                              >
                                <Text as="span" variant="bodySm" fontWeight="semibold" alignment="center">
                                  {audit.score}
                                </Text>
                                <div
                                  style={{
                                    width: "100%",
                                    maxWidth: 48,
                                    height: barHeight,
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
                              </div>
                            );
                          })}
                        </div>
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
                      {/* Date labels */}
                      {history && history.length > 0 && (
                        <div style={{ display: "flex", gap: 8, paddingTop: 4 }}>
                          {history.map((audit: { score: number; scannedAt: string }, index: number) => (
                            <div key={index} style={{ flex: 1, textAlign: "center" }}>
                              <Text as="span" variant="bodySm" tone="subdued">
                                {new Date(audit.scannedAt).toLocaleDateString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                })}
                              </Text>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </BlockStack>
                </Card>
              </Grid.Cell>
              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                <Card>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">Scan details</Text>
                    {hasCachedScan ? (
                      <BlockStack gap="200">
                        <InlineStack gap="200">
                          <Badge>{`Products: ${scanSummary.productCount}`}</Badge>
                          <Badge>{`Images: ${scanSummary.productImageCount}`}</Badge>
                          <Badge>{`Pages: ${scanSummary.pageCount}`}</Badge>
                          <Badge>{`Articles: ${scanSummary.articleCount}`}</Badge>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Live URLs: {scanSummary.liveUrlsOk} ok / {scanSummary.liveUrls.length} total.
                          {scanSummary.collectionSampleCount > 0 &&
                            ` Collections sampled: ${scanSummary.collectionSampleCount}.`}
                          {scanSummary.blogSampleCount > 0 &&
                            ` Blog articles sampled: ${scanSummary.blogSampleCount}.`}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Theme{scanSummary.themeName ? ` "${scanSummary.themeName}"` : ""}:{" "}
                          {scanSummary.themeScanOk
                            ? `${scanSummary.themeFilesRead} SEO files read`
                            : scanSummary.themeScanError || "unavailable"}
                        </Text>
                      </BlockStack>
                    ) : (
                      <Text as="p" variant="bodySm" tone="subdued">
                        Run an audit to see detailed scan breakdown.
                      </Text>
                    )}
                  </BlockStack>
                </Card>
              </Grid.Cell>
            </Grid>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
