import { useState } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Button,
  InlineStack,
  TextField,
  Banner,
  Badge,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

export default function SitemapRobotsPage() {
  const [robotsTxt, setRobotsTxt] = useState(
    "User-agent: *\nDisallow: /admin\nDisallow: /cart\nDisallow: /orders\nDisallow: /checkouts\nDisallow: /checkout\nDisallow: /10526019/checkouts\nDisallow: /10526019/orders\nDisallow: /carts\nDisallow: /account\nDisallow: /collections/*sort_by*\nDisallow: /*/collections/*sort_by*\nDisallow: /collections/*+*\nDisallow: /collections/*%2B*\nDisallow: /collections/*%2b*\nDisallow: /*/collections/*+*\nDisallow: /*/collections/*%2B*\nDisallow: /*/collections/*%2b*\nDisallow: /blogs/*+*\nDisallow: /blogs/*%2B*\nDisallow: /blogs/*%2b*\nDisallow: /*/blogs/*+*\nDisallow: /*/blogs/*%2B*\nDisallow: /*/blogs/*%2b*\nDisallow: /*design_theme_id*\nDisallow: /*preview_theme_id*\nDisallow: /*preview_script_id*\nDisallow: /policies/\nDisallow: /*/*?*ls=*\nDisallow: /*/*?*ls%3D*\nDisallow: /*/*?*ls%3d*\nDisallow: /search\nDisallow: /apple-app-site-association\nDisallow: /.well-known/shopify/monorail"
  );
  
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmitSitemap = () => {
    setIsSubmitting(true);
    setTimeout(() => setIsSubmitting(false), 2000);
  };

  return (
    <Page>
      <TitleBar title="Sitemap & Robots.txt" />
      <BlockStack gap="500">
        <Layout>
          {/* Sitemap Manager */}
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    XML Sitemap
                  </Text>
                  <Text as="p" tone="subdued">
                    Shopify automatically generates your sitemap at <Text as="span" fontWeight="bold">yourstore.com/sitemap.xml</Text>. Submit it to Google Search Console to ensure your pages are indexed.
                  </Text>
                </BlockStack>
                
                <Card background="bg-surface-secondary">
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h3" variant="headingSm">Status</Text>
                      <Badge tone="success">Generated</Badge>
                    </InlineStack>
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h3" variant="headingSm">Last Updated</Text>
                      <Text as="p" tone="subdued">Automatically synced</Text>
                    </InlineStack>
                  </BlockStack>
                </Card>

                <Button 
                  variant="primary" 
                  loading={isSubmitting} 
                  onClick={handleSubmitSitemap}
                >
                  Submit to Google Search Console
                </Button>
                
                <Banner tone="info">
                  Requires linking your Google Search Console account in the settings.
                </Banner>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Robots.txt Editor */}
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingMd">
                      Robots.txt Editor
                    </Text>
                    <Text as="p" tone="subdued">
                      Control which pages search engine bots are allowed to crawl.
                    </Text>
                  </BlockStack>
                  <Button>Save Changes</Button>
                </InlineStack>

                <TextField
                  labelHidden
                  label="Robots.txt content"
                  value={robotsTxt}
                  onChange={setRobotsTxt}
                  multiline={12}
                  autoComplete="off"
                  monospaced
                />
                
                <Banner tone="warning">
                  Editing your robots.txt file incorrectly can prevent search engines from crawling your entire site. Proceed with caution.
                </Banner>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}