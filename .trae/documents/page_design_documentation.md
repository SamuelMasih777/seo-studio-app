# Page Design Documentation: SEO Suite DFD

## 1. Overview
The user interface follows Shopify's Polaris design system to provide a native-feeling experience for Shopify merchants. The layout consists of a main navigation sidebar and a primary content area.

## 2. Layout Structure
- **Navigation:** Left sidebar or top tabs (depending on Shopify App Bridge implementation).
- **Header:** Page title, primary action button (e.g., "Start New Audit"), and a help/support icon.
- **Content Area:** Cards and lists displaying data, charts, and actionable items.

## 3. Core Pages

### 3.1 Dashboard (Overview)
- **Top Section (Hero):** Overall SEO Score (circular progress indicator) from 0-100.
- **Health Indicators Grid:**
  - 4 Cards: Meta Issues, Missing Alt Texts, Broken Links, Duplicate Content.
  - Colors: Green (0 issues), Yellow (1-10 issues), Red (>10 issues).
- **Quick Actions:** "Fix Now" buttons below each health indicator.
- **Module Status:** A list/grid of the 12 modules with toggle switches to enable/disable them.

### 3.2 SEO Audit Dashboard
- **Header:** "Latest SEO Audit Report"
- **Summary Cards:** Score per category (Speed, Content, Meta).
- **Detailed Issues List:**
  - Table showing: Page URL, Issue Type, Severity, Action Button.
  - Action Button: "Fix" (opens a modal or navigates to the specific module).
- **Bulk Fix Option:** A button to select multiple rows and apply a bulk fix.

### 3.3 Meta Tags Manager
- **Layout:** Spreadsheet-style list or paginated cards.
- **List View:**
  - Columns: Product/Page Name, Title Tag, Meta Description, Character Count, AI Generate Button.
- **Editing Mode:**
  - Input fields with character counters (e.g., 50/60 for title, 140/160 for description).
  - SERP Preview: A Google search result mock-up showing how the tags will appear.

### 3.4 Image Optimization
- **Header:** Total images, Unoptimized images, Potential savings.
- **Settings Card:** Lossless vs Lossy toggle, Lazy Loading toggle.
- **Action Area:** "Optimize All" button, or individual "Optimize" buttons per image.

### 3.5 Content Optimization (AI)
- **Inputs:** Dropdown to select a product, text area for target keyword, dropdown for tone (Professional, Casual, Persuasive).
- **Outputs:** Side-by-side comparison of "Original Description" and "AI Optimized Description".
- **Actions:** "Apply Changes" button.

### 3.6 Settings & Billing
- **Subscription Cards:** Free, Basic, Pro, Advanced plans with feature comparisons.
- **API Keys:** Input fields for OpenAI keys (if bring-your-own-key is supported).
- **Automation Settings:** Toggles for scheduled audits and email alerts.

## 4. Design System Tokens
- **Colors:**
  - Primary Action: Shopify Green / Polaris Primary (#008060)
  - Success: Polaris Success (#007f5f)
  - Warning: Polaris Warning (#ffc453)
  - Critical: Polaris Critical (#d82c0d)
  - Background: Polaris Surface (#f4f6f8)
- **Typography:**
  - Inter or system fonts (Shopify default).
  - Clear hierarchy with 16px base text.
- **Components:**
  - Polaris `Card`, `Button`, `Badge`, `DataTable`, `IndexTable`, `ProgressBar`.