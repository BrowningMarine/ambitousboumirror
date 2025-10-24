import { Logtail } from '@logtail/node'
import type { NextRequest } from 'next/server'

// Types for better type safety
interface RequestInfo {
  method?: string
  url?: string
  userAgent?: string
  ip?: string
}

interface LogContext {
  [key: string]: unknown
}

interface RequestLike {
  method?: string
  url?: string
  headers?: Record<string, string | string[] | undefined>
}

// Helper function to safely capture request details for logging
export const captureRequestDetails = async (request: NextRequest | Request) => {
  try {
    // Extract headers (filter out sensitive data)
    const headers: Record<string, string> = {};
    request.headers.forEach((value: string, key: string) => {
      // Mask sensitive headers but keep x-api-key partially visible
      if (key.toLowerCase() === 'x-api-key') {
        headers[key] = value ? `${value.substring(0, 4)}...${value.substring(value.length - 4)}` : 'missing';
      } else if (key.toLowerCase().includes('authorization')) {
        headers[key] = '[REDACTED]';
      } else if (key.toLowerCase().includes('cookie')) {
        headers[key] = '[REDACTED]';
      } else {
        headers[key] = value;
      }
    });

    // Extract IP address
    const ip = request.headers.get('cf-connecting-ip') ||
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      request.headers.get('true-client-ip') ||
      'unknown';

    // Try to parse body safely
    let body: unknown = null;
    try {
      // Clone request to avoid consuming the body
      const clonedRequest = request.clone();
      const text = await clonedRequest.text();
      
      if (text) {
        try {
          body = JSON.parse(text);
          // Limit body size for logging (max 5000 chars)
          const bodyStr = JSON.stringify(body);
          if (bodyStr.length > 5000) {
            body = { _truncated: true, _size: bodyStr.length, _preview: bodyStr.substring(0, 5000) + '...' };
          }
        } catch {
          // Not JSON, store as text (truncated)
          body = text.length > 1000 ? text.substring(0, 1000) + '...' : text;
        }
      }
    } catch {
      body = '[Unable to capture body]';
    }

    return {
      method: request.method,
      url: request.url,
      headers,
      ip,
      body,
      userAgent: request.headers.get('user-agent') || 'unknown'
    };
  } catch (error) {
    return {
      error: 'Failed to capture request details',
      message: error instanceof Error ? error.message : String(error)
    };
  }
};

// Initialize BetterStack logger
const betterStackToken = process.env.BETTERSTACK_SOURCE_TOKEN
const betterStackEndpoint = 'https://s1347212.eu-nbg-2.betterstackdata.com'

export const logger = betterStackToken 
  ? new Logtail(betterStackToken)
  : null

// Direct HTTP API logger (works with your token)
const sendToBetterStack = async (level: string, message: string, data: LogContext = {}, retries = 1) => {
  if (!betterStackToken) return false;
  
  // Add DEV prefix for development environment logs
  const isDevelopment = process.env.NODE_ENV === 'development';
  const envPrefix = isDevelopment ? 'DEV - ' : '';
  const prefixedMessage = `${envPrefix}${message}`;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const payload = {
        dt: new Date().toISOString().replace('T', ' ').replace('Z', ' UTC'),
        message: prefixedMessage,
        level: level,
        attempt: attempt > 0 ? attempt + 1 : undefined,
        ...data
      };

      const response = await fetch(betterStackEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${betterStackToken}`
        },
        body: JSON.stringify(payload),
        // Add timeout to prevent hanging requests
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });

      if (!response.ok) {
        if (attempt === retries) {
          console.warn(`BetterStack API returned ${response.status}: ${response.statusText} (final attempt)`);
        }
        continue; // Try again if we have retries left
      }

      return true;
    } catch (error) {
      if (attempt === retries) {
        // Only log errors in development to avoid spam
        if (process.env.NODE_ENV === 'development') {
          console.error('Failed to send log to BetterStack:', error instanceof Error ? error.message : String(error));
        }
      }
      // Wait a bit before retrying
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
  }
  
  return false;
};

// Fallback console logger for development
const consoleLogger = {
  info: console.log,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
}

// Enhanced logging functions with context
export const log = {
  info: async (message: string, context?: LogContext) => {
    const logData = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      ...context
    };

    // Use direct HTTP API (works with your token)
    const success = await sendToBetterStack('info', message, logData);
    
    if (!success) {
      // Fallback to console
      const isDevelopment = process.env.NODE_ENV === 'development';
      const envPrefix = isDevelopment ? 'DEV - ' : '';
      consoleLogger.info('[BETTERSTACK INFO]', JSON.stringify({ level: 'info', message: `${envPrefix}${message}`, ...logData }));
    }
  },

  warn: async (message: string, context?: LogContext) => {
    const logData = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      ...context
    };

    // Use direct HTTP API with retry for important warnings
    const success = await sendToBetterStack('warn', message, logData, 2);
    
    if (!success) {
      // Fallback to console
      const isDevelopment = process.env.NODE_ENV === 'development';
      const envPrefix = isDevelopment ? 'DEV - ' : '';
      consoleLogger.warn('[BETTERSTACK WARN]', JSON.stringify({ level: 'warn', message: `${envPrefix}${message}`, ...logData }));
    }
  },

  error: async (message: string, error?: Error, context?: LogContext) => {
    const logData = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : undefined,
      ...context
    };

    // Use direct HTTP API with retry for critical errors
    const success = await sendToBetterStack('error', message, logData, 3);
    
    if (!success) {
      // Fallback to console
      const isDevelopment = process.env.NODE_ENV === 'development';
      const envPrefix = isDevelopment ? 'DEV - ' : '';
      consoleLogger.error('[BETTERSTACK ERROR]', JSON.stringify({ level: 'error', message: `${envPrefix}${message}`, ...logData }));
    }
  },

  debug: async (message: string, context?: LogContext) => {
    if (process.env.NODE_ENV !== 'production') {
      const logData = {
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        ...context
      };

      // Use direct HTTP API (works with your token)
      const success = await sendToBetterStack('debug', message, logData);
      
      if (!success) {
        // Fallback to console
        const isDevelopment = process.env.NODE_ENV === 'development';
        const envPrefix = isDevelopment ? 'DEV - ' : '';
        consoleLogger.debug('[BETTERSTACK DEBUG]', JSON.stringify({ level: 'debug', message: `${envPrefix}${message}`, ...logData }));
      }
    }
  },

  // Log API requests
  request: async (req: RequestLike, context?: LogContext) => {
    const logData = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      request: {
        method: req.method,
        url: req.url,
        userAgent: req.headers?.['user-agent'],
        ip: req.headers?.['x-forwarded-for'] || req.headers?.['cf-connecting-ip'] || 'unknown',
      } as RequestInfo,
      ...context
    };

    // Use direct HTTP API (works with your token)
    const success = await sendToBetterStack('info', 'API Request', logData);
    
    if (!success) {
      // Fallback to console
      const isDevelopment = process.env.NODE_ENV === 'development';
      const envPrefix = isDevelopment ? 'DEV - ' : '';
      consoleLogger.info('[BETTERSTACK REQUEST]', JSON.stringify({ level: 'info', message: `${envPrefix}API Request`, ...logData }));
    }
  },

  // Log user actions
  userAction: async (userId: string, action: string, context?: LogContext) => {
    const logData = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      userId,
      action,
      ...context
    };

    // Use direct HTTP API (works with your token)
    const success = await sendToBetterStack('info', `User Action: ${action}`, logData);
    
    if (!success) {
      // Fallback to console
      const isDevelopment = process.env.NODE_ENV === 'development';
      const envPrefix = isDevelopment ? 'DEV - ' : '';
      consoleLogger.info('[BETTERSTACK USER_ACTION]', JSON.stringify({ level: 'info', message: `${envPrefix}User Action: ${action}`, ...logData }));
    }
  },

  // Log performance metrics
  performance: async (operation: string, duration: number, context?: LogContext) => {
    const logData = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      performance: {
        operation,
        duration,
        unit: 'ms'
      },
      ...context
    };

    // Use direct HTTP API (works with your token)
    const success = await sendToBetterStack('info', `Performance: ${operation}`, logData);
    
    if (!success) {
      // Fallback to console
      const isDevelopment = process.env.NODE_ENV === 'development';
      const envPrefix = isDevelopment ? 'DEV - ' : '';
      consoleLogger.info('[BETTERSTACK PERFORMANCE]', JSON.stringify({ level: 'info', message: `${envPrefix}Performance: ${operation}`, ...logData }));
    }
  }
}

// Flush logs on process exit
if (logger) {
  process.on('beforeExit', () => {
    logger.flush()
  })
} 