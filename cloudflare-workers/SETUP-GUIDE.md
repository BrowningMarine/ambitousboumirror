# Cloudflare Worker Load Balancer - Complete Setup Guide

This guide will help you set up a load balancer for your 2 API routes between Vietnam and Singapore servers.

## What You're Setting Up

**Goal**: Load balance only these 2 routes:
- `/api/orders/*` 
- `/api/webhook/payment/*`

**Your Servers**:
- Vietnam: `https://apivn.yourdomain.com` (Appwrite, full mode)
- Singapore: `https://apisg.yourdomain.com` (Supabase, client-only mode)

**Access Pattern**:
- Staff uses: `https://admin.yourdomain.com` (direct to Vietnam, no load balancer)
- API uses: `https://api.yourdomain.com` (load balanced entry point)

---

## Step 1: Choose Your Load Balancer Version

### Option A: Simple Round-Robin (Recommended for Start)
- No KV namespace needed
- Simple alternating between servers
- Good for testing

**Use file**: `api-load-balancer-simple.js`

### Option B: Advanced with Health Checks & Metrics
- Requires KV namespace
- Tracks server health
- Collects metrics
- Better for production

**Use file**: `load-balancer.js`

---

## Step 2: Create Cloudflare Worker (Web Console)

### 2.1 Go to Workers Dashboard
1. Login to https://dash.cloudflare.com
2. Click **Workers & Pages** in left sidebar
3. Click **Create Application** button
4. Click **Create Worker**

### 2.2 Configure Worker
1. **Name**: `api-load-balancer` (or any name you want)
2. Click **Deploy** (we'll edit code next)
3. Click **Edit Code** button

### 2.3 Paste Your Code

**If using Simple version (Option A)**:
1. Open `cloudflare-workers/api-load-balancer-simple.js`
2. Copy ALL the code
3. Replace EVERYTHING in Cloudflare editor
4. Find line ~8-9 and update your domains:
   ```javascript
   const SERVERS = [
     'https://apivn.yourdomain.com',  // ← Change to your Vietnam domain
     'https://apisg.yourdomain.com'   // ← Change to your Singapore domain
   ];
   ```
5. Click **Save and Deploy**

**If using Advanced version (Option B)**:
1. First create KV namespace (see Step 3 below)
2. Open `cloudflare-workers/load-balancer.js`
3. Copy ALL the code
4. Replace EVERYTHING in Cloudflare editor
5. Update domains (line ~25-30):
   ```javascript
   const SERVERS = [
     { url: 'https://apivn.yourdomain.com', region: 'vn', priority: 1 },
     { url: 'https://apisg.yourdomain.com', region: 'sg', priority: 1 }
   ];
   ```
6. Click **Save and Deploy**

---

## Step 3: Create KV Namespace (Only for Option B)

### 3.1 Create KV
1. In Cloudflare dashboard, go to **Workers & Pages**
2. Click **KV** in left menu
3. Click **Create a namespace**
4. Name: `LOAD_BALANCER` (exactly this name)
5. Click **Add**

### 3.2 Bind KV to Worker
1. Go back to your worker (`api-load-balancer`)
2. Click **Settings** tab
3. Scroll to **Variables and Secrets**
4. Under **KV Namespace Bindings**, click **Add binding**
5. Variable name: `LOAD_BALANCER` (must match the name in code)
6. KV namespace: Select `LOAD_BALANCER` from dropdown
7. Click **Save**

---

## Step 4: Add Custom Domain

### 4.1 Add Route
1. In your worker page, click **Settings** tab
2. Click **Triggers** in the menu
3. Under **Routes**, click **Add route**
4. Enter: `api.yourdomain.com/*` (change to your domain)
5. Zone: Select your domain from dropdown
6. Click **Add route**

### 4.2 DNS Setup
1. Go to **DNS** in Cloudflare dashboard
2. Find or create: `api.yourdomain.com`
3. Make sure it's **Proxied** (orange cloud ☁️ ON)
4. Can point to any IP (will be overridden by Worker)

**Example DNS**:
```
Type: A
Name: api
Content: 192.0.2.1 (or any IP)
Proxy: ON (orange cloud)
```

---

## Step 5: Test Your Setup

### 5.1 Test Load Balancer is Working
```bash
# Should return from Vietnam or Singapore
curl https://api.yourdomain.com/api/health

# Try multiple times - should alternate servers
curl https://api.yourdomain.com/api/health
curl https://api.yourdomain.com/api/health
curl https://api.yourdomain.com/api/health
```

Response should include server region:
```json
{
  "status": "healthy",
  "region": "vn",  // or "sg"
  "timestamp": "..."
}
```

### 5.2 Test Routes are Load Balanced
```bash
# These should be load balanced
curl https://api.yourdomain.com/api/orders/test-order-123
curl https://api.yourdomain.com/api/webhook/payment/test
```

### 5.3 Test Other Routes Passthrough
```bash
# These should NOT be load balanced (go straight through)
curl https://api.yourdomain.com/api/merchants
curl https://api.yourdomain.com/api/banks
```

### 5.4 Verify Direct Access Still Works
```bash
# Staff should still access Vietnam directly
curl https://apivn.yourdomain.com/api/health
curl https://admin.yourdomain.com/api/health
```

---

## Step 6: Monitor (Advanced Version Only)

If you used Option B (Advanced), check metrics:

```bash
# View metrics
curl https://api.yourdomain.com/__admin/metrics

# View server health
curl https://api.yourdomain.com/__admin/health
```

---

## Troubleshooting

### Worker not responding
- Check Routes are added correctly
- Verify DNS has orange cloud ON
- Wait 1-2 minutes for propagation

### "KV namespace not found" error
- Make sure KV binding name matches exactly: `LOAD_BALANCER`
- Binding must be added in Worker Settings → Variables

### All requests go to one server
- Simple version: Working as designed (alternates)
- Advanced version: Check health endpoint, one server might be down

### 500 errors
- Check Worker logs: Workers → your worker → Logs
- Verify server URLs are correct (https:// included)
- Check your backend servers are responding

### CORS errors
- Worker preserves CORS headers from backend
- If issues persist, check backend CORS settings

---

## Quick Reference

**What's Load Balanced**:
- ✅ `/api/orders/*`
- ✅ `/api/webhook/payment/*`

**What's NOT Load Balanced** (passthrough):
- ❌ `/api/merchants/*`
- ❌ `/api/banks/*`
- ❌ All other routes

**Server Priority**:
- Both servers equal priority
- Simple: Round-robin alternating
- Advanced: Health-check based routing

**Direct Access** (bypasses load balancer):
- Staff: `admin.yourdomain.com` → Vietnam only
- Testing: `apivn.yourdomain.com` or `apisg.yourdomain.com`

---

## Summary

1. **Choose version**: Simple (no KV) or Advanced (with KV)
2. **Create Worker** in Cloudflare dashboard
3. **Paste code** and update your domain names
4. **Create KV** (if using Advanced)
5. **Add route** `api.yourdomain.com/*`
6. **Setup DNS** with proxy ON
7. **Test** with curl commands

That's it! Your load balancer is ready. 🚀

---

## Need Help?

- Check Worker Logs for errors
- Verify both backend servers return valid responses
- Test health endpoints: `/api/health` on both servers
- Make sure middleware allows the routes to work
