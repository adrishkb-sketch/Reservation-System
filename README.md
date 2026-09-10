# CampusPass - College Event Reservation & Ticketing Platform

A production-ready, mobile-first college event reservation platform with modern UI/UX aesthetics, concurrency-safe registration (200+ simultaneous users), 3-switch flexible capacity grouping, physical seat allocation, digital holographic boarding passes, and a universal camera QR check-in scanner.

---

## 🌟 Key Features

- **High-Concurrency Transactional Engine**: Built with Node.js & `better-sqlite3` WAL mode and atomic `db.transaction()` isolation to prevent overbookings, negative availability, and duplicate seat assignments under heavy load (200+ simultaneous requests).
- **3-Switch Flexible Capacity Grouping**: Independent toggles for `Department (ON/OFF)`, `Program (ON/OFF)`, and `Year (ON/OFF)` to dynamically generate and pool capacity.
- **Physical Seat Allocation Studio**: Supports comma-separated seat numbers and ranges (`1-20, 25, 30-35`) with an interactive live visual seat grid.
- **Digital Boarding Pass**: Unpredictable reference numbers (`ADR-YY-XXXXXX`) and cryptographically signed QR codes.
- **Universal Camera QR Scanner**: Admin camera scanner with synthesized audio tones, haptic feedback, and multi-state entry validation (**CHECK-IN SUCCESSFUL**, **ALREADY CHECKED IN**, **INVALID/WAITING**).
- **Attendance & Analytics**: Live check-in rate, department/program/year breakdowns, immutable audit logs, and 1-click CSV export.
- **Full Cascade Event Deletion**: Single-click event deletion with automatic cascade cleanup of all associated registrations, seats, and check-ins.

---

## 🔑 Admin Credentials

- **Admin Portal**: `/admin/index.html`
- **Login ID**: `AdrishRegistrations`
- **Password**: `Adrish_da_real_nigga`

---

## 🚀 Quick Start (Local)

```bash
# Install dependencies
npm install

# Run automated tests (9 invariant suites including 200-user concurrency stress test)
npm test

# Start local server
npm start
```

Visit: `http://localhost:3000`

---

## ☁️ Deployment to Vercel

1. Push this repository to GitHub.
2. Go to [Vercel Dashboard](https://vercel.com/new).
3. Import your GitHub repository: `Reservation-System`.
4. Deploy with default settings. `vercel.json` and `api/index.js` are pre-configured.
