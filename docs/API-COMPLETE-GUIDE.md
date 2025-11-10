# Complete API Guide - Payment Gateway System

## Table of Contents
1. [Overview](#overview)
2. [Order Creation API](#order-creation-api)
3. [Webhook Payment API](#webhook-payment-api)
4. [Webhook Callback (Merchant Notifications)](#webhook-callback-merchant-notifications)
5. [Database Modes](#database-modes)
6. [Webhook Batching](#webhook-batching)
7. [Fallback Mode](#fallback-mode)
8. [Postman Collection](#postman-collection)

---

## Overview

This payment gateway system handles:
- **Deposit Orders**: Customer pays merchant
- **Withdraw Orders**: Merchant pays customer
- **Webhook Processing**: Receives payment notifications from banks/portals
- **Merchant Callbacks**: Notifies merchants when payments complete
- **Batching**: Groups multiple orders with same callback URL into one request

---

## Order Creation API

### Endpoint
```
POST /api/orders/{publicTransactionId}
```

### Headers
```
Content-Type: application/json
x-api-key: your-merchant-api-key
```

### Request Body (Deposit Order)
```json
{
  "merchantOrdId": "MERCHANT-ORD-001",
  "odrType": "deposit",
  "amount": 500000,
  "urlSuccess": "https://yoursite.com/success",
  "urlFailed": "https://yoursite.com/failed",
  "urlCanceled": "https://yoursite.com/canceled",
  "urlCallBack": "https://webhook.site/your-unique-id"
}
```

### Request Body (Withdraw Order)
```json
{
  "merchantOrdId": "MERCHANT-WD-001",
  "odrType": "withdraw",
  "amount": 1000000,
  "bankReceiveNumber": "1234567890",
  "bankReceiveOwnerName": "Customer Name",
  "bankCode": "970422",
  "urlSuccess": "https://yoursite.com/success",
  "urlFailed": "https://yoursite.com/failed",
  "urlCanceled": "https://yoursite.com/canceled",
  "urlCallBack": "https://webhook.site/your-unique-id"
}
```

### Response (Success)
```json
{
  "success": true,
  "message": "Order created successfully",
  "data": {
    "odrId": "ABO202511050EQ1VL9",
    "merchantOrdId": "MERCHANT-ORD-001",
    "odrType": "deposit",
    "odrStatus": "pending",
    "amount": 500000,
    "paidAmount": 0,
    "unPaidAmount": 500000,
    "qrCode": "data:image/png;base64,...",
    "urlSuccess": "https://yoursite.com/success",
    "urlCallBack": "https://webhook.site/your-unique-id",
    "bankInfo": {
      "bankName": "MB Bank",
      "accountNumber": "0123456789",
      "accountName": "COMPANY NAME"
    },
    "createdAt": "2025-11-05 10:30:00"
  }
}
```

### CURL Command (Deposit)
```bash
curl --location 'http://localhost:3000/api/orders/TXN123456' \
--header 'Content-Type: application/json' \
--header 'x-api-key: your-api-key-here' \
--data '{
  "merchantOrdId": "MERCHANT-ORD-001",
  "odrType": "deposit",
  "amount": 500000,
  "urlSuccess": "https://yoursite.com/success",
  "urlFailed": "https://yoursite.com/failed",
  "urlCanceled": "https://yoursite.com/canceled",
  "urlCallBack": "https://webhook.site/d332ea4c-53bf-476e-8ffa-b0c666ea134d"
}'
```

### CURL Command (Withdraw)
```bash
curl --location 'http://localhost:3000/api/orders/TXN123456' \
--header 'Content-Type: application/json' \
--header 'x-api-key: your-api-key-here' \
--data '{
  "merchantOrdId": "MERCHANT-WD-001",
  "odrType": "withdraw",
  "amount": 1000000,
  "bankReceiveNumber": "1234567890",
  "bankReceiveOwnerName": "Customer Name",
  "bankCode": "970422",
  "urlSuccess": "https://yoursite.com/success",
  "urlFailed": "https://yoursite.com/failed",
  "urlCanceled": "https://yoursite.com/canceled",
  "urlCallBack": "https://webhook.site/d332ea4c-53bf-476e-8ffa-b0c666ea134d"
}'
```

---

## Bulk Order Creation API

Create multiple orders in a single request for improved performance.

### ⚠️ IMPORTANT RESTRICTIONS

**Bulk orders are ONLY allowed for WITHDRAWALS:**
- ✅ Bulk withdrawal orders: **ALLOWED** (2-300 orders per request)
- ❌ Bulk deposit orders: **NOT ALLOWED** (must be created individually)
- ❌ Mixed orders (deposits + withdrawals): **NOT ALLOWED**

**Why deposits can't be bulk created:**
Each deposit requires a unique QR code and bank account assignment for payment tracking. Deposits must be processed individually to ensure proper payment routing and transaction monitoring.

### Endpoint
```
POST /api/orders/{publicTransactionId}
```

### Headers
```
Content-Type: application/json
x-api-key: your-merchant-api-key
```

### Request Body Format Options

**Option 1: Simple Array (Most Common)**
```json
[
  {
    "merchantOrdId": "MERCHANT-WD-001",
    "odrType": "withdraw",
    "amount": 500000,
    "bankReceiveNumber": "1234567890",
    "bankReceiveOwnerName": "NGUYEN VAN A",
    "bankCode": "970422",
    "urlSuccess": "https://yoursite.com/success",
    "urlFailed": "https://yoursite.com/failed",
    "urlCanceled": "https://yoursite.com/canceled",
    "urlCallBack": "https://webhook.site/your-unique-id"
  },
  {
    "merchantOrdId": "MERCHANT-WD-002",
    "odrType": "withdraw",
    "amount": 750000,
    "bankReceiveNumber": "9876543210",
    "bankReceiveOwnerName": "TRAN THI B",
    "bankCode": "970415",
    "urlSuccess": "https://yoursite.com/success",
    "urlFailed": "https://yoursite.com/failed",
    "urlCanceled": "https://yoursite.com/canceled",
    "urlCallBack": "https://webhook.site/your-unique-id"
  }
]
```

**Option 2: Object with Orders Array + Global Settings (Reduces Duplication)**
```json
{
  "globalUrlSuccess": "https://yoursite.com/success",
  "globalUrlFailed": "https://yoursite.com/failed",
  "globalUrlCanceled": "https://yoursite.com/canceled",
  "globalUrlCallBack": "https://webhook.site/your-unique-id",
  "orders": [
    {
      "merchantOrdId": "MERCHANT-WD-001",
      "odrType": "withdraw",
      "amount": 500000,
      "bankReceiveNumber": "1234567890",
      "bankReceiveOwnerName": "NGUYEN VAN A",
      "bankCode": "970422"
    },
    {
      "merchantOrdId": "MERCHANT-WD-002",
      "odrType": "withdraw",
      "amount": 750000,
      "bankReceiveNumber": "9876543210",
      "bankReceiveOwnerName": "TRAN THI B",
      "bankCode": "970415"
    }
  ]
}
```

**Note:** Individual orders can override global settings by specifying their own URLs.

### Required Fields for Withdrawal Orders

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `merchantOrdId` | string | Optional | Your internal order ID |
| `odrType` | string | **Required** | Must be `"withdraw"` for bulk orders |
| `amount` | number | **Required** | Amount in VND (max 13 digits) |
| `bankReceiveNumber` | string | **Required** | Account number (5-19 alphanumeric, no spaces) |
| `bankReceiveOwnerName` | string | **Required** | Account holder name (letters, spaces, apostrophes only) |
| `bankCode` | string | **Required** | Bank BIN code (e.g., "970422" for MB Bank) |
| `urlSuccess` | string | Optional | Success redirect URL (can use global) |
| `urlFailed` | string | Optional | Failed redirect URL (can use global) |
| `urlCanceled` | string | Optional | Canceled redirect URL (can use global) |
| `urlCallBack` | string | **Required** | Webhook URL for status updates (can use global) |

### Response (Bulk Success)
```json
{
  "success": true,
  "message": "All 2 orders created successfully",
  "total": 2,
  "successful": 2,
  "failed": 0,
  "results": [
    {
      "success": true,
      "message": "Withdraw order created successfully",
      "data": {
        "odrId": "ABO202511054Q3PA7S",
        "odrStatus": "pending",
        "bankReceiveNumber": "1234567890",
        "bankReceiveOwnerName": "NGUYEN VAN A",
        "amount": 500000,
        "timestamp": "2025-11-05 14:30:25"
      }
    },
    {
      "success": true,
      "message": "Withdraw order created successfully",
      "data": {
        "odrId": "ABO20251105MV5H2V8",
        "odrStatus": "pending",
        "bankReceiveNumber": "9876543210",
        "bankReceiveOwnerName": "TRAN THI B",
        "amount": 750000,
        "timestamp": "2025-11-05 14:30:25"
      }
    }
  ]
}
```

### CURL Command (Bulk Withdrawals - Simple Array)
```bash
curl --location 'http://localhost:3000/api/orders/TXN123456' \
--header 'Content-Type: application/json' \
--header 'x-api-key: your-api-key-here' \
--data '[
  {
    "merchantOrdId": "MERCHANT-WD-001",
    "odrType": "withdraw",
    "amount": 500000,
    "bankReceiveNumber": "1234567890",
    "bankReceiveOwnerName": "NGUYEN VAN A",
    "bankCode": "970422",
    "urlSuccess": "https://yoursite.com/success",
    "urlFailed": "https://yoursite.com/failed",
    "urlCanceled": "https://yoursite.com/canceled",
    "urlCallBack": "https://webhook.site/d332ea4c-53bf-476e-8ffa-b0c666ea134d"
  },
  {
    "merchantOrdId": "MERCHANT-WD-002",
    "odrType": "withdraw",
    "amount": 750000,
    "bankReceiveNumber": "9876543210",
    "bankReceiveOwnerName": "TRAN THI B",
    "bankCode": "970415",
    "urlSuccess": "https://yoursite.com/success",
    "urlFailed": "https://yoursite.com/failed",
    "urlCanceled": "https://yoursite.com/canceled",
    "urlCallBack": "https://webhook.site/d332ea4c-53bf-476e-8ffa-b0c666ea134d"
  }
]'
```

### CURL Command (Bulk Withdrawals - With Global Settings)
```bash
curl --location 'http://localhost:3000/api/orders/TXN123456' \
--header 'Content-Type: application/json' \
--header 'x-api-key: your-api-key-here' \
--data '{
  "globalUrlSuccess": "https://yoursite.com/success",
  "globalUrlFailed": "https://yoursite.com/failed",
  "globalUrlCanceled": "https://yoursite.com/canceled",
  "globalUrlCallBack": "https://webhook.site/d332ea4c-53bf-476e-8ffa-b0c666ea134d",
  "orders": [
    {
      "merchantOrdId": "MERCHANT-WD-001",
      "odrType": "withdraw",
      "amount": 500000,
      "bankReceiveNumber": "1234567890",
      "bankReceiveOwnerName": "NGUYEN VAN A",
      "bankCode": "970422"
    },
    {
      "merchantOrdId": "MERCHANT-WD-002",
      "odrType": "withdraw",
      "amount": 750000,
      "bankReceiveNumber": "9876543210",
      "bankReceiveOwnerName": "TRAN THI B",
      "bankCode": "970415"
    }
  ]
}'
```

### Bulk Order Features & Limits

**Performance Benefits:**
- ✅ Create multiple withdrawals in one API call
- ✅ Reduced network overhead (1 request instead of many)
- ✅ Automatic smart routing based on order count:
  - **2-20 orders**: Parallel processing (all at once)
  - **21-100 orders**: Batched processing (groups of 10)
  - **101-300 orders**: Conservative batched (groups of 5)
- ✅ Detailed per-order success/failure reporting
- ✅ Partial success support (some succeed, some fail)

**Security & Rate Limits:**
- **Maximum Orders**: 300 orders per request
- **Rate Limit**: 15 bulk requests per minute per merchant
- **Order Types**: Withdrawals ONLY (deposits not allowed in bulk)
- **IP Validation**: Must be whitelisted in merchant account
- **Balance**: No pre-check (credit line model - negative balance allowed)

**Processing Strategies:**
The system automatically chooses the best strategy:
- `single-optimized`: 1 order (ultra-fast path)
- `parallel-optimized`: 2-20 orders (all processed simultaneously)
- `batched-optimized`: 21-100 orders (groups of 10)
- `conservative-batched`: 101-300 orders (groups of 5)

**Error Handling:**
If some orders fail, successful ones are still created:
```json
{
  "success": false,
  "message": "1 of 2 orders created successfully, 1 failed",
  "total": 2,
  "successful": 1,
  "failed": 1,
  "results": [
    {
      "success": true,
      "message": "Withdraw order created successfully",
      "data": {
        "odrId": "ABO202511054Q3PA7S",
        "odrStatus": "pending",
        "bankReceiveNumber": "1234567890",
        "bankReceiveOwnerName": "NGUYEN VAN A",
        "amount": 500000,
        "timestamp": "2025-11-05 14:30:25"
      }
    },
    {
      "success": false,
      "message": "bankReceiveNumber must contain only letters and numbers, be 5-19 characters long, and contain no spaces",
      "merchantOrdId": "MERCHANT-WD-002"
    }
  ]
}
```

### Common Errors

**1. Bulk deposits not allowed (400 Bad Request)**
```json
{
  "success": false,
  "message": "Bulk orders are only allowed for withdrawals. Deposits must be created one at a time. Please separate deposit orders into individual requests."
}
```

**2. Mixed order types (400 Bad Request)**
```json
{
  "success": false,
  "message": "Bulk requests must contain orders of the same type. Found mixed deposit and withdraw orders."
}
```

**3. Rate limit exceeded (429 Too Many Requests)**
```json
{
  "success": false,
  "message": "Rate limit exceeded. Maximum 15 bulk requests per minute allowed.",
  "rateLimit": {
    "limit": 15,
    "remaining": 0,
    "resetTime": "2025-11-05T14:31:00.000Z",
    "retryAfterSeconds": 45
  }
}
```

**4. Too many orders (400 Bad Request)**
```json
{
  "success": false,
  "message": "Too many orders in request. Maximum allowed: 300, received: 350"
}
```

---

## Webhook Payment API

This endpoint receives payment notifications from bank portals (Cassoflow, Sepay, SecretAgent).

### Endpoint
```
POST /api/webhook/payment/{portal}
```

Supported portals:
- `cassoflow` - Cassoflow payment gateway
- `sepay` - Sepay payment gateway  
- `secretagent` - SecretAgent payment gateway

### Authentication

**Cassoflow:**
```
Header: X-Casso-Signature
Format: t=timestamp,v1=signature
```

**Sepay:**
```
Header: Authorization
Format: Bearer {token}
```

**SecretAgent:**
```
Header: secretkey
Value: your-secret-key
```

### Request Body (SecretAgent - Single Transaction)
```json
[
  {
    "id": 1234567,
    "id_bank": "MB01",
    "transactiondate": "2025-11-05 10:30:00",
    "bank_name": "MB Bank",
    "accountNumber": "0123456789",
    "amount": 500000,
    "content": "THANH TOAN ABO202511050EQ1VL9",
    "odrId": "ABO202511050EQ1VL9",
    "odrType": "deposit",
    "refAccoutNumber": "9876543210",
    "refAccountOwnerName": "NGUYEN VAN A",
    "balance": 10000000
  }
]
```

### Request Body (SecretAgent - Bulk Transactions)
```json
[
  {
    "id": 1234567,
    "accountNumber": "0123456789",
    "amount": 500000,
    "content": "THANH TOAN ABO202511050EQ1VL9",
    "odrId": "ABO202511050EQ1VL9",
    "odrType": "deposit",
    "balance": 10000000
  },
  {
    "id": 1234568,
    "accountNumber": "0123456789",
    "amount": 500000,
    "content": "THANH TOAN ABO20251105MV5H2V8",
    "odrId": "ABO20251105MV5H2V8",
    "odrType": "deposit",
    "balance": 10500000
  },
  {
    "id": 1234569,
    "accountNumber": "0123456789",
    "amount": 500000,
    "content": "THANH TOAN ABO202511054Q3PA7S",
    "odrId": "ABO202511054Q3PA7S",
    "odrType": "deposit",
    "balance": 11000000
  }
]
```

### Response
```json
{
  "success": true,
  "message": "Processed 3 transactions: 3 successful, 0 failed",
  "processingMode": {
    "mode": "bulk",
    "transactionCount": 3,
    "dataFormat": "array",
    "supportsBoth": false
  },
  "summary": {
    "total": 3,
    "successful": 3,
    "failed": 0,
    "duplicates": 0,
    "unlinked": 0
  },
  "webhooksSent": {
    "totalCallbacks": 1,
    "uniqueUrls": 1,
    "totalOrders": 3,
    "batchingEnabled": true
  },
  "performance": {
    "totalTime": 4841,
    "transactionsPerSecond": 0.62
  }
}
```

### CURL Command (Single Transaction Test)
```bash
curl --location 'http://localhost:3000/api/webhook/payment/secretAgent' \
--header 'Content-Type: application/json' \
--header 'secretkey: your-secret-key' \
--data '[
  {
    "id": 1234567,
    "id_bank": "MB01",
    "transactiondate": "2025-11-05 10:30:00",
    "bank_name": "MB Bank",
    "accountNumber": "0123456789",
    "amount": 500000,
    "content": "THANH TOAN ABO202511050EQ1VL9",
    "odrId": "ABO202511050EQ1VL9",
    "odrType": "deposit",
    "refAccoutNumber": "9876543210",
    "refAccountOwnerName": "NGUYEN VAN A",
    "balance": 10000000
  }
]'
```

### CURL Command (Bulk Transactions Test)
```bash
curl --location 'http://localhost:3000/api/webhook/payment/secretAgent' \
--header 'Content-Type: application/json' \
--header 'secretkey: your-secret-key' \
--data '[
  {
    "id": 1234567,
    "id_bank": "MB01",
    "transactiondate": "2025-11-05 10:30:00",
    "bank_name": "MB Bank",
    "accountNumber": "0123456789",
    "amount": 500000,
    "content": "THANH TOAN ABO202511050EQ1VL9",
    "odrId": "ABO202511050EQ1VL9",
    "odrType": "deposit",
    "refAccoutNumber": "9876543210",
    "refAccountOwnerName": "NGUYEN VAN A",
    "balance": 10000000
  },
  {
    "id": 1234568,
    "id_bank": "MB01",
    "transactiondate": "2025-11-05 10:31:00",
    "bank_name": "MB Bank",
    "accountNumber": "0123456789",
    "amount": 500000,
    "content": "THANH TOAN ABO20251105MV5H2V8",
    "odrId": "ABO20251105MV5H2V8",
    "odrType": "deposit",
    "refAccoutNumber": "9876543210",
    "refAccountOwnerName": "NGUYEN VAN A",
    "balance": 10500000
  },
  {
    "id": 1234569,
    "id_bank": "MB01",
    "transactiondate": "2025-11-05 10:32:00",
    "bank_name": "MB Bank",
    "accountNumber": "0123456789",
    "amount": 500000,
    "content": "THANH TOAN ABO202511054Q3PA7S",
    "odrId": "ABO202511054Q3PA7S",
    "odrType": "deposit",
    "refAccoutNumber": "9876543210",
    "refAccountOwnerName": "NGUYEN VAN A",
    "balance": 11000000
  }
]'
```

---

## Webhook Callback (Merchant Notifications)

After processing payments, the system sends webhook notifications to merchants.

### What Merchant Receives

**Single Order (Non-batched):**
```json
{
  "odrId": "ABO202511050EQ1VL9",
  "merchantOrdId": "MERCHANT-ORD-001",
  "orderType": "deposit",
  "odrStatus": "completed",
  "bankReceiveNumber": "0123456789",
  "bankReceiveOwnerName": "COMPANY NAME",
  "amount": 500000
}
```

**Bulk Orders (Batched - Same Callback URL):**
```json
[
  {
    "odrId": "ABO202511050EQ1VL9",
    "merchantOrdId": "MERCHANT-ORD-001",
    "orderType": "deposit",
    "odrStatus": "completed",
    "bankReceiveNumber": "0123456789",
    "bankReceiveOwnerName": "COMPANY NAME",
    "amount": 500000
  },
  {
    "odrId": "ABO20251105MV5H2V8",
    "merchantOrdId": "MERCHANT-ORD-002",
    "orderType": "deposit",
    "odrStatus": "completed",
    "bankReceiveNumber": "0123456789",
    "bankReceiveOwnerName": "COMPANY NAME",
    "amount": 500000
  },
  {
    "odrId": "ABO202511054Q3PA7S",
    "merchantOrdId": "MERCHANT-ORD-003",
    "orderType": "deposit",
    "odrStatus": "completed",
    "bankReceiveNumber": "0123456789",
    "bankReceiveOwnerName": "COMPANY NAME",
    "amount": 500000
  }
]
```

### Merchant Webhook Endpoint Requirements

Your `urlCallBack` endpoint should:
1. Accept POST requests
2. Return 200 status code for success
3. Process webhook within 5 seconds
4. Handle both single object and array formats

**Example Merchant Endpoint:**
```javascript
// Express.js example
app.post('/webhook/payment', (req, res) => {
  const data = req.body;
  
  // Handle both single and bulk
  const orders = Array.isArray(data) ? data : [data];
  
  orders.forEach(order => {
    console.log(`Payment received for ${order.odrId}: ${order.amount}`);
    // Update your database, send email, etc.
  });
  
  res.status(200).json({ success: true });
});
```

---

## Database Modes

Configure in `lib/json/appconfig.json`:

```json
{
  "coreRunningMode": "appwrite"
}
```

### Available Modes

**1. Appwrite Mode** (Default)
```json
"coreRunningMode": "appwrite"
```
- Uses Appwrite database only
- High performance
- Fails if Appwrite is down

**2. Auto Mode** (Recommended for Production)
```json
"coreRunningMode": "auto"
```
- Tries Appwrite first
- Falls back to Supabase if Appwrite fails
- Best reliability

**3. Supabase Mode**
```json
"coreRunningMode": "supabase"
```
- Uses Supabase database only
- Slower than Appwrite
- Good for backup/testing

**4. Fallback Mode**
```json
"coreRunningMode": "fallback"
```
- No database writes (emergency mode)
- Uses Redis/LRU cache only
- Orders stored in memory/cache temporarily
- Webhooks still work using cached data

---

## Webhook Batching

### Configuration

Enable/disable batching in `lib/json/appconfig.json`:

```json
{
  "webhookSettings": {
    "enableCallbackBatching": true
  }
}
```

### How It Works

**Batching Enabled (Default):**
- Groups orders by `urlCallBack`
- Sends 1 request per unique URL
- **ALWAYS array format** (even for single orders - consistency!)
- Single order: `[{...}]` (array with 1 item)
- Multiple orders: `[{...}, {...}, {...}]` (array with N items)

**Example:**
```
3 orders with callback: https://webhook.site/abc123
→ 1 webhook request with array[3]

1 order with callback: https://webhook.site/def456
→ 1 webhook request with array[1] ← Still an array!
```

**Batching Disabled:**
- Sends separate request for each order
- Always object format (not array)
- More webhook requests
- Backward compatible

### Console Logs

**With Batching:**
```
🔄 [Batching Mode] Grouping 3 orders by callback URL
📊 [Batching Mode] Found 1 unique callback URLs
📦 [Batching Mode] Sent bulk webhook to https://webhook.site/... with 3 orders in ONE request
```

**Without Batching:**
```
🔀 [Parallel Mode] Sending 3 webhooks separately
📤 [Parallel Mode] Sent webhook for order ABO202511050EQ1VL9
📤 [Parallel Mode] Sent webhook for order ABO20251105MV5H2V8
📤 [Parallel Mode] Sent webhook for order ABO202511054Q3PA7S
```

---

## Fallback Mode

When databases are down, the system uses cache to continue operations.

### Setup

1. **Configure Upstash Redis** (Optional but recommended)
```env
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token
```

2. **Enable Fallback Mode**
```json
{
  "coreRunningMode": "fallback"
}
```

### How It Works

**1. Order Creation (Fallback Mode):**
- Order saved to Redis + LRU cache (not database)
- TTL: 24 hours
- Webhook data cached: `urlCallBack`, `apiKey`, `merchantOrdId`, etc.

**2. Payment Arrives:**
- Webhook retrieves cached order data
- No database queries
- Payment amount recorded

**3. Merchant Notification:**
- Uses cached `urlCallBack` and data
- Sends webhook normally
- Works even when databases completely down

### Cache Layers

**L1 Cache (LRU):**
- In-memory
- Fast (instant lookup)
- Lost on server restart
- Max 1,000 orders

**L2 Cache (Upstash Redis):**
- Persistent
- Survives server restarts
- Slower than L1 but still fast
- Free tier: 10,000 commands/day

### Fallback Mode Logs
```
🟡 [Webhook Fallback Mode] Transaction received but not saved to database
✅ [Fallback Mode] Found cached webhook data - will send merchant notification
📦 [Batching Mode] Sent bulk webhook to ... with 3 orders in ONE request
```

---

## Postman Collection

### Complete Testing Flow

**Step 1: Create Order**
```
POST http://localhost:3000/api/orders/TXN123456
Headers:
  Content-Type: application/json
  x-api-key: your-api-key
Body:
{
  "merchantOrdId": "TEST-001",
  "odrType": "deposit",
  "amount": 500000,
  "urlCallBack": "https://webhook.site/your-unique-id"
}

Response → Copy odrId from response
```

**Step 2: Simulate Payment (Use odrId from Step 1)**
```
POST http://localhost:3000/api/webhook/payment/secretAgent
Headers:
  Content-Type: application/json
  secretkey: your-secret-key
Body:
[
  {
    "id": 1234567,
    "accountNumber": "0123456789",
    "amount": 500000,
    "content": "THANH TOAN {{odrId}}",
    "odrId": "{{odrId}}",
    "odrType": "deposit",
    "balance": 10000000
  }
]

Response → Check webhook.site for merchant callback
```

**Step 3: Verify Callback**
- Go to https://webhook.site/your-unique-id
- Should see POST request with order data
- Status: 200 OK

### Import to Postman

1. Open Postman
2. Import → Raw Text
3. Paste this:

```json
{
  "info": {
    "name": "Payment Gateway API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "1. Create Deposit Order",
      "request": {
        "method": "POST",
        "header": [
          {
            "key": "Content-Type",
            "value": "application/json"
          },
          {
            "key": "x-api-key",
            "value": "your-api-key-here"
          }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"merchantOrdId\": \"MERCHANT-ORD-001\",\n  \"odrType\": \"deposit\",\n  \"amount\": 500000,\n  \"urlSuccess\": \"https://yoursite.com/success\",\n  \"urlFailed\": \"https://yoursite.com/failed\",\n  \"urlCanceled\": \"https://yoursite.com/canceled\",\n  \"urlCallBack\": \"https://webhook.site/d332ea4c-53bf-476e-8ffa-b0c666ea134d\"\n}"
        },
        "url": {
          "raw": "http://localhost:3000/api/orders/TXN123456",
          "host": ["http://localhost:3000"],
          "path": ["api", "orders", "TXN123456"]
        }
      }
    },
    {
      "name": "2. Simulate Single Payment",
      "request": {
        "method": "POST",
        "header": [
          {
            "key": "Content-Type",
            "value": "application/json"
          },
          {
            "key": "secretkey",
            "value": "your-secret-key"
          }
        ],
        "body": {
          "mode": "raw",
          "raw": "[\n  {\n    \"id\": 1234567,\n    \"id_bank\": \"MB01\",\n    \"transactiondate\": \"2025-11-05 10:30:00\",\n    \"bank_name\": \"MB Bank\",\n    \"accountNumber\": \"0123456789\",\n    \"amount\": 500000,\n    \"content\": \"THANH TOAN ABO202511050EQ1VL9\",\n    \"odrId\": \"ABO202511050EQ1VL9\",\n    \"odrType\": \"deposit\",\n    \"refAccoutNumber\": \"9876543210\",\n    \"refAccountOwnerName\": \"NGUYEN VAN A\",\n    \"balance\": 10000000\n  }\n]"
        },
        "url": {
          "raw": "http://localhost:3000/api/webhook/payment/secretAgent",
          "host": ["http://localhost:3000"],
          "path": ["api", "webhook", "payment", "secretAgent"]
        }
      }
    },
    {
      "name": "3. Simulate Bulk Payments (3 orders)",
      "request": {
        "method": "POST",
        "header": [
          {
            "key": "Content-Type",
            "value": "application/json"
          },
          {
            "key": "secretkey",
            "value": "your-secret-key"
          }
        ],
        "body": {
          "mode": "raw",
          "raw": "[\n  {\n    \"id\": 1234567,\n    \"accountNumber\": \"0123456789\",\n    \"amount\": 500000,\n    \"content\": \"THANH TOAN ABO202511050EQ1VL9\",\n    \"odrId\": \"ABO202511050EQ1VL9\",\n    \"odrType\": \"deposit\",\n    \"balance\": 10000000\n  },\n  {\n    \"id\": 1234568,\n    \"accountNumber\": \"0123456789\",\n    \"amount\": 500000,\n    \"content\": \"THANH TOAN ABO20251105MV5H2V8\",\n    \"odrId\": \"ABO20251105MV5H2V8\",\n    \"odrType\": \"deposit\",\n    \"balance\": 10500000\n  },\n  {\n    \"id\": 1234569,\n    \"accountNumber\": \"0123456789\",\n    \"amount\": 500000,\n    \"content\": \"THANH TOAN ABO202511054Q3PA7S\",\n    \"odrId\": \"ABO202511054Q3PA7S\",\n    \"odrType\": \"deposit\",\n    \"balance\": 11000000\n  }\n]"
        },
        "url": {
          "raw": "http://localhost:3000/api/webhook/payment/secretAgent",
          "host": ["http://localhost:3000"],
          "path": ["api", "webhook", "payment", "secretAgent"]
        }
      }
    }
  ]
}
```

### Testing Checklist

- [ ] Create order → Get `odrId` from response
- [ ] Simulate payment with that `odrId`
- [ ] Check webhook.site for merchant callback
- [ ] Verify callback contains correct data
- [ ] Test with 3 orders (same callback URL)
- [ ] Verify receives 1 batched array with 3 orders
- [ ] Test withdraw order
- [ ] Verify withdraw callback works

---

## Quick Reference

### Environment Variables
```env
# Appwrite (Primary Database)
NEXT_PUBLIC_APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
NEXT_PUBLIC_APPWRITE_PROJECT=your-project-id
APPWRITE_API_KEY=your-api-key

# Supabase (Backup Database)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Upstash Redis (Cache for Fallback Mode)
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token

# Webhook Secrets
CASSOFLOW_CHECKSUM_KEY=your-cassoflow-key
SEPAY_BEARER_TOKEN=your-sepay-token
SECRET_AGENT_KEY=your-secret-agent-key
```

### Configuration Files

**lib/json/appconfig.json:**
```json
{
  "coreRunningMode": "appwrite",
  "webhookSettings": {
    "enableCallbackBatching": true
  }
}
```

### Common Issues

**Issue: Webhooks not sent to merchant**
- ✅ Check `urlCallBack` in order creation
- ✅ Verify `enableCallbackBatching` config
- ✅ Check console logs for batching messages
- ✅ Ensure order status is 'processed' or 'completed'

**Issue: Database errors in webhook processing**
- ✅ Check `coreRunningMode` setting
- ✅ Try 'auto' mode for automatic fallback
- ✅ Use 'fallback' mode if both databases down

**Issue: Duplicate transactions**
- ✅ System automatically detects duplicates
- ✅ Returns 'duplicated' status
- ✅ No duplicate charges

---

## Support

For issues or questions:
1. Check console logs for detailed error messages
2. Verify configuration in `appconfig.json`
3. Test with webhook.site first
4. Use Postman collection for debugging
