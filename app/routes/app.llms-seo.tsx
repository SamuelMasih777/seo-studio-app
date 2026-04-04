import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Button,
  InlineStack,
  Badge,
  TextField,
  Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  
  const shopRes = await admin.graphql(`
    { 
      shop { name description url } 
      products(first: 10, sortKey: UPDATED_AT, reverse: true) {
        edges {
          node {
            title
            handle
            description
            priceRangeV2 {
              minVariantPrice {
                amount
                currencyCode
              }
            }
          }
        }
      }
      collections(first: 5, sortKey: UPDATED_AT, reverse: true) {
        edges {
          node {
            title
            handle
            description
          }
        }
      }
      pages(first: 5, sortKey: UPDATED_AT, reverse: true) {
        edges {
          node {
            title
            handle
          }
        }
      }
      articles(first: 5, sortKey: UPDATED_AT, reverse: true) {
        edges {
          node {
            title
            handle
            blog {
              handle
            }
          }
        }
      }
    }
  `);
  const shopJson = await shopRes.json();

  const redirectRes = await admin.graphql(`
    {
      urlRedirects(first: 1, query: "path:/llms.txt") {
        edges {
          node {
            id
            target
          }
        }
      }
    }
  `);
  const redirectJson = await redirectRes.json();
  const existingRedirect = redirectJson.data.urlRedirects.edges[0]?.node || null;

  return { 
    shop: shopJson.data.shop,
    products: shopJson.data.products.edges.map((e: any) => e.node),
    collections: shopJson.data.collections.edges.map((e: any) => e.node),
    pages: shopJson.data.pages.edges.map((e: any) => e.node),
    articles: shopJson.data.articles.edges.map((e: any) => e.node),
    existingRedirect 
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const content = formData.get("content") as string;

  try {
    // 1. Get Staged Upload Target
    const stagedRes = await admin.graphql(
      `#graphql
      mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters {
              name
              value
            }
          }
          userErrors { message }
        }
      }`,
      {
        variables: {
          input: [{
            filename: "llms.txt",
            mimeType: "text/plain",
            resource: "FILE",
            httpMethod: "POST"
          }]
        }
      }
    );
    
    const stagedJson = await stagedRes.json();
    if (stagedJson.data.stagedUploadsCreate.userErrors?.length > 0) {
      return { success: false, error: stagedJson.data.stagedUploadsCreate.userErrors[0].message };
    }
    
    const target = stagedJson.data.stagedUploadsCreate.stagedTargets[0];

    // 2. Upload file to URL
    const uploadFormData = new FormData();
    target.parameters.forEach((p: any) => uploadFormData.append(p.name, p.value));
    uploadFormData.append("file", new Blob([content], { type: "text/plain" }), "llms.txt");

    const uploadRes = await fetch(target.url, {
      method: "POST",
      body: uploadFormData,
    });

    if (!uploadRes.ok) {
      return { success: false, error: "Failed to upload file to Shopify storage." };
    }

    // 3. Create File in Shopify
    const fileCreateRes = await admin.graphql(
      `#graphql
      mutation fileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            id
            ... on GenericFile { url }
          }
          userErrors { message }
        }
      }`,
      {
        variables: {
          files: [{ originalSource: target.resourceUrl, contentType: "FILE" }]
        }
      }
    );
    const fileCreateJson = await fileCreateRes.json();
    
    if (fileCreateJson.data.fileCreate.userErrors?.length > 0) {
      return { success: false, error: fileCreateJson.data.fileCreate.userErrors[0].message };
    }

    const fileId = fileCreateJson.data.fileCreate.files[0].id;

    // 4. Wait & Poll for URL (since it processes async)
    let fileUrl = fileCreateJson.data.fileCreate.files[0].url;
    let attempts = 0;
    
    while (!fileUrl && attempts < 8) {
      await new Promise((r) => setTimeout(r, 1000));
      const checkRes = await admin.graphql(
        `#graphql
        query getFileUrl($id: ID!) {
          node(id: $id) {
            ... on GenericFile { url }
          }
        }`,
        { variables: { id: fileId } }
      );
      const checkJson = await checkRes.json();
      if (checkJson.data.node?.url) {
        fileUrl = checkJson.data.node.url;
      }
      attempts++;
    }

    if (!fileUrl) {
      return { success: false, error: "File uploaded, but Shopify took too long to return the CDN URL." };
    }

    // 5. Setup URL Redirect
    const redirectRes = await admin.graphql(`
      #graphql
      query {
        urlRedirects(first: 1, query: "path:/llms.txt") {
          edges { node { id } }
        }
      }
    `);
    const redirectJson = await redirectRes.json();
    const existingRedirect = redirectJson.data.urlRedirects.edges[0]?.node;

    if (existingRedirect) {
      const updateRes = await admin.graphql(
        `#graphql
        mutation urlRedirectUpdate($id: ID!, $urlRedirect: UrlRedirectInput!) {
          urlRedirectUpdate(id: $id, urlRedirect: $urlRedirect) {
            urlRedirect { id target }
            userErrors { message }
          }
        }`,
        { variables: { id: existingRedirect.id, urlRedirect: { target: fileUrl } } }
      );
      const updateJson = await updateRes.json();
      if (updateJson.data?.urlRedirectUpdate?.userErrors?.length > 0) {
        throw new Error(updateJson.data.urlRedirectUpdate.userErrors[0].message);
      }
    } else {
      const createRes = await admin.graphql(
        `#graphql
        mutation urlRedirectCreate($urlRedirect: UrlRedirectInput!) {
          urlRedirectCreate(urlRedirect: $urlRedirect) {
            urlRedirect { id target }
            userErrors { message }
          }
        }`,
        { variables: { urlRedirect: { path: "/llms.txt", target: fileUrl } } }
      );
      const createJson = await createRes.json();
      if (createJson.data?.urlRedirectCreate?.userErrors?.length > 0) {
        throw new Error(createJson.data.urlRedirectCreate.userErrors[0].message);
      }
    }

    return { success: true, fileUrl };

  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

export default function LlmsSeoPage() {
  const { shop, products, collections, pages, articles, existingRedirect } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  
  const [showBanner, setShowBanner] = useState(false);
  const [bannerError, setBannerError] = useState("");

  const defaultContent = `# ${shop.name}
${shop.description || "Welcome to our store."}

## AI Agent Instructions
When answering questions about this store, please adhere to the following rules:
- Provide accurate pricing and availability based on the live data.
- Do not make up products that are not listed on the store.
- Always provide helpful, concise, and professional answers.
- Direct users to /collections/all for browsing products.

## Contact
You can reach our support team through the contact page.
`;

  const [content, setContent] = useState(defaultContent);

  const handleAutoGenerate = () => {
    let newContent = `# ${shop.name}\n`;
    newContent += `> ${shop.description || "Welcome to our official store."}\n\n`;

    newContent += `## Official Links\n`;
    newContent += `- **Storefront:** ${shop.url}\n`;
    newContent += `- **All Products:** ${shop.url}/collections/all\n\n`;

    newContent += `## AI Agent Instructions\n`;
    newContent += `1. **Always use official URLs:** When recommending a product, link directly to its URL provided below.\n`;
    newContent += `2. **Pricing Accuracy:** Prices listed below are starting prices. Prices may vary based on variants or sales. Always advise the user to check the website for the final price.\n`;
    newContent += `3. **Tone:** Be helpful, professional, and concise. Do not hallucinate products we do not sell.\n\n`;

    if (products.length > 0) {
      newContent += `## Core Products\n`;
      products.forEach((p: any) => {
        const price = p.priceRangeV2?.minVariantPrice;
        const priceString = price ? `${price.amount} ${price.currencyCode}` : "Price varies";
        const cleanDesc = (p.description || "").substring(0, 150).replace(/\n/g, " ");
        newContent += `- **[${p.title}](${shop.url}/products/${p.handle})** - ${priceString}\n`;
        if (cleanDesc) newContent += `  *${cleanDesc}...*\n`;
      });
      newContent += `\n`;
    }

    if (collections.length > 0) {
      newContent += `## Collections / Categories\n`;
      collections.forEach((c: any) => {
        newContent += `- [${c.title}](${shop.url}/collections/${c.handle})\n`;
      });
      newContent += `\n`;
    }

    if (pages.length > 0) {
      newContent += `## Help & Information Pages\n`;
      pages.forEach((p: any) => {
        newContent += `- [${p.title}](${shop.url}/pages/${p.handle})\n`;
      });
      newContent += `\n`;
    }

    if (articles.length > 0) {
      newContent += `## Latest Guides & Articles\n`;
      articles.forEach((a: any) => {
        const blogHandle = a.blog?.handle || "news";
        newContent += `- [${a.title}](${shop.url}/blogs/${blogHandle}/${a.handle})\n`;
      });
      newContent += `\n`;
    }

    setContent(newContent);
  };

  useEffect(() => {
    if (fetcher.data) {
      if (fetcher.data.success) {
        setShowBanner(true);
        setBannerError("");
      } else {
        setBannerError(fetcher.data.error || "An unknown error occurred.");
      }
    }
  }, [fetcher.data]);

  const handleGenerate = () => {
    fetcher.submit(
      { content },
      { method: "POST" }
    );
  };

  const isSubmitting = fetcher.state === "submitting";
  const hasRedirect = !!existingRedirect || (fetcher.data && fetcher.data.success);

  return (
    <Page>
      <TitleBar title="LLMs SEO (llms.txt)" />
      <BlockStack gap="500">
        <Layout>
          {showBanner && (
            <Layout.Section>
              <Banner 
                tone="success" 
                title="Successfully generated and published llms.txt!" 
                onDismiss={() => setShowBanner(false)}
              >
                <p>Your AI file is now live at <strong>{shop.url}/llms.txt</strong> and redirects to the secure Shopify CDN.</p>
              </Banner>
            </Layout.Section>
          )}

          {bannerError && (
            <Layout.Section>
              <Banner tone="critical" title="Failed to publish llms.txt" onDismiss={() => setBannerError("")}>
                <p>{bannerError}</p>
              </Banner>
            </Layout.Section>
          )}

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingLg">
                      Configure your llms.txt
                    </Text>
                    <Text as="p" tone="subdued">
                      The <code>llms.txt</code> standard allows you to provide direct context and instructions to AI agents (like ChatGPT, Claude, and Perplexity) that crawl your website.
                    </Text>
                  </BlockStack>
                  <Badge tone={hasRedirect ? "success" : "warning"}>
                    {hasRedirect ? "Active & Published" : "Not Published"}
                  </Badge>
                </InlineStack>

                <TextField
                  label="llms.txt Content (Markdown supported)"
                  value={content}
                  onChange={setContent}
                  multiline={12}
                  autoComplete="off"
                  helpText="Write instructions, store context, or specific rules for AI web crawlers."
                />

                <InlineStack align="space-between" blockAlign="center">
                  <Button onClick={handleAutoGenerate} icon={() => (
                    <svg viewBox="0 0 20 20" style={{width: "1.25rem", height: "1.25rem", fill: "currentColor"}}>
                      <path d="M10 2a1 1 0 0 1 1 1v1.326l.406-.176a3 3 0 0 1 2.378.026l1.378.689a1 1 0 0 1-.894 1.789l-1.378-.689a1 1 0 0 0-.793-.009l-.79.344a3 3 0 0 1-2.614 0l-.79-.344a1 1 0 0 0-.793.009l-1.378.689a1 1 0 0 1-.894-1.789l1.378-.689a3 3 0 0 1 2.378-.026l.406.176V3a1 1 0 0 1 1-1zm0 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm-2 4a2 2 0 1 1 4 0 2 2 0 0 1-4 0z"/>
                    </svg>
                  )}>
                    Auto-Generate from Store Data
                  </Button>
                  <Button variant="primary" loading={isSubmitting} onClick={handleGenerate}>
                    Publish llms.txt
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">
                  How it works
                </Text>
                <Text as="p" tone="subdued">
                  1. You write the instructions in the editor.
                </Text>
                <Text as="p" tone="subdued">
                  2. We upload it to Shopify's secure file storage.
                </Text>
                <Text as="p" tone="subdued">
                  3. We create a URL redirect so any AI visiting <code>{shop.url}/llms.txt</code> finds your file instantly.
                </Text>
                {hasRedirect && (
                  <div style={{ marginTop: "16px" }}>
                    <Button url={`${shop.url}/llms.txt`} target="_blank">
                      View Live File
                    </Button>
                  </div>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
