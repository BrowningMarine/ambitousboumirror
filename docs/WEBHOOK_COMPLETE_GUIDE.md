# Complete Webhook Response & Logging Guide

**Version**: 2.0  
**Last Updated**: October 21, 2025  
**All-in-One Guide**: Response structure, logging behavior, and complete examples

---

## 📋 Quick Navigation

1. [Response Structure](#response-structure)
2. [Logging Behavior](#logging-behavior)
3. [Single Transaction Examples](#single-transaction-examples)
4. [Bulk Transaction Examples](#bulk-transaction-examples)
5. [Portal Comparison](#portal-comparison)

---

## Response Structure

### Standard Response Format

All webhooks return this unified structure:

```json
{
  "success": true,
  "message": "Human-readable summary",
  "processingMode": {
    "mode": "single | bulk",
    "transactionCount": 1,
    "dataFormat": "object | array",
    "supportsBoth": true
  },
  "summary": {
    "total": 1,
    "successful": 1,
    "failed": 0,
    "duplicates": 0,
    "unlinked": 0
  },
  "failedTransactions": ["ORDER123"],
  "performance": {
    "totalTime": 245.67,
    "transactionsPerSecond": 4.07,
    "optimizationsApplied": ["..."]
  }
}
```

### Key Rules

| Rule | Description |
|------|-------------|
| `success` | Always `true` (never-fail pattern for banking webhooks) |
| `failedTransactions` | **Only included if failures exist** - simple array of order IDs |
| `duplicates/unlinked` | **Never in response** - only counted in summary |
| `message` | Single: detailed, Bulk: "Bulk processed: X successful orders" |

---

## Logging Behavior

### Single Transaction Log Format

```javascript
{
  "message": "Webhook {portal} processed",
  "duration": 245.67,
  "order": "ORDER123",        // ✅ Always show order ID
  "status": "success",        // success | failed | duplicate | unlinked
  "amount": 1000000,
  "request": {
    "portal": "cassoflow",
    "mode": "single"
  },
  "timing": {
    "setup": 15,              // Setup + validation
    "parse": 8,               // Payload parsing
    "process": 210,           // Transaction processing
    "total": 245              // Total request time
  },
  "processing": {
    "validation": 12,
    "lookup": 45,
    "createEntry": 78,
    "bankPayment": 65,
    "updateStatus": 10
  }
}
```

### Bulk Transaction Log Format

```javascript
{
  "message": "Webhook {portal} bulk processed",
  "duration": 1234.56,
  "count": 10,
  "summary": "8 success, 1 failed, 1 duplicates",
  "issues": {
    "failed": [
      { "orderId": "ORDER3", "msg": "Insufficient balance" }
    ],
    "duplicates": ["ORDER7"]  // ✅ Only problem orders, not all orders
  },
  "timing": {
    "setup": 18,
    "parse": 12,
    "process": 1180,
    "total": 1234,
    "perTx": 118,             // Average per transaction
    "txPerSec": 8.1           // Transactions per second
  },
  "processing": {
    "avg": {
      "lookup": 42,
      "createEntry": 65,
      "bankPayment": 58
    },
    "slowest": {
      "lookup": 89,
      "createEntry": 145,
      "bankPayment": 123,
      "total": 320
    }
  }
}
```

---

## Single Transaction Examples

### Example 1: Single Success

**Request:**
```json
{
  "data": {
    "tid": "TXN123456",
    "amount": 1000000,
    "description": "Payment ORDER123"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Processed 1 transaction: 1 successful, 0 failed, 0 duplicates, 0 unlinked",
  "processingMode": {
    "mode": "single",
    "transactionCount": 1,
    "dataFormat": "object",
    "supportsBoth": true
  },
  "summary": {
    "total": 1,
    "successful": 1,
    "failed": 0,
    "duplicates": 0,
    "unlinked": 0
  },
  "performance": {
    "totalTime": 245.67,
    "transactionsPerSecond": 4.07,
    "optimizationsApplied": [
      "parallel-processing",
      "caching",
      "background-tasks",
      "connection-pooling"
    ]
  }
}
```

**BetterStack Log:**
```json
{
  "level": "info",
  "message": "Webhook cassoflow processed",
  "duration": 245.67,
  "order": "ORDER123",
  "status": "success",
  "amount": 1000000,
  "request": {
    "portal": "cassoflow",
    "mode": "single"
  },
  "timing": {
    "setup": 15,
    "parse": 8,
    "process": 210,
    "total": 245
  },
  "processing": {
    "validation": 12,
    "lookup": 45,
    "createEntry": 78,
    "bankPayment": 65,
    "updateStatus": 10
  }
}
```

---

### Example 2: Single Failed

**Request:**
```json
{
  "data": {
    "tid": "TXN789012",
    "amount": 500000,
    "description": "Payment ORDER789"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Processed 1 transaction: 0 successful, 1 failed, 0 duplicates, 0 unlinked",
  "processingMode": {
    "mode": "single",
    "transactionCount": 1,
    "dataFormat": "object",
    "supportsBoth": true
  },
  "summary": {
    "total": 1,
    "successful": 0,
    "failed": 1,
    "duplicates": 0,
    "unlinked": 0
  },
  "failedTransactions": [
    "ORDER789"
  ],
  "performance": {
    "totalTime": 189.45,
    "transactionsPerSecond": 5.28,
    "optimizationsApplied": ["..."]
  }
}
```

**BetterStack Log:**
```json
{
  "level": "info",
  "message": "Webhook cassoflow processed",
  "duration": 189.45,
  "order": "ORDER789",
  "status": "failed",
  "amount": 500000,
  "request": {
    "portal": "cassoflow",
    "mode": "single"
  },
  "timing": {
    "setup": 12,
    "parse": 6,
    "process": 165,
    "total": 189
  },
  "processing": {
    "validation": 10,
    "lookup": 38,
    "createEntry": 45,
    "bankPayment": 50,
    "updateStatus": 8
  }
}
```

---

### Example 3: Single Duplicate

**Request:**
```json
{
  "data": {
    "tid": "TXN999999",
    "amount": 1500000,
    "description": "Payment ORDER999"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Processed 1 transaction: 0 successful, 0 failed, 1 duplicates, 0 unlinked",
  "processingMode": {
    "mode": "single",
    "transactionCount": 1,
    "dataFormat": "object",
    "supportsBoth": true
  },
  "summary": {
    "total": 1,
    "successful": 0,
    "failed": 0,
    "duplicates": 1,
    "unlinked": 0
  },
  "performance": {
    "totalTime": 145.67,
    "transactionsPerSecond": 6.86,
    "optimizationsApplied": ["..."]
  }
}
```

**BetterStack Log:**
```json
{
  "level": "info",
  "message": "Webhook cassoflow processed",
  "duration": 145.67,
  "order": "ORDER999",
  "status": "duplicate",
  "amount": 1500000,
  "request": {
    "portal": "cassoflow",
    "mode": "single"
  },
  "timing": {
    "setup": 11,
    "parse": 5,
    "process": 125,
    "total": 145
  },
  "processing": {
    "validation": 9,
    "lookup": 35,
    "createEntry": 42,
    "bankPayment": 28,
    "updateStatus": 6
  }
}
```

---

### Example 4: Single Unlinked

**Request:**
```json
{
  "data": {
    "tid": "TXN555555",
    "amount": 750000,
    "description": "Payment UNKNOWN"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Processed 1 transaction: 0 successful, 0 failed, 0 duplicates, 1 unlinked",
  "processingMode": {
    "mode": "single",
    "transactionCount": 1,
    "dataFormat": "object",
    "supportsBoth": true
  },
  "summary": {
    "total": 1,
    "successful": 0,
    "failed": 0,
    "duplicates": 0,
    "unlinked": 1
  },
  "performance": {
    "totalTime": 132.89,
    "transactionsPerSecond": 7.52,
    "optimizationsApplied": ["..."]
  }
}
```

**BetterStack Log:**
```json
{
  "level": "info",
  "message": "Webhook cassoflow processed",
  "duration": 132.89,
  "order": "none",
  "status": "unlinked",
  "amount": 750000,
  "request": {
    "portal": "cassoflow",
    "mode": "single"
  },
  "timing": {
    "setup": 10,
    "parse": 5,
    "process": 112,
    "total": 132
  },
  "processing": {
    "validation": 8,
    "lookup": 32,
    "createEntry": 38,
    "bankPayment": 25,
    "updateStatus": 5
  }
}
```

---

## Bulk Transaction Examples

### Example 5: Bulk All Success (10 Orders)

**Request:**
```json
{
  "data": [
    { "tid": "TXN001", "amount": 100000, "description": "Payment ORDER001" },
    { "tid": "TXN002", "amount": 200000, "description": "Payment ORDER002" },
    { "tid": "TXN003", "amount": 150000, "description": "Payment ORDER003" },
    { "tid": "TXN004", "amount": 300000, "description": "Payment ORDER004" },
    { "tid": "TXN005", "amount": 250000, "description": "Payment ORDER005" },
    { "tid": "TXN006", "amount": 180000, "description": "Payment ORDER006" },
    { "tid": "TXN007", "amount": 220000, "description": "Payment ORDER007" },
    { "tid": "TXN008", "amount": 350000, "description": "Payment ORDER008" },
    { "tid": "TXN009", "amount": 280000, "description": "Payment ORDER009" },
    { "tid": "TXN010", "amount": 190000, "description": "Payment ORDER010" }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Bulk processed: 10 successful orders",
  "processingMode": {
    "mode": "bulk",
    "transactionCount": 10,
    "dataFormat": "array",
    "supportsBoth": true
  },
  "summary": {
    "total": 10,
    "successful": 10,
    "failed": 0,
    "duplicates": 0,
    "unlinked": 0
  },
  "performance": {
    "totalTime": 1234.56,
    "transactionsPerSecond": 8.1,
    "optimizationsApplied": [
      "parallel-processing",
      "caching",
      "background-tasks",
      "batch-operations",
      "connection-pooling"
    ]
  }
}
```

**BetterStack Log:**
```json
{
  "level": "info",
  "message": "Webhook cassoflow bulk processed",
  "duration": 1234.56,
  "count": 10,
  "summary": "10 success, 0 failed, 0 duplicates",
  "timing": {
    "setup": 18,
    "parse": 12,
    "process": 1180,
    "total": 1234,
    "perTx": 118,
    "txPerSec": 8.1
  },
  "processing": {
    "avg": {
      "lookup": 42,
      "createEntry": 65,
      "bankPayment": 58
    },
    "slowest": {
      "lookup": 78,
      "createEntry": 125,
      "bankPayment": 98,
      "total": 285
    }
  }
}
```

---

### Example 6: Bulk with 1 Failed (10 Orders)

**Request:**
```json
{
  "data": [
    { "tid": "TXN001", "amount": 100000, "description": "Payment ORDER001" },
    { "tid": "TXN002", "amount": 200000, "description": "Payment ORDER002" },
    { "tid": "TXN003", "amount": 150000, "description": "Payment ORDER003" },
    { "tid": "TXN004", "amount": 300000, "description": "Payment ORDER004" },
    { "tid": "TXN005", "amount": 250000, "description": "Payment ORDER005" },
    { "tid": "TXN006", "amount": 180000, "description": "Payment ORDER006" },
    { "tid": "TXN007", "amount": 220000, "description": "Payment ORDER007" },
    { "tid": "TXN008", "amount": 350000, "description": "Payment ORDER008" },
    { "tid": "TXN009", "amount": 280000, "description": "Payment ORDER009" },
    { "tid": "TXN010", "amount": 190000, "description": "Payment ORDER010" }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Bulk processed: 9 successful orders",
  "processingMode": {
    "mode": "bulk",
    "transactionCount": 10,
    "dataFormat": "array",
    "supportsBoth": true
  },
  "summary": {
    "total": 10,
    "successful": 9,
    "failed": 1,
    "duplicates": 0,
    "unlinked": 0
  },
  "failedTransactions": [
    "ORDER005"
  ],
  "performance": {
    "totalTime": 1289.34,
    "transactionsPerSecond": 7.76,
    "optimizationsApplied": ["..."]
  }
}
```

**BetterStack Log:**
```json
{
  "level": "info",
  "message": "Webhook cassoflow bulk processed",
  "duration": 1289.34,
  "count": 10,
  "summary": "9 success, 1 failed, 0 duplicates",
  "issues": {
    "failed": [
      {
        "orderId": "ORDER005",
        "msg": "Insufficient balance"
      }
    ]
  },
  "timing": {
    "setup": 19,
    "parse": 13,
    "process": 1235,
    "total": 1289,
    "perTx": 123,
    "txPerSec": 7.76
  },
  "processing": {
    "avg": {
      "lookup": 45,
      "createEntry": 68,
      "bankPayment": 61
    },
    "slowest": {
      "lookup": 89,
      "createEntry": 145,
      "bankPayment": 112,
      "total": 320
    }
  }
}
```

---

### Example 7: Bulk Mixed Results (20 Orders)

**Request:**
```json
{
  "data": [
    { "tid": "TXN001", "amount": 100000, "description": "Payment ORDER001" },
    { "tid": "TXN002", "amount": 200000, "description": "Payment ORDER002" },
    { "tid": "TXN003", "amount": 150000, "description": "Payment ORDER003" },
    { "tid": "TXN004", "amount": 300000, "description": "Payment ORDER004" },
    { "tid": "TXN005", "amount": 250000, "description": "Payment ORDER005" },
    { "tid": "TXN006", "amount": 180000, "description": "Payment ORDER006" },
    { "tid": "TXN007", "amount": 220000, "description": "Payment ORDER007" },
    { "tid": "TXN008", "amount": 350000, "description": "Payment ORDER008" },
    { "tid": "TXN009", "amount": 280000, "description": "Payment ORDER009" },
    { "tid": "TXN010", "amount": 190000, "description": "Payment ORDER010" },
    { "tid": "TXN011", "amount": 210000, "description": "Payment ORDER011" },
    { "tid": "TXN012", "amount": 240000, "description": "Payment ORDER012" },
    { "tid": "TXN013", "amount": 170000, "description": "Payment ORDER013" },
    { "tid": "TXN014", "amount": 320000, "description": "Payment ORDER014" },
    { "tid": "TXN015", "amount": 260000, "description": "Payment ORDER015" },
    { "tid": "TXN016", "amount": 195000, "description": "Payment ORDER016" },
    { "tid": "TXN017", "amount": 230000, "description": "Payment ORDER017" },
    { "tid": "TXN018", "amount": 360000, "description": "Payment ORDER018" },
    { "tid": "TXN019", "amount": 290000, "description": "Payment ORDER019" },
    { "tid": "TXN020", "amount": 200000, "description": "Payment ORDER020" }
  ]
}
```

**Scenario**: 
- ORDER001-ORDER012: ✅ Success (12)
- ORDER013: ❌ Failed (insufficient balance)
- ORDER014: ✅ Success
- ORDER015: ❌ Failed (invalid account)
- ORDER016: ✅ Success
- ORDER017: 🔄 Duplicate (already processed)
- ORDER018: ✅ Success
- ORDER019: 🔄 Duplicate (already processed)
- ORDER020: 🔗 Unlinked (no matching order)

**Response:**
```json
{
  "success": true,
  "message": "Bulk processed: 15 successful orders",
  "processingMode": {
    "mode": "bulk",
    "transactionCount": 20,
    "dataFormat": "array",
    "supportsBoth": true
  },
  "summary": {
    "total": 20,
    "successful": 15,
    "failed": 2,
    "duplicates": 2,
    "unlinked": 1
  },
  "failedTransactions": [
    "ORDER013",
    "ORDER015"
  ],
  "performance": {
    "totalTime": 2456.78,
    "transactionsPerSecond": 8.14,
    "optimizationsApplied": ["..."]
  }
}
```

**BetterStack Log:**
```json
{
  "level": "info",
  "message": "Webhook cassoflow bulk processed",
  "duration": 2456.78,
  "count": 20,
  "summary": "15 success, 2 failed, 2 duplicates",
  "issues": {
    "failed": [
      {
        "orderId": "ORDER013",
        "msg": "Insufficient balance"
      },
      {
        "orderId": "ORDER015",
        "msg": "Invalid account"
      }
    ],
    "duplicates": [
      "ORDER017",
      "ORDER019"
    ]
  },
  "timing": {
    "setup": 22,
    "parse": 18,
    "process": 2395,
    "total": 2456,
    "perTx": 119,
    "txPerSec": 8.14
  },
  "processing": {
    "avg": {
      "lookup": 44,
      "createEntry": 67,
      "bankPayment": 59
    },
    "slowest": {
      "lookup": 95,
      "createEntry": 156,
      "bankPayment": 125,
      "total": 345
    }
  }
}
```

---

### Example 8: Bulk All Failed (5 Orders)

**Request:**
```json
{
  "data": [
    { "tid": "TXN001", "amount": 100000, "description": "Payment ORDER001" },
    { "tid": "TXN002", "amount": 200000, "description": "Payment ORDER002" },
    { "tid": "TXN003", "amount": 150000, "description": "Payment ORDER003" },
    { "tid": "TXN004", "amount": 300000, "description": "Payment ORDER004" },
    { "tid": "TXN005", "amount": 250000, "description": "Payment ORDER005" }
  ]
}
```

**Scenario**: All orders fail due to various reasons

**Response:**
```json
{
  "success": true,
  "message": "Bulk processed: 0 successful orders",
  "processingMode": {
    "mode": "bulk",
    "transactionCount": 5,
    "dataFormat": "array",
    "supportsBoth": true
  },
  "summary": {
    "total": 5,
    "successful": 0,
    "failed": 5,
    "duplicates": 0,
    "unlinked": 0
  },
  "failedTransactions": [
    "ORDER001",
    "ORDER002",
    "ORDER003",
    "ORDER004",
    "ORDER005"
  ],
  "performance": {
    "totalTime": 678.45,
    "transactionsPerSecond": 7.37,
    "optimizationsApplied": ["..."]
  }
}
```

**BetterStack Log:**
```json
{
  "level": "info",
  "message": "Webhook cassoflow bulk processed",
  "duration": 678.45,
  "count": 5,
  "summary": "0 success, 5 failed, 0 duplicates",
  "issues": {
    "failed": [
      {
        "orderId": "ORDER001",
        "msg": "Insufficient balance"
      },
      {
        "orderId": "ORDER002",
        "msg": "Invalid account"
      },
      {
        "orderId": "ORDER003",
        "msg": "Transaction limit exceeded"
      },
      {
        "orderId": "ORDER004",
        "msg": "Account suspended"
      },
      {
        "orderId": "ORDER005",
        "msg": "Invalid payment method"
      }
    ]
  },
  "timing": {
    "setup": 16,
    "parse": 10,
    "process": 635,
    "total": 678,
    "perTx": 127,
    "txPerSec": 7.37
  },
  "processing": {
    "avg": {
      "lookup": 48,
      "createEntry": 72,
      "bankPayment": 65
    },
    "slowest": {
      "lookup": 89,
      "createEntry": 145,
      "bankPayment": 118,
      "total": 298
    }
  }
}
```

---

### Example 9: Bulk All Duplicates (5 Orders)

**Request:**
```json
{
  "data": [
    { "tid": "TXN001", "amount": 100000, "description": "Payment ORDER001" },
    { "tid": "TXN002", "amount": 200000, "description": "Payment ORDER002" },
    { "tid": "TXN003", "amount": 150000, "description": "Payment ORDER003" },
    { "tid": "TXN004", "amount": 300000, "description": "Payment ORDER004" },
    { "tid": "TXN005", "amount": 250000, "description": "Payment ORDER005" }
  ]
}
```

**Scenario**: All orders were already processed (duplicates)

**Response:**
```json
{
  "success": true,
  "message": "Bulk processed: 0 successful orders",
  "processingMode": {
    "mode": "bulk",
    "transactionCount": 5,
    "dataFormat": "array",
    "supportsBoth": true
  },
  "summary": {
    "total": 5,
    "successful": 0,
    "failed": 0,
    "duplicates": 5,
    "unlinked": 0
  },
  "performance": {
    "totalTime": 456.23,
    "transactionsPerSecond": 10.96,
    "optimizationsApplied": ["..."]
  }
}
```

**BetterStack Log:**
```json
{
  "level": "info",
  "message": "Webhook cassoflow bulk processed",
  "duration": 456.23,
  "count": 5,
  "summary": "0 success, 0 failed, 5 duplicates",
  "issues": {
    "duplicates": [
      "ORDER001",
      "ORDER002",
      "ORDER003",
      "ORDER004",
      "ORDER005"
    ]
  },
  "timing": {
    "setup": 14,
    "parse": 9,
    "process": 420,
    "total": 456,
    "perTx": 84,
    "txPerSec": 10.96
  },
  "processing": {
    "avg": {
      "lookup": 35,
      "createEntry": 28,
      "bankPayment": 15
    },
    "slowest": {
      "lookup": 65,
      "createEntry": 52,
      "bankPayment": 28,
      "total": 125
    }
  }
}
```

---

### Example 10: Bulk Maximum (50 Orders Mixed)

**Request:**
```json
{
  "data": [
    // 50 transactions (array too long to show all)
    { "tid": "TXN001", "amount": 100000, "description": "Payment ORDER001" },
    { "tid": "TXN002", "amount": 200000, "description": "Payment ORDER002" },
    // ... (48 more transactions)
  ]
}
```

**Scenario**: 
- 40 Success
- 5 Failed
- 3 Duplicates
- 2 Unlinked

**Response:**
```json
{
  "success": true,
  "message": "Bulk processed: 40 successful orders",
  "processingMode": {
    "mode": "bulk",
    "transactionCount": 50,
    "dataFormat": "array",
    "supportsBoth": true
  },
  "summary": {
    "total": 50,
    "successful": 40,
    "failed": 5,
    "duplicates": 3,
    "unlinked": 2
  },
  "failedTransactions": [
    "ORDER007",
    "ORDER015",
    "ORDER023",
    "ORDER031",
    "ORDER042"
  ],
  "performance": {
    "totalTime": 5678.90,
    "transactionsPerSecond": 8.8,
    "optimizationsApplied": ["..."]
  }
}
```

**BetterStack Log:**
```json
{
  "level": "info",
  "message": "Webhook cassoflow bulk processed",
  "duration": 5678.90,
  "count": 50,
  "summary": "40 success, 5 failed, 3 duplicates",
  "issues": {
    "failed": [
      { "orderId": "ORDER007", "msg": "Insufficient balance" },
      { "orderId": "ORDER015", "msg": "Invalid account" },
      { "orderId": "ORDER023", "msg": "Transaction limit exceeded" },
      { "orderId": "ORDER031", "msg": "Account suspended" },
      { "orderId": "ORDER042", "msg": "Invalid payment method" }
    ],
    "duplicates": [
      "ORDER012",
      "ORDER028",
      "ORDER045"
    ]
  },
  "timing": {
    "setup": 28,
    "parse": 22,
    "process": 5605,
    "total": 5678,
    "perTx": 112,
    "txPerSec": 8.8
  },
  "processing": {
    "avg": {
      "lookup": 43,
      "createEntry": 66,
      "bankPayment": 58
    },
    "slowest": {
      "lookup": 125,
      "createEntry": 198,
      "bankPayment": 167,
      "total": 456
    }
  }
}
```

---

## Portal Comparison

### Cassoflow Portal

| Feature | Support |
|---------|---------|
| Single Transaction | ✅ Yes (object format) |
| Bulk Transactions | ✅ Yes (array format) |
| Data Format | Object or Array |
| Auth Method | API Key (signature) |

**Single Request:**
```json
{ "data": { "tid": "...", "amount": 1000000, "description": "..." } }
```

**Bulk Request:**
```json
{ "data": [{ "tid": "...", "amount": 1000000, "description": "..." }, ...] }
```

---

### Sepay Portal

| Feature | Support |
|---------|---------|
| Single Transaction | ✅ Yes (object format) |
| Bulk Transactions | ❌ No (always single) |
| Data Format | Object only |
| Auth Method | API Key (header) |

**Single Request:**
```json
{
  "transaction_id": "SEPAY123456",
  "amount": 2000000,
  "content": "Payment ORDER456"
}
```

**Response Example:**
```json
{
  "success": true,
  "message": "Processed 1 sepay transaction: 1 successful, 0 failed, 0 duplicates, 0 unlinked",
  "processingMode": {
    "mode": "single",
    "transactionCount": 1,
    "dataFormat": "object",
    "supportsBoth": false
  },
  "summary": {
    "total": 1,
    "successful": 1,
    "failed": 0,
    "duplicates": 0,
    "unlinked": 0
  },
  "performance": { "..." }
}
```

---

### SecretAgent Portal

| Feature | Support |
|---------|---------|
| Single Transaction | ✅ Yes (array with 1 item) |
| Bulk Transactions | ✅ Yes (array format) |
| Data Format | Array only (even for single) |
| Auth Method | Bearer Token |

**Single Request:**
```json
[
  {
    "id": "SA123456",
    "amount": 3000000,
    "description": "Payment ORDER321"
  }
]
```

**Bulk Request:**
```json
[
  { "id": "SA001", "amount": 100000, "description": "Payment ORDER601" },
  { "id": "SA002", "amount": 200000, "description": "Payment ORDER602" },
  // ... more transactions
]
```

---

## Key Rules Summary

### Response Rules

| Rule | Description |
|------|-------------|
| **Always Success** | `success: true` even for validation errors (never-fail pattern) |
| **Failed Only** | Only `failedTransactions` in response (not duplicates/unlinked) |
| **Simple Array** | `failedTransactions` is array of order ID strings: `["ORDER1", "ORDER2"]` |
| **Summary Shows All** | Summary counts all statuses (successful, failed, duplicates, unlinked) |
| **Message Format** | Single: detailed, Bulk: "Bulk processed: X successful orders" |

### Logging Rules

| Rule | Description |
|------|-------------|
| **Single: Show Order** | Always log the order ID with detailed metrics |
| **Bulk: Problems Only** | Only log failed/duplicate order IDs (not all 50 orders) |
| **Status Tracking** | success \| failed \| duplicate \| unlinked |
| **Performance Always** | Always include timing breakdown and processing metrics |
| **Aggregated Metrics** | Bulk shows average and slowest transaction times |

### Status Definitions

| Status | Description |
|--------|-------------|
| `successful` | Transaction processed successfully |
| `failed` | Transaction failed (insufficient balance, invalid account, etc.) |
| `duplicates` | Transaction already processed (duplicate detection) |
| `unlinked` | No matching order found for transaction |

---

## Quick Reference

### Function to Use

```typescript
import { createWebhookResponse } from '@/lib/webhook/webhook-response';

// In your webhook route
return await createWebhookResponse({
  portal: 'cassoflow' | 'sepay' | 'secretagent',
  processingMode: 'single' | 'bulk',
  transactionCount: number,
  dataFormat: 'object' | 'array',
  supportsBoth: boolean,
  results: WebhookResult[],
  performanceMetrics: RequestPerformanceMetrics,
  cacheHitRate: number,
  optimalConcurrency: number,
  optimizationsApplied: string[]
});
```

### Performance Metrics Structure

```typescript
const performanceMetrics = {
  setupAndValidation: 0,      // Setup + validation phase
  payloadParsing: 0,          // JSON parsing + structure validation
  transactionProcessing: 0,   // Core business logic
  total: 0                    // End-to-end request time
};
```

---

## Complete Example Flow

```typescript
// 1. Start timing
const requestStartTime = performance.now();
const performanceMetrics = { setupAndValidation: 0, payloadParsing: 0, transactionProcessing: 0, total: 0 };

// 2. Setup and validation
const setupStart = performance.now();
// ... validation logic
performanceMetrics.setupAndValidation = performance.now() - setupStart;

// 3. Parse payload
const parseStart = performance.now();
const payloadParsed = JSON.parse(payload);
performanceMetrics.payloadParsing = performance.now() - parseStart;

// 4. Process transactions
const processStart = performance.now();
const results = await processTransactionsBatch(transactions, portal);
performanceMetrics.transactionProcessing = performance.now() - processStart;

// 5. Calculate total time
performanceMetrics.total = performance.now() - requestStartTime;

// 6. Return unified response (automatic logging)
return await createWebhookResponse({
  portal: 'cassoflow',
  processingMode: transactions.length > 1 ? 'bulk' : 'single',
  transactionCount: transactions.length,
  dataFormat: Array.isArray(payloadParsed.data) ? 'array' : 'object',
  supportsBoth: true,
  results,
  performanceMetrics,
  cacheHitRate: calculateCacheHitRate(),
  optimalConcurrency: getOptimalConcurrency(portal, transactions.length),
  optimizationsApplied: ['parallel-processing', 'caching', 'background-tasks']
});
```

---

**This is your complete reference guide!** All webhook responses and logs follow these exact patterns. Use this guide when integrating, testing, or debugging webhook flows.
