# BetterStack Logging Setup Guide

## 1. Get Your BetterStack Source Token

1. Sign up at [betterstack.com](https://betterstack.com) (free tier)
2. Go to **Telemetry** → **Sources**
3. Create a new source for your Next.js app
4. Copy the **Source Token**

## 2. Environment Variables

Add to your `.env.local` file:

```bash
BETTERSTACK_SOURCE_TOKEN=your_source_token_here
```

## 3. How to Use Logging in Your App

### Basic Logging
```typescript
import { log } from '@/lib/logger'

// Info logs
log.info('User signed in', { userId: '123', email: 'user@example.com' })

// Warning logs
log.warn('Rate limit approaching', { requests: 95, limit: 100 })

// Error logs
log.error('Database connection failed', error, { attempts: 3 })

// Debug logs (only in development)
log.debug('Processing user data', { userData })
```

### API Route Logging
```typescript
import { withLogging } from '@/lib/logging-middleware'

async function handler(request: NextRequest) {
  // Your API logic here
}

export const GET = withLogging(handler)
```

### User Action Logging
```typescript
import { log } from '@/lib/logger'

// Log user actions for analytics
log.userAction('user-123', 'profile_updated', {
  fields: ['name', 'email'],
  ip: request.headers.get('x-forwarded-for')
})
```

### Performance Logging
```typescript
import { log } from '@/lib/logger'

const startTime = Date.now()
// ... some operation
const duration = Date.now() - startTime

log.performance('Database Query', duration, {
  operation: 'user_lookup',
  table: 'users'
})
```

## 4. Error Boundary Setup

Wrap your app components:

```typescript
import { ErrorBoundary } from '@/components/error-boundary'

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      {children}
    </ErrorBoundary>
  )
}
```

## 5. What You Get in BetterStack

### Structured Logs
- All logs are JSON formatted
- Searchable by any field
- Automatic context inclusion

### Key Fields to Monitor
- `level`: info, warn, error, debug
- `message`: Log message
- `timestamp`: When it happened
- `environment`: development/production
- `userId`: User performing action
- `performance.duration`: Operation timing
- `error.stack`: Full error stack traces

### Dashboard Queries

**Error Rate**: Count errors over time
```sql
SELECT count(*) as errors
FROM logs 
WHERE level = 'error' 
AND timestamp > now() - interval '1 hour'
```

**Performance Issues**: Slow operations
```sql
SELECT message, performance.duration
FROM logs 
WHERE performance.duration > 1000
ORDER BY performance.duration DESC
```

**User Activity**: Track user actions
```sql
SELECT userId, action, count(*) as actions
FROM logs 
WHERE message LIKE 'User Action:%'
GROUP BY userId, action
```

## 6. Alerts Setup

Create alerts in BetterStack for:

1. **Error Rate**: > 10 errors per minute
2. **Slow Performance**: API responses > 5 seconds
3. **User Issues**: Failed login attempts > 5 per minute

## 7. Integration with Existing Code

Update your existing API routes:

```typescript
// Before
console.log('Processing request')
console.error('Error:', error)

// After
import { log } from '@/lib/logger'

log.info('Processing request', { context })
log.error('Request failed', error, { context })
```

## 8. Local Development

Without BETTERSTACK_SOURCE_TOKEN, logs go to console:
```
[INFO] {"level":"info","message":"User signed in","userId":"123"}
[ERROR] {"level":"error","message":"Database error","error":{"name":"Error"}}
```

## 9. Production Considerations

- Logs are automatically batched and sent
- No performance impact on your app
- 3GB free storage (3 days retention)
- Upgrade for more storage and longer retention

## 10. Monitoring Checklist

✅ Add logging to all API routes
✅ Log user actions for analytics  
✅ Monitor performance metrics
✅ Set up error alerts
✅ Create dashboards for key metrics
✅ Add error boundaries to React components

## Free Tier Limits

- **3 GB logs** per month
- **3 days** retention
- **2B metrics** (30 days retention)
- Unlimited team members
- Real-time search and alerts

Perfect for most personal/small business projects! 