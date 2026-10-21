# Livotel Premium Hotel — Staff Attendance Management System

A production-ready staff attendance management web application custom-built for **Livotel Premium Hotel, Bhubaneswar**.

---

## 🏨 Overview & Architecture

- **Frontend:** React 18, TypeScript, Vite, React Router 6
- **Styling:** Mobile-first, responsive custom design adhering to Livotel brand aesthetics (Navy `#1B2A4A`, White, Emerald Green `#2E7D32`, Coral accents)
- **Logos:** High-resolution Livotel Premium Hotel logos integrated into app header, login screen, and printable reports
- **Backend:** Netlify Functions v2 (`.mts` modules) with standard Web Request/Response APIs
- **Database:** Netlify Database (managed PostgreSQL via `@netlify/database`), zero-config connection in production
- **Migrations:** Version-controlled database migrations in `netlify/database/migrations/`
- **Security:** bcrypt password hashing (12 rounds), JWT sessions (24h expiry), role-based server-side authorization on every protected API endpoint, parameterized SQL queries preventing SQL injection, and formula injection protection for CSV exports

---

## 👥 Roles & Permissions

| Capability | Owner / Admin | Manager |
|---|:---:|:---:|
| View Staff List | ✅ | ✅ |
| Add / Edit / Deactivate Staff | ✅ | ❌ |
| Mark & Correct Attendance | ✅ | ✅ (unlocked months only) |
| View Summaries & Monthly Reports | ✅ | ✅ |
| Export CSV & Print Reports | ✅ | ✅ |
| Lock Completed Months | ✅ | ❌ |
| Unlock Locked Months | ✅ | ❌ |
| Invite Managers & Manage Accounts | ✅ | ❌ |
| View Complete Audit Log | ✅ | ❌ |
| Check Database System Health | ✅ | ❌ |

---

## 🚀 Quick Nontechnical Deployment Guide

### Option 1: Deploy with Git (Recommended)

1. **Push this folder to a Git repository** (GitHub or GitLab):
   ```bash
   git init
   git add .
   git commit -m "Initial commit of Livotel Attendance system"
   git remote add origin https://github.com/your-username/livotel-attendance.git
   git branch -M main
   git push -u origin main
   ```

2. **Connect to Netlify:**
   - Log in to your [Netlify Dashboard](https://app.netlify.com).
   - Click **Add new site** → **Import an existing project** → Select your Git repository.
   - Netlify will automatically detect `netlify.toml` and configure:
     - **Build command:** `npm run build`
     - **Publish directory:** `dist`
     - **Functions directory:** `netlify/functions`

3. **Enable Netlify Database:**
   - In your Netlify site dashboard, navigate to the **Database** tab and enable **Netlify Database (PostgreSQL)**.
   - Netlify automatically provisions the managed Postgres database and executes migrations located in `netlify/database/migrations/`.

4. **Set your Environment Variable:**
   - Go to **Site Configuration** → **Environment variables**.
   - Add `JWT_SECRET`: A long random string (e.g. `e5a7b8c9d0...`).
     *(Generate with: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`)*

5. **Deploy Site:**
   - Click **Deploy site**. Both your frontend and serverless backend functions deploy simultaneously.

---

### Option 2: Deploy using Netlify CLI

If you have the Netlify CLI installed:
```bash
# 1. Login to Netlify
npx netlify login

# 2. Link or create a new site
npx netlify init

# 3. Provision the Netlify Database
npx netlify database init

# 4. Set the secret
npx netlify env:set JWT_SECRET "your-long-random-secret-string"

# 5. Deploy to production
npx netlify deploy --build --prod
```

---

## 🔑 Initial Setup: Creating the First Owner Account

When the site is deployed for the very first time, the database has zero users.

1. Open your deployed website URL in any browser.
2. The app detects that no accounts exist and automatically opens the **First-Time Setup** screen.
3. Enter your details:
   - **Full Name** (e.g., *Pradipta Kumar Ray*)
   - **Email** (e.g., *owner@livotelhotel.com*)
   - **Password** (minimum 8 characters)
4. Click **Create Owner Account**.
5. Once submitted:
   - The setup endpoint locks permanently against any further public signups.
   - You are immediately signed in with the **Owner** role.

---

## ✉️ Inviting Your Hotel Manager (Invitation-Only)

Staff and managers cannot register publicly. Only you (the Owner) can invite managers:

1. Log in to your Owner account.
2. Click **Settings** in the navigation bar.
3. Select the **Team & Access** tab.
4. Under **Invite New Team Member**:
   - Enter the Manager's **Full Name** and **Email Address**.
   - Select **Manager** role.
   - Click **Generate Invitation Link**.
5. A unique, secure invitation link will appear (valid for 7 days).
6. Click **Copy Link** and send it directly to your manager (via WhatsApp, SMS, or email).
7. When the manager clicks the link, they choose their password and sign in immediately.

---

## 📋 Daily Attendance Workflow

1. **Default View:** The app automatically opens to today's date in **Asia/Kolkata** (IST).
2. **Staff Display:** Shows all staff actively employed on that date.
3. **Status Selection:** Choose from:
   - **Present (P)**
   - **Absent (A)**
   - **Half Day (HD)**
   - **Weekly Off (WO)**
   - **Paid Leave (PL)**
   - **Unpaid Leave (UL)**
   - *(Unset staff remain explicitly **Not Marked** and are never assumed absent).*
4. **Shifts & Overnight Work:**
   - Optional Shift name (e.g., *Morning, Evening, Night*).
   - Check-in and check-out datetime pickers.
   - **Overnight Shifts:** When check-in is at 22:00 (10 PM) and check-out is at 06:30 (6:30 AM) the next calendar day, duration is computed as 8.5 hours. Attendance belongs to the shift's starting date.
5. **Mark All Present (Draft):** Quickly drafts all unmarked staff as Present without immediately saving.
6. **Unsaved Indicator:** A prominent banner appears at the bottom indicating unsaved changes.
7. **Explicit Save:** Clicking **Save Attendance** securely commits the updates to PostgreSQL.
8. **Correction Reasons:** If you modify an already saved attendance entry, the system asks for an audit reason before saving.

---

## 🔒 Month Locks & Concurrency Protection

- **Month Locks:** When a calendar month ends, the Owner can lock it from **Settings** → **Month Locks**. Once locked:
  - Managers cannot edit or alter attendance records for that month.
  - The Owner must explicitly unlock the month before making corrections.
- **Optimistic Concurrency:** If two devices edit the same employee's record simultaneously, the server detects version mismatch and prevents silent overwriting, notifying the user to reload the latest record.

---

## 📊 Monthly Reports & CSV Export

- **Calendar Matrix:** Visual monthly table with days 1–31 as columns and staff as rows.
- **Color Swatches & Abbreviations:** P, A, HD, WO, PL, UL, and distinct indicators for Not Marked vs. Not Employed.
- **Recorded Hours:** Totals completed shift durations without inventing hours for missing stamps.
- **CSV Export:** Downloads a formatted spreadsheet with built-in formula injection protection (neutralizes spreadsheet formulas like `=SUM()`).
- **Print View:** Formats a clean, printable document containing the Livotel Hotel header, monthly totals, and signature areas.

---

## 🧪 Verification & Automated Test Results

The application includes automated unit and integration tests covering business rules and invariants:

```bash
npm test
```

### Test Results:
- ✓ **Calculate Hours:** Normal 8-hour daytime shifts correctly computed.
- ✓ **Overnight Shifts:** Shifts spanning past midnight (e.g. 22:00 to 06:30) calculate accurately as 8.5 hours.
- ✓ **Missing Timestamps:** Returns `null` without inventing fictional hours.
- ✓ **Not Marked vs. Absent:** Distinct status guarantees unmarked staff are never recorded as absent.
- ✓ **Employment Boundaries:** Rejects attendance entries prior to employee joining date or past leaving date.
- ✓ **Spreadsheet Injection Protection:** Protects against formula injection characters (`=`, `+`, `-`, `@`, `\t`, `\r`).
- ✓ **Role Authorization:** Verified that Managers are forbidden from modifying staff records, locking/unlocking months, and managing user accounts.
- ✓ **Optimistic Concurrency:** Confirmed conflict detection prevents silent overwrites.

```
 Test Files  2 passed (2)
      Tests  28 passed (28)
```
