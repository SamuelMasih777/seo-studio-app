import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

const LAST_UPDATED = "April 10, 2026";
const SUPPORT_EMAIL = "support@designflowdigitals.com";
const COMPANY = "Design Flow Digitals";
const APP_NAME = "SEO Suite AI";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <BlockStack gap="200">
      <Text as="h2" variant="headingMd">{title}</Text>
      {children}
    </BlockStack>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <Page>
      <TitleBar title="Privacy Policy" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="500">
              <BlockStack gap="200">
                <Text as="h1" variant="headingXl">Privacy Policy</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Last updated: {LAST_UPDATED}
                </Text>
                <Text as="p">
                  {COMPANY} ("we", "our", or "us") operates the {APP_NAME} application
                  for Shopify. This Privacy Policy explains what information we collect,
                  how we use it, and your rights regarding that information.
                </Text>
              </BlockStack>

              <Divider />

              <Section title="1. Information We Collect">
                <Text as="p">
                  When you install and use {APP_NAME}, we access the following data
                  through the Shopify Admin API using the permissions you grant during
                  installation:
                </Text>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm">
                    - <strong>Store information</strong>: Your shop name and domain, used
                    to identify your account within the app.
                  </Text>
                  <Text as="p" variant="bodySm">
                    - <strong>Product data</strong>: Product titles, descriptions, images,
                    and metadata for SEO auditing, AI content generation, and image
                    optimization.
                  </Text>
                  <Text as="p" variant="bodySm">
                    - <strong>Content data</strong>: Pages, blog articles, and collections
                    for SEO analysis, broken link detection, and internal linking
                    suggestions.
                  </Text>
                  <Text as="p" variant="bodySm">
                    - <strong>Theme files</strong>: Read-only access to theme templates for
                    SEO auditing purposes (e.g. checking for missing meta tags in theme
                    code).
                  </Text>
                  <Text as="p" variant="bodySm">
                    - <strong>Navigation data</strong>: Online store navigation menus for
                    internal linking analysis.
                  </Text>
                  <Text as="p" variant="bodySm">
                    - <strong>File data</strong>: Access to store files for image
                    compression features.
                  </Text>
                </BlockStack>
                <Text as="p">
                  We do not collect any personal data from your customers. Our app
                  operates entirely within the Shopify admin and does not interact with
                  your storefront visitors.
                </Text>
              </Section>

              <Divider />

              <Section title="2. How We Use Your Information">
                <Text as="p">
                  The data we access is used exclusively to provide the features of
                  {" "}{APP_NAME}:
                </Text>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm">
                    - Running SEO audits and calculating your store's SEO health score
                  </Text>
                  <Text as="p" variant="bodySm">
                    - Generating AI-powered product descriptions, image alt text, and blog
                    posts
                  </Text>
                  <Text as="p" variant="bodySm">
                    - Compressing images to improve page load speed
                  </Text>
                  <Text as="p" variant="bodySm">
                    - Detecting broken links and suggesting internal linking opportunities
                  </Text>
                  <Text as="p" variant="bodySm">
                    - Managing schema markup (structured data) for your store
                  </Text>
                  <Text as="p" variant="bodySm">
                    - Editing meta tags and product descriptions in bulk
                  </Text>
                  <Text as="p" variant="bodySm">
                    - Running scheduled automated SEO scans
                  </Text>
                </BlockStack>
              </Section>

              <Divider />

              <Section title="3. Third-Party Services">
                <Text as="p">
                  To provide our features, we use the following third-party services:
                </Text>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm">
                    - <strong>Google Gemini API</strong>: When you use AI content
                    generation features (product descriptions, alt text, blog posts), the
                    relevant product or topic data is sent to Google's Gemini API to
                    generate content. This data is used solely for the generation request
                    and is not stored by us beyond the response. Google's use of data is
                    governed by their own privacy policy.
                  </Text>
                  <Text as="p" variant="bodySm">
                    - <strong>Vercel</strong>: Our application is hosted on Vercel's
                    serverless infrastructure. Vercel processes requests in accordance
                    with their privacy policy.
                  </Text>
                  <Text as="p" variant="bodySm">
                    - <strong>Supabase</strong>: Our database is hosted on Supabase
                    (PostgreSQL). Session tokens, audit history, automation schedules, and
                    prompt templates are stored here.
                  </Text>
                </BlockStack>
              </Section>

              <Divider />

              <Section title="4. Data Storage">
                <Text as="p">
                  We store the following data in our database to provide app
                  functionality:
                </Text>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm">
                    - Session tokens (required by Shopify for app authentication)
                  </Text>
                  <Text as="p" variant="bodySm">
                    - SEO audit snapshots and historical scores
                  </Text>
                  <Text as="p" variant="bodySm">
                    - Store settings and preferences
                  </Text>
                  <Text as="p" variant="bodySm">
                    - Scheduled automation configurations
                  </Text>
                  <Text as="p" variant="bodySm">
                    - Custom AI prompt templates you create
                  </Text>
                  <Text as="p" variant="bodySm">
                    - Broken link scan logs
                  </Text>
                </BlockStack>
                <Text as="p">
                  We do not store your product descriptions, images, or any Shopify
                  content beyond what is needed for caching audit results.
                </Text>
              </Section>

              <Divider />

              <Section title="5. Data Sharing">
                <Text as="p">
                  We do not sell, rent, or share your data with any third parties for
                  marketing or advertising purposes. Your data is only shared with the
                  third-party service providers listed above, strictly for the purpose of
                  providing app functionality.
                </Text>
              </Section>

              <Divider />

              <Section title="6. Data Retention and Deletion">
                <Text as="p">
                  Your data is retained for as long as the app is installed on your
                  Shopify store. When you uninstall {APP_NAME}, we delete all
                  associated data from our database, including session tokens, audit
                  history, store settings, automation schedules, and prompt templates.
                </Text>
                <Text as="p">
                  If you would like your data deleted before uninstalling, you may
                  contact us at any time.
                </Text>
              </Section>

              <Divider />

              <Section title="7. Your Rights">
                <Text as="p">
                  You have the right to:
                </Text>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm">
                    - Request access to the data we hold about your store
                  </Text>
                  <Text as="p" variant="bodySm">
                    - Request correction of inaccurate data
                  </Text>
                  <Text as="p" variant="bodySm">
                    - Request deletion of your data
                  </Text>
                  <Text as="p" variant="bodySm">
                    - Export your data in a machine-readable format
                  </Text>
                </BlockStack>
                <Text as="p">
                  To exercise any of these rights, please contact us using the
                  information below.
                </Text>
              </Section>

              <Divider />

              <Section title="8. Changes to This Policy">
                <Text as="p">
                  We may update this Privacy Policy from time to time. When we do, we
                  will update the "Last updated" date at the top of this page. We
                  encourage you to review this page periodically for any changes.
                </Text>
              </Section>

              <Divider />

              <Section title="9. Contact Us">
                <Text as="p">
                  If you have any questions about this Privacy Policy or our data
                  practices, please contact us at:
                </Text>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm">
                    <strong>{COMPANY}</strong>
                  </Text>
                  <Text as="p" variant="bodySm">
                    Email: {SUPPORT_EMAIL}
                  </Text>
                </BlockStack>
              </Section>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
