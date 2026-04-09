/**
 * Full-catalog + live storefront + main theme scan for the SEO dashboard.
 * Uses Admin GraphQL pagination (250/page) and HTTP fetch for public HTML.
 */

const PAGE = 250;
const FETCH_TIMEOUT_MS = 25_000;
const USER_AGENT =
  "SEO-Suite-AI/1.0 (merchant dashboard scan; +https://shopify.dev)";

export type ShopifyAdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

function gqlJson<T>(raw: unknown): T {
  const j = raw as {
    errors?: { message: string }[];
    data?: T;
  };
  if (j.errors?.length) {
    throw new Error(j.errors.map((e) => e.message).join("; "));
  }
  if (!j.data) {
    throw new Error("Empty GraphQL response");
  }
  return j.data;
}

async function fetchRemainingProductImages(
  admin: ShopifyAdminGraphql,
  productId: string,
  startCursor: string,
): Promise<{ altText?: string | null }[]> {
  const images: { altText?: string | null }[] = [];
  let after: string | null = startCursor;
  const query = `#graphql
    query ProductImages($id: ID!, $after: String) {
      product(id: $id) {
        images(first: ${PAGE}, after: $after) {
          pageInfo { hasNextPage endCursor }
          edges { node { altText } }
        }
      }
    }`;
  for (;;) {
    const res = await admin.graphql(query, {
      variables: { id: productId, after },
    });
    const data = gqlJson<{
      product: {
        images: {
          pageInfo: { hasNextPage: boolean; endCursor: string };
          edges: { node: { altText?: string | null } }[];
        };
      } | null;
    }>(await res.json());
    const conn = data.product?.images;
    if (!conn) break;
    for (const e of conn.edges) images.push(e.node);
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return images;
}

export type DashboardProduct = {
  id: string;
  title: string;
  handle: string;
  seo?: { title?: string | null; description?: string | null } | null;
  images: { altText?: string | null }[];
};

export async function fetchAllProductsWithImages(
  admin: ShopifyAdminGraphql,
): Promise<DashboardProduct[]> {
  const products: DashboardProduct[] = [];
  let after: string | null = null;
  const listQuery = `#graphql
    query ProductsPage($after: String) {
      products(first: ${PAGE}, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            title
            handle
            seo { title description }
            images(first: ${PAGE}) {
              pageInfo { hasNextPage endCursor }
              edges { node { altText } }
            }
          }
        }
      }
    }`;

  for (;;) {
    const res = await admin.graphql(listQuery, { variables: { after } });
    const data = gqlJson<{
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string };
        edges: {
          node: Omit<DashboardProduct, "images"> & {
            images: {
              pageInfo: { hasNextPage: boolean; endCursor: string };
              edges: { node: { altText?: string | null } }[];
            };
          };
        }[];
      };
    }>(await res.json());

    for (const { node } of data.products.edges) {
      let images = node.images.edges.map((e) => e.node);
      if (node.images.pageInfo.hasNextPage) {
        const rest = await fetchRemainingProductImages(
          admin,
          node.id,
          node.images.pageInfo.endCursor,
        );
        images = [...images, ...rest];
      }
      const { images: _imgConn, ...rest } = node;
      products.push({
        ...rest,
        images,
      });
    }

    if (!data.products.pageInfo.hasNextPage) break;
    after = data.products.pageInfo.endCursor;
  }

  return products;
}

export type DashboardPage = {
  id: string;
  title: string;
  handle: string;
  body?: string | null;
};

export async function fetchAllPages(
  admin: ShopifyAdminGraphql,
): Promise<DashboardPage[]> {
  const pages: DashboardPage[] = [];
  let after: string | null = null;
  const query = `#graphql
    query PagesPage($after: String) {
      pages(first: ${PAGE}, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            title
            handle
            body
          }
        }
      }
    }`;

  for (;;) {
    const res = await admin.graphql(query, { variables: { after } });
    const data = gqlJson<{
      pages: {
        pageInfo: { hasNextPage: boolean; endCursor: string };
        edges: { node: DashboardPage }[];
      };
    }>(await res.json());
    for (const { node } of data.pages.edges) pages.push(node);
    if (!data.pages.pageInfo.hasNextPage) break;
    after = data.pages.pageInfo.endCursor;
  }
  return pages;
}

export type DashboardArticle = {
  id: string;
  title: string;
  handle: string;
  body?: string | null;
};

export async function fetchAllArticles(
  admin: ShopifyAdminGraphql,
): Promise<DashboardArticle[]> {
  const articles: DashboardArticle[] = [];
  let after: string | null = null;
  const query = `#graphql
    query ArticlesPage($after: String) {
      articles(first: ${PAGE}, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            title
            handle
            body
          }
        }
      }
    }`;

  for (;;) {
    const res = await admin.graphql(query, { variables: { after } });
    const data = gqlJson<{
      articles: {
        pageInfo: { hasNextPage: boolean; endCursor: string };
        edges: { node: DashboardArticle }[];
      };
    }>(await res.json());
    for (const { node } of data.articles.edges) articles.push(node);
    if (!data.articles.pageInfo.hasNextPage) break;
    after = data.articles.pageInfo.endCursor;
  }
  return articles;
}

export type ShopPublicInfo = {
  baseUrl: string;
  hosts: string[];
};

export async function fetchShopPublicInfo(
  admin: ShopifyAdminGraphql,
): Promise<ShopPublicInfo> {
  const res = await admin.graphql(`#graphql
    query ShopPublic {
      shop {
        myshopifyDomain
        primaryDomain { host url }
      }
    }`);
  const data = gqlJson<{
    shop: {
      myshopifyDomain: string;
      primaryDomain?: { host: string; url: string } | null;
    };
  }>(await res.json());

  const myshop = data.shop.myshopifyDomain;
  const primary = data.shop.primaryDomain;
  const baseUrl = (primary?.url || `https://${myshop}`).replace(/\/$/, "");
  const hosts = new Set<string>();
  hosts.add(myshop.toLowerCase());
  if (primary?.host) hosts.add(primary.host.toLowerCase());

  return { baseUrl, hosts: [...hosts] };
}

export async function fetchShopDisplayName(
  admin: ShopifyAdminGraphql,
): Promise<string> {
  try {
    const res = await admin.graphql(`#graphql
      query ShopDisplayName {
        shop {
          name
        }
      }
    `);
    const data = gqlJson<{ shop: { name: string } }>(await res.json());
    return data.shop.name?.trim() || "";
  } catch {
    return "";
  }
}

export type LiveHtmlMetrics = {
  ok: boolean;
  url?: string;
  error?: string;
  h1Count: number;
  titleLength: number;
  hasMetaDescription: boolean;
  imgTags: number;
  imgsMissingAlt: number;
};

function stripNoiseHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

export async function scanLiveStorefrontPage(url: string): Promise<LiveHtmlMetrics> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      return {
        ok: false,
        url,
        error: `HTTP ${res.status}`,
        h1Count: 0,
        titleLength: 0,
        hasMetaDescription: false,
        imgTags: 0,
        imgsMissingAlt: 0,
      };
    }
    const html = await res.text();
    const clean = stripNoiseHtml(html);

    const h1Re = /<h1\b[^>]*>[\s\S]*?<\/h1>/gi;
    const h1Matches = clean.match(h1Re);
    const h1Count = h1Matches?.length ?? 0;

    const titleM = clean.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const titleLength = titleM ? titleM[1].replace(/\s+/g, " ").trim().length : 0;

    const hasMetaDescription =
      /<meta[^>]+name\s*=\s*["']description["'][^>]+content\s*=\s*["'][^"']*["'][^>]*>/i.test(
        clean,
      ) ||
      /<meta[^>]+content\s*=\s*["'][^"']*["'][^>]+name\s*=\s*["']description["'][^>]*>/i.test(
        clean,
      ) ||
      /<meta[^>]+property\s*=\s*["']og:description["'][^>]+content\s*=\s*["'][^"']+["'][^>]*>/i.test(
        clean,
      );

    const imgRe = /<img\b[^>]*>/gi;
    let imgTags = 0;
    let imgsMissingAlt = 0;
    let m: RegExpExecArray | null;
    const re = new RegExp(imgRe.source, imgRe.flags);
    while ((m = re.exec(clean)) !== null) {
      imgTags++;
      const tag = m[0];
      const hasAlt = /\balt\s*=\s*["'][^"']*["']/i.test(tag);
      if (!hasAlt) imgsMissingAlt++;
    }

    return {
      ok: true,
      url,
      h1Count,
      titleLength,
      hasMetaDescription,
      imgTags,
      imgsMissingAlt,
    };
  } catch (e) {
    return {
      ok: false,
      url,
      error: e instanceof Error ? e.message : "Fetch failed",
      h1Count: 0,
      titleLength: 0,
      hasMetaDescription: false,
      imgTags: 0,
      imgsMissingAlt: 0,
    };
  }
}

/** @deprecated Prefer `scanLiveStorefrontPage` with a full URL. */
export async function scanLiveStorefrontHomepage(
  baseUrl: string,
): Promise<LiveHtmlMetrics> {
  const root = baseUrl.replace(/\/$/, "");
  return scanLiveStorefrontPage(`${root}/`);
}

export async function scanLiveStorefrontUrls(
  urls: string[],
): Promise<LiveHtmlMetrics[]> {
  return Promise.all(urls.map((u) => scanLiveStorefrontPage(u)));
}

export type ThemeScanMetrics = {
  ok: boolean;
  themeId?: string;
  themeName?: string;
  error?: string;
  filesRead: number;
  /** layout/theme.liquid contains viewport meta tag */
  hasViewportMeta: boolean;
  /** Any lazy-loading hint in sampled Liquid */
  hasLazyLoadingHints: boolean;
  /** Total characters read from sampled files (capped per file) */
  totalChars: number;
};

/** Theme paths that influence storefront SEO (batched; max 50 filenames per Admin API call). */
const THEME_FILES: string[] = [
  "layout/theme.liquid",
  "layout/password.liquid",
  "templates/index.json",
  "templates/product.json",
  "templates/collection.json",
  "templates/page.json",
  "templates/article.json",
  "templates/blog.json",
  "templates/list-collections.json",
  "templates/search.json",
  "templates/cart.json",
  "templates/customers/account.json",
  "sections/header.liquid",
  "sections/footer.liquid",
  "sections/main-product.liquid",
  "sections/main-collection.liquid",
  "sections/main-page.liquid",
  "sections/main-article.liquid",
  "sections/main-blog.liquid",
  "sections/main-list-collections.liquid",
  "sections/main-search.liquid",
  "sections/predictive-search.liquid",
  "sections/image-banner.liquid",
  "sections/rich-text.liquid",
  "config/settings_schema.json",
  "config/settings_data.json",
  "snippets/meta-tags.liquid",
  "snippets/social-meta-tags.liquid",
];

const MAX_THEME_FILE_CHARS = 120_000;
const THEME_FILE_BATCH = 50;

function chunkFilenames(filenames: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < filenames.length; i += THEME_FILE_BATCH) {
    out.push(filenames.slice(i, i + THEME_FILE_BATCH));
  }
  return out;
}

export async function scanMainTheme(
  admin: ShopifyAdminGraphql,
): Promise<ThemeScanMetrics> {
  try {
    const themesRes = await admin.graphql(`#graphql
      query MainTheme {
        themes(first: 20) {
          edges {
            node {
              id
              name
              role
            }
          }
        }
      }`);
    const themesData = gqlJson<{
      themes: {
        edges: { node: { id: string; name: string; role: string } }[];
      };
    }>(await themesRes.json());

    const themeNodes = themesData.themes.edges.map((e) => e.node);
    const main = themeNodes.find(
      (t) => t.role === "MAIN" || t.role === "main",
    );
    if (!main) {
      return {
        ok: false,
        error: "No MAIN theme found",
        filesRead: 0,
        hasViewportMeta: true,
        hasLazyLoadingHints: true,
        totalChars: 0,
      };
    }

    let combined = "";
    let filesRead = 0;
    const batches = chunkFilenames(THEME_FILES);

    for (const filenames of batches) {
      const fileRes = await admin.graphql(
        `#graphql
        query ThemeFiles($id: ID!, $filenames: [String!]!) {
          theme(id: $id) {
            id
            name
            files(filenames: $filenames, first: 50) {
              nodes {
                filename
                body {
                  ... on OnlineStoreThemeFileBodyText {
                    content
                  }
                }
              }
            }
          }
        }`,
        { variables: { id: main.id, filenames } },
      );
      const fileJson = await fileRes.json();
      if ((fileJson as { errors?: unknown }).errors) {
        return {
          ok: false,
          themeId: main.id,
          themeName: main.name,
          error: "Could not read theme files (check read_themes scope)",
          filesRead: 0,
          hasViewportMeta: true,
          hasLazyLoadingHints: true,
          totalChars: 0,
        };
      }
      const fileData = fileJson as {
        data?: {
          theme: {
            id: string;
            name: string;
            files: {
              nodes: {
                filename: string;
                body?: { content?: string } | null;
              }[];
            } | null;
          } | null;
        };
      };
      const theme = fileData.data?.theme;
      const nodes = theme?.files?.nodes ?? [];
      for (const n of nodes) {
        const c = n.body && "content" in n.body ? n.body.content : "";
        if (c) {
          filesRead++;
          combined += c.slice(0, MAX_THEME_FILE_CHARS) + "\n";
        }
      }
    }

    if (filesRead === 0) {
      return {
        ok: true,
        themeId: main.id,
        themeName: main.name,
        filesRead: 0,
        hasViewportMeta: true,
        hasLazyLoadingHints: true,
        totalChars: 0,
      };
    }

    const lower = combined.toLowerCase();
    const hasViewportMeta =
      lower.includes("viewport") &&
      (lower.includes("name=\"viewport\"") ||
        lower.includes("name='viewport'") ||
        lower.includes("meta name=viewport"));

    const hasLazyLoadingHints =
      /\blazy\b/i.test(combined) ||
      /loading\s*=\s*["']lazy["']/i.test(combined) ||
      /loading:\s*lazy/i.test(combined);

    return {
      ok: true,
      themeId: main.id,
      themeName: main.name,
      filesRead,
      hasViewportMeta,
      hasLazyLoadingHints,
      totalChars: combined.length,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Theme scan failed",
      filesRead: 0,
      hasViewportMeta: true,
      hasLazyLoadingHints: true,
      totalChars: 0,
    };
  }
}

/** Match internal product links for broken-link check. */
export function extractProductHandleFromHref(
  href: string,
  hosts: string[],
): string | null {
  const h = href.trim();
  if (h.startsWith("/products/")) {
    const rest = h.slice("/products/".length).split("?")[0].replace(/\/$/, "");
    return rest || null;
  }
  try {
    const u = new URL(h);
    const hostOk = hosts.some(
      (x) => u.hostname.toLowerCase() === x.toLowerCase(),
    );
    if (!hostOk) return null;
    const path = u.pathname;
    if (path.startsWith("/products/")) {
      return path.slice("/products/".length).split("/")[0] || null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

const PAGE_HANDLE_KEYWORDS = [
  "faq",
  "about",
  "contact",
  "policy",
  "terms",
  "shipping",
  "returns",
  "privacy",
  "our-story",
  "story",
  "blog",
] as const;

const MAX_LIVE_URLS = 32;

export type DashboardBlogSample = {
  blogHandle: string;
  articleHandle: string | null;
};

export async function fetchSampleCollectionHandles(
  admin: ShopifyAdminGraphql,
  limit = 10,
): Promise<string[]> {
  try {
    const res = await admin.graphql(
      `#graphql
      query DashboardCollections($first: Int!) {
        collections(first: $first) {
          edges {
            node {
              handle
            }
          }
        }
      }`,
      { variables: { first: limit } },
    );
    const data = gqlJson<{
      collections: { edges: { node: { handle: string } }[] };
    }>(await res.json());
    return data.collections.edges.map((e) => e.node.handle).filter(Boolean);
  } catch {
    return [];
  }
}

export async function fetchBlogsSample(
  admin: ShopifyAdminGraphql,
  blogLimit = 5,
): Promise<DashboardBlogSample[]> {
  try {
    const res = await admin.graphql(
      `#graphql
      query DashboardBlogs($blogLimit: Int!) {
        blogs(first: $blogLimit) {
          edges {
            node {
              handle
              articles(first: 1, sortKey: PUBLISHED_AT, reverse: true) {
                edges {
                  node {
                    handle
                  }
                }
              }
            }
          }
        }
      }`,
      { variables: { blogLimit } },
    );
    const data = gqlJson<{
      blogs: {
        edges: {
          node: {
            handle: string;
            articles: { edges: { node: { handle: string } }[] };
          };
        }[];
      };
    }>(await res.json());
    return data.blogs.edges.map(({ node }) => ({
      blogHandle: node.handle,
      articleHandle: node.articles.edges[0]?.node.handle ?? null,
    }));
  } catch {
    return [];
  }
}

export function buildDashboardLiveUrls(
  baseUrl: string,
  products: DashboardProduct[],
  pages: DashboardPage[],
  collectionHandles: string[],
  blogs: DashboardBlogSample[],
): string[] {
  const root = baseUrl.replace(/\/$/, "");
  const set = new Set<string>();
  set.add(`${root}/`);

  for (const p of products.slice(0, 6)) {
    set.add(`${root}/products/${encodeURIComponent(p.handle)}`);
  }
  for (const h of collectionHandles.slice(0, 6)) {
    set.add(`${root}/collections/${encodeURIComponent(h)}`);
  }

  const kwPages = pages.filter((page) => {
    const low = page.handle.toLowerCase();
    return PAGE_HANDLE_KEYWORDS.some((k) => low.includes(k));
  });
  for (const page of kwPages.slice(0, 12)) {
    set.add(`${root}/pages/${encodeURIComponent(page.handle)}`);
  }

  for (const b of blogs) {
    set.add(`${root}/blogs/${encodeURIComponent(b.blogHandle)}`);
    if (b.articleHandle) {
      set.add(
        `${root}/blogs/${encodeURIComponent(b.blogHandle)}/${encodeURIComponent(b.articleHandle)}`,
      );
    }
  }

  return [...set].slice(0, MAX_LIVE_URLS);
}

export type DashboardScanSummary = {
  productCount: number;
  productImageCount: number;
  pageCount: number;
  articleCount: number;
  liveUrls: string[];
  liveUrlsOk: number;
  liveUrlsFailed: number;
  themeName: string | null;
  themeFilesRead: number;
  themeScanOk: boolean;
  themeScanError: string | null;
  collectionSampleCount: number;
  blogSampleCount: number;
};

export type IssueCategory =
  | "Speed Optimization"
  | "Content Optimization"
  | "Search Appearance"
  | "Technical SEO";

export type IssueSeverity = "critical" | "warning" | "good";

export type IssueDetail = {
  category: IssueCategory;
  severity: IssueSeverity;
  title: string;
  description: string;
  count: number;
  link?: string;
};

export type DashboardScanPayload = {
  seoScore: number;
  healthLabel: "Low" | "Medium" | "High";
  metaIssuesCount: number;
  missingAltCount: number;
  brokenLinksCount: number;
  duplicateContentCount: number;
  themeIssuesCount: number;
  totalIssueSignals: number;
  pagesScanned: number;
  criticalIssue: number;
  needImprovement: number;
  goodResult: number;
  issues: IssueDetail[];
  scanSummary: DashboardScanSummary;
};

export function getEmptyDashboardPayload(): DashboardScanPayload {
  return {
    seoScore: 0,
    healthLabel: "Low",
    metaIssuesCount: 0,
    missingAltCount: 0,
    brokenLinksCount: 0,
    duplicateContentCount: 0,
    themeIssuesCount: 0,
    totalIssueSignals: 0,
    pagesScanned: 0,
    criticalIssue: 0,
    needImprovement: 0,
    goodResult: 0,
    issues: [],
    scanSummary: {
      productCount: 0,
      productImageCount: 0,
      pageCount: 0,
      articleCount: 0,
      liveUrls: [],
      liveUrlsOk: 0,
      liveUrlsFailed: 0,
      themeName: null,
      themeFilesRead: 0,
      themeScanOk: false,
      themeScanError: null,
      collectionSampleCount: 0,
      blogSampleCount: 0,
    },
  };
}

export function parseDashboardPayload(raw: unknown): DashboardScanPayload {
  if (!raw || typeof raw !== "object") return getEmptyDashboardPayload();
  const o = raw as Record<string, unknown>;
  if (typeof o.seoScore !== "number") return getEmptyDashboardPayload();
  return raw as DashboardScanPayload;
}

export async function runFullDashboardScan(
  admin: ShopifyAdminGraphql,
): Promise<DashboardScanPayload> {
  const shopInfo = await fetchShopPublicInfo(admin);

  const [
    products,
    pages,
    articles,
    collectionHandles,
    blogSamples,
    themeMetrics,
  ] = await Promise.all([
    fetchAllProductsWithImages(admin),
    fetchAllPages(admin),
    fetchAllArticles(admin),
    fetchSampleCollectionHandles(admin, 12),
    fetchBlogsSample(admin, 6),
    scanMainTheme(admin),
  ]);

  const liveUrls = buildDashboardLiveUrls(
    shopInfo.baseUrl,
    products,
    pages,
    collectionHandles,
    blogSamples,
  );
  const liveMetrics = await scanLiveStorefrontUrls(liveUrls);

  const productHandles = new Set(products.map((p) => p.handle));

  let totalScore = 0;
  let metaIssuesCount = 0;
  let missingAltCount = 0;
  let brokenLinksCount = 0;
  let duplicateContentCount = 0;
  let themeIssuesCount = 0;

  const titles = new Set<string>();

  products.forEach((product) => {
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
      score -= 15;
    }

    let missingAlts = 0;
    for (const img of product.images) {
      if (!img.altText?.trim()) missingAlts++;
    }

    if (missingAlts > 0) {
      score -= Math.min(20, 5 * missingAlts);
      missingAltCount += missingAlts;
    }

    if (score < 0) score = 0;
    totalScore += score;
  });

  let pagesWeakTitle = 0;
  pages.forEach((page) => {
    let score = 100;
    if (page.title.length < 5 || page.title.length > 60) {
      pagesWeakTitle++;
    }
    if (page.title.length < 5) score -= 20;
    if (page.title.length > 60) score -= 10;
    if (score < 0) score = 0;
    totalScore += score;
  });

  let articlesWeakTitle = 0;
  articles.forEach((article) => {
    let score = 100;
    if (article.title.length < 3) {
      score -= 15;
      articlesWeakTitle++;
    }
    if (score < 0) score = 0;
    totalScore += score;
  });

  const resourceCount = products.length + pages.length + articles.length;
  let averageScore =
    resourceCount > 0 ? Math.round(totalScore / resourceCount) : 100;

  const validateHtml = (html: string | null | undefined) => {
    if (!html) return;
    const regex = /<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1[^>]*>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const url = match[2];
      const handle = extractProductHandleFromHref(url, shopInfo.hosts);
      if (handle && !productHandles.has(handle)) {
        brokenLinksCount++;
      }
    }
  };

  for (const a of articles) validateHtml(a.body);
  for (const p of pages) validateHtml(p.body);

  let livePenaltyBudget = 0;
  const LIVE_PENALTY_CAP = 25;
  for (const m of liveMetrics) {
    if (!m.ok) {
      livePenaltyBudget += 3;
      continue;
    }
    if (m.h1Count !== 1) {
      metaIssuesCount++;
      livePenaltyBudget += 4;
    }
    if (!m.hasMetaDescription) {
      metaIssuesCount++;
      livePenaltyBudget += 4;
    }
    if (m.titleLength > 0) {
      if (m.titleLength < 10 || m.titleLength > 70) {
        metaIssuesCount++;
        livePenaltyBudget += 3;
      }
    }
    if (m.imgsMissingAlt > 0) {
      missingAltCount += m.imgsMissingAlt;
      livePenaltyBudget += Math.min(6, m.imgsMissingAlt * 2);
    }
  }
  averageScore -= Math.min(LIVE_PENALTY_CAP, livePenaltyBudget);

  if (themeMetrics.ok && themeMetrics.filesRead > 0) {
    if (!themeMetrics.hasViewportMeta) {
      themeIssuesCount++;
      averageScore -= 6;
    }
  }

  averageScore = Math.max(0, Math.min(100, averageScore));

  const titleFreq = new Map<string, number>();
  for (const p of products) {
    const t = p.seo?.title?.trim();
    if (t) titleFreq.set(t, (titleFreq.get(t) || 0) + 1);
  }

  let goodProducts = 0;
  for (const p of products) {
    const t = p.seo?.title?.trim();
    const dup = !!(t && (titleFreq.get(t) || 0) > 1);
    if (
      t &&
      p.seo?.description?.trim() &&
      p.images.every((i) => i.altText?.trim()) &&
      !dup
    ) {
      goodProducts++;
    }
  }

  const goodPages = pages.filter(
    (p) => p.title.length >= 5 && p.title.length <= 60,
  ).length;
  const goodArticles = articles.filter((a) => a.title.length >= 3).length;

  const goodLive = liveMetrics.filter(
    (m) =>
      m.ok &&
      m.h1Count === 1 &&
      m.hasMetaDescription &&
      m.titleLength >= 10 &&
      m.titleLength <= 70 &&
      m.imgsMissingAlt === 0,
  ).length;

  const themeGood =
    themeMetrics.ok &&
    themeMetrics.filesRead > 0 &&
    themeMetrics.hasViewportMeta
      ? 1
      : 0;

  const productsNoTitle = products.filter((p) => !p.seo?.title?.trim()).length;
  const productsNoDesc = products.filter(
    (p) => !p.seo?.description?.trim(),
  ).length;

  const liveH1Bad = liveMetrics.filter((m) => m.ok && m.h1Count !== 1).length;
  const liveFetchFailed = liveMetrics.filter((m) => !m.ok).length;

  let liveNeedSignals = 0;
  for (const m of liveMetrics) {
    if (!m.ok) continue;
    if (!m.hasMetaDescription) liveNeedSignals++;
    if (m.titleLength > 0 && (m.titleLength < 10 || m.titleLength > 70)) {
      liveNeedSignals++;
    }
    if (m.imgsMissingAlt > 0) liveNeedSignals++;
  }

  const criticalIssue =
    brokenLinksCount +
    productsNoTitle +
    liveH1Bad +
    liveFetchFailed;

  const needImprovement =
    productsNoDesc +
    duplicateContentCount +
    missingAltCount +
    themeIssuesCount +
    liveNeedSignals +
    pagesWeakTitle +
    articlesWeakTitle;

  const goodResult =
    goodProducts +
    goodPages +
    goodArticles +
    goodLive +
    themeGood;

  const totalProductImages = products.reduce(
    (n, p) => n + p.images.length,
    0,
  );

  const totalIssueSignals = criticalIssue + needImprovement;

  const healthLabel: DashboardScanPayload["healthLabel"] =
    averageScore < 50 ? "Low" : averageScore < 80 ? "Medium" : "High";

  const pagesScanned =
    products.length +
    pages.length +
    articles.length +
    liveUrls.length;

  const liveNoMetaDesc = liveMetrics.filter(
    (m) => m.ok && !m.hasMetaDescription,
  ).length;
  const liveTitleBad = liveMetrics.filter(
    (m) =>
      m.ok && m.titleLength > 0 && (m.titleLength < 10 || m.titleLength > 70),
  ).length;

  const issues: IssueDetail[] = [];
  const pushIf = (cond: boolean, d: IssueDetail) => {
    if (cond) issues.push(d);
  };

  pushIf(productsNoTitle > 0, {
    category: "Content Optimization",
    severity: "critical",
    title: "Products missing SEO title",
    description: `${productsNoTitle} product(s) have no SEO title set. Search engines use this as the page title in results.`,
    count: productsNoTitle,
    link: "/app/meta-tags",
  });
  pushIf(liveH1Bad > 0, {
    category: "Content Optimization",
    severity: "critical",
    title: "Multiple H1 tags found",
    description: `${liveH1Bad} live page(s) have zero or multiple H1 tags. Each page should have exactly one H1.`,
    count: liveH1Bad,
    link: "/app/seo-audit",
  });
  pushIf(liveFetchFailed > 0, {
    category: "Technical SEO",
    severity: "critical",
    title: "Live page fetch failed",
    description: `${liveFetchFailed} storefront URL(s) returned errors or timed out during the scan.`,
    count: liveFetchFailed,
  });
  pushIf(brokenLinksCount > 0, {
    category: "Search Appearance",
    severity: "critical",
    title: "Broken internal links",
    description: `${brokenLinksCount} internal link(s) point to products that no longer exist in your catalog.`,
    count: brokenLinksCount,
    link: "/app/broken-links",
  });

  pushIf(productsNoDesc > 0, {
    category: "Content Optimization",
    severity: "warning",
    title: "Products missing SEO description",
    description: `${productsNoDesc} product(s) have no SEO description. Add descriptions to improve click-through rates.`,
    count: productsNoDesc,
    link: "/app/content-optimization",
  });
  pushIf(duplicateContentCount > 0, {
    category: "Content Optimization",
    severity: "warning",
    title: "Duplicate SEO titles",
    description: `${duplicateContentCount} product(s) share the same SEO title with another product.`,
    count: duplicateContentCount,
    link: "/app/meta-tags",
  });
  pushIf(missingAltCount > 0, {
    category: "Search Appearance",
    severity: "warning",
    title: "Image alt texts missing",
    description: `${missingAltCount} image(s) are missing alt text. Alt text helps search engines and accessibility.`,
    count: missingAltCount,
    link: "/app/image-optimization",
  });
  pushIf(liveNoMetaDesc > 0, {
    category: "Technical SEO",
    severity: "warning",
    title: "Missing meta description (live pages)",
    description: `${liveNoMetaDesc} live page(s) have no meta description tag.`,
    count: liveNoMetaDesc,
    link: "/app/meta-tags",
  });
  pushIf(liveTitleBad > 0, {
    category: "Content Optimization",
    severity: "warning",
    title: "Title length issues on live pages",
    description: `${liveTitleBad} live page(s) have titles shorter than 10 or longer than 70 characters.`,
    count: liveTitleBad,
    link: "/app/meta-tags",
  });
  pushIf(pagesWeakTitle > 0, {
    category: "Content Optimization",
    severity: "warning",
    title: "Pages with weak titles",
    description: `${pagesWeakTitle} CMS page(s) have titles that are too short or too long.`,
    count: pagesWeakTitle,
  });
  pushIf(articlesWeakTitle > 0, {
    category: "Content Optimization",
    severity: "warning",
    title: "Articles with weak titles",
    description: `${articlesWeakTitle} blog article(s) have very short titles.`,
    count: articlesWeakTitle,
  });
  pushIf(themeIssuesCount > 0, {
    category: "Technical SEO",
    severity: "warning",
    title: "Missing viewport meta in theme",
    description: "Your main theme layout is missing a viewport meta tag, which affects mobile SEO.",
    count: themeIssuesCount,
  });
  pushIf(totalProductImages > 0, {
    category: "Speed Optimization",
    severity: "warning",
    title: "Images may need compression",
    description: `${totalProductImages} product image(s) found. Compress them to improve page load speed.`,
    count: totalProductImages,
    link: "/app/image-compression",
  });

  pushIf(goodProducts > 0, {
    category: "Content Optimization",
    severity: "good",
    title: "Products with complete SEO",
    description: `${goodProducts} product(s) have title, description, and alt text on all images.`,
    count: goodProducts,
  });
  pushIf(goodPages > 0, {
    category: "Content Optimization",
    severity: "good",
    title: "Pages with good titles",
    description: `${goodPages} CMS page(s) have well-sized titles (5-60 characters).`,
    count: goodPages,
  });
  pushIf(goodArticles > 0, {
    category: "Content Optimization",
    severity: "good",
    title: "Articles with good titles",
    description: `${goodArticles} blog article(s) have adequately-sized titles.`,
    count: goodArticles,
  });
  pushIf(goodLive > 0, {
    category: "Technical SEO",
    severity: "good",
    title: "Live pages fully optimized",
    description: `${goodLive} live storefront page(s) passed all SEO checks (H1, meta desc, title, alt text).`,
    count: goodLive,
  });
  pushIf(themeGood > 0, {
    category: "Technical SEO",
    severity: "good",
    title: "Theme viewport meta present",
    description: "Your main theme layout includes the viewport meta tag for mobile SEO.",
    count: themeGood,
  });

  return {
    seoScore: averageScore,
    healthLabel,
    metaIssuesCount,
    missingAltCount,
    brokenLinksCount,
    duplicateContentCount,
    themeIssuesCount,
    totalIssueSignals,
    pagesScanned,
    criticalIssue,
    needImprovement,
    goodResult,
    issues,
    scanSummary: {
      productCount: products.length,
      productImageCount: totalProductImages,
      pageCount: pages.length,
      articleCount: articles.length,
      liveUrls,
      liveUrlsOk: liveMetrics.filter((m) => m.ok).length,
      liveUrlsFailed: liveMetrics.filter((m) => !m.ok).length,
      themeName: themeMetrics.themeName ?? null,
      themeFilesRead: themeMetrics.filesRead,
      themeScanOk: themeMetrics.ok,
      themeScanError: themeMetrics.error ?? null,
      collectionSampleCount: collectionHandles.length,
      blogSampleCount: blogSamples.length,
    },
  };
}
