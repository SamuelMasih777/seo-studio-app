import type { MetaFunction } from "@remix-run/node";

export const meta: MetaFunction = () => [
  { title: "Privacy Policy – SEO Suite AI" },
];

const LAST_UPDATED = "April 10, 2026";
const SUPPORT_EMAIL = "support@designflowdigitals.com";
const COMPANY = "Design Flow Digitals";
const APP_NAME = "SEO Suite AI";

export default function PrivacyPolicy() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Privacy Policy – {APP_NAME}</title>
        <style
          dangerouslySetInnerHTML={{
            __html: `
              *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; background: #f6f6f7; line-height: 1.6; }
              .container { max-width: 760px; margin: 0 auto; padding: 48px 24px 80px; }
              header { margin-bottom: 40px; }
              h1 { font-size: 2rem; font-weight: 700; margin-bottom: 8px; }
              .subtitle { color: #6d7175; font-size: 0.875rem; }
              .card { background: #fff; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
              h2 { font-size: 1.125rem; font-weight: 600; margin-bottom: 12px; margin-top: 32px; }
              h2:first-child { margin-top: 0; }
              p { margin-bottom: 12px; font-size: 0.9375rem; color: #303030; }
              ul { margin: 8px 0 12px 20px; }
              li { margin-bottom: 6px; font-size: 0.9375rem; color: #303030; }
              hr { border: none; border-top: 1px solid #e1e3e5; margin: 28px 0; }
              a { color: #005bd3; text-decoration: none; }
              a:hover { text-decoration: underline; }
              footer { margin-top: 40px; text-align: center; font-size: 0.8125rem; color: #6d7175; }
            `,
          }}
        />
      </head>
      <body>
        <div className="container">
          <header>
            <h1>Privacy Policy</h1>
            <p className="subtitle">Last updated: {LAST_UPDATED}</p>
          </header>

          <div className="card">
            <p>
              {COMPANY} ("we", "our", or "us") operates the {APP_NAME}{" "}
              application for Shopify. This Privacy Policy explains what
              information we collect, how we use it, and your rights regarding
              that information.
            </p>

            <hr />

            <h2>1. Information We Collect</h2>
            <p>
              When you install and use {APP_NAME}, we access the following data
              through the Shopify Admin API using the permissions you grant
              during installation:
            </p>
            <ul>
              <li>
                <strong>Store information</strong>: Your shop name and domain,
                used to identify your account within the app.
              </li>
              <li>
                <strong>Product data</strong>: Product titles, descriptions,
                images, and metadata for SEO auditing, AI content generation,
                and image optimization.
              </li>
              <li>
                <strong>Content data</strong>: Pages, blog articles, and
                collections for SEO analysis, broken link detection, and
                internal linking suggestions.
              </li>
              <li>
                <strong>Theme files</strong>: Read-only access to theme
                templates for SEO auditing purposes (e.g. checking for missing
                meta tags in theme code).
              </li>
              <li>
                <strong>Navigation data</strong>: Online store navigation menus
                for internal linking analysis.
              </li>
              <li>
                <strong>File data</strong>: Access to store files for image
                compression features.
              </li>
            </ul>
            <p>
              We do not collect any personal data from your customers. Our app
              operates entirely within the Shopify admin and does not interact
              with your storefront visitors.
            </p>

            <hr />

            <h2>2. How We Use Your Information</h2>
            <p>
              The data we access is used exclusively to provide the features of{" "}
              {APP_NAME}:
            </p>
            <ul>
              <li>
                Running SEO audits and calculating your store's SEO health score
              </li>
              <li>
                Generating AI-powered product descriptions, image alt text, and
                blog posts
              </li>
              <li>Compressing images to improve page load speed</li>
              <li>
                Detecting broken links and suggesting internal linking
                opportunities
              </li>
              <li>
                Managing schema markup (structured data) for your store
              </li>
              <li>Editing meta tags and product descriptions in bulk</li>
              <li>Running scheduled automated SEO scans</li>
            </ul>

            <hr />

            <h2>3. Third-Party Services</h2>
            <p>
              To provide our features, we use the following third-party
              services:
            </p>
            <ul>
              <li>
                <strong>Google Gemini API</strong>: When you use AI content
                generation features (product descriptions, alt text, blog
                posts), the relevant product or topic data is sent to Google's
                Gemini API to generate content. This data is used solely for
                the generation request and is not stored by us beyond the
                response. Google's use of data is governed by their own privacy
                policy.
              </li>
              <li>
                <strong>Vercel</strong>: Our application is hosted on Vercel's
                serverless infrastructure. Vercel processes requests in
                accordance with their privacy policy.
              </li>
              <li>
                <strong>Supabase</strong>: Our database is hosted on Supabase
                (PostgreSQL). Session tokens, audit history, automation
                schedules, and prompt templates are stored here.
              </li>
            </ul>

            <hr />

            <h2>4. Data Storage</h2>
            <p>
              We store the following data in our database to provide app
              functionality:
            </p>
            <ul>
              <li>Session tokens (required by Shopify for app authentication)</li>
              <li>SEO audit snapshots and historical scores</li>
              <li>Store settings and preferences</li>
              <li>Scheduled automation configurations</li>
              <li>Custom AI prompt templates you create</li>
              <li>Broken link scan logs</li>
            </ul>
            <p>
              We do not store your product descriptions, images, or any Shopify
              content beyond what is needed for caching audit results.
            </p>

            <hr />

            <h2>5. Data Sharing</h2>
            <p>
              We do not sell, rent, or share your data with any third parties
              for marketing or advertising purposes. Your data is only shared
              with the third-party service providers listed above, strictly for
              the purpose of providing app functionality.
            </p>

            <hr />

            <h2>6. Data Retention and Deletion</h2>
            <p>
              Your data is retained for as long as the app is installed on your
              Shopify store. When you uninstall {APP_NAME}, we delete all
              associated data from our database, including session tokens, audit
              history, store settings, automation schedules, and prompt
              templates.
            </p>
            <p>
              If you would like your data deleted before uninstalling, you may
              contact us at any time.
            </p>

            <hr />

            <h2>7. Your Rights</h2>
            <p>You have the right to:</p>
            <ul>
              <li>Request access to the data we hold about your store</li>
              <li>Request correction of inaccurate data</li>
              <li>Request deletion of your data</li>
              <li>Export your data in a machine-readable format</li>
            </ul>
            <p>
              To exercise any of these rights, please contact us using the
              information below.
            </p>

            <hr />

            <h2>8. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. When we do,
              we will update the "Last updated" date at the top of this page.
              We encourage you to review this page periodically for any changes.
            </p>

            <hr />

            <h2>9. Contact Us</h2>
            <p>
              If you have any questions about this Privacy Policy or our data
              practices, please contact us at:
            </p>
            <p>
              <strong>{COMPANY}</strong>
              <br />
              Email:{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
            </p>
          </div>

          <footer>
            <p>
              &copy; {new Date().getFullYear()} {COMPANY} &middot;{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
            </p>
          </footer>
        </div>
      </body>
    </html>
  );
}
