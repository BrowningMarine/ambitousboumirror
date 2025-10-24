import { NextRequest, NextResponse } from 'next/server'
import { log } from './logger'

export function withLogging(
  handler: (req: NextRequest) => Promise<NextResponse>
) {
  return async (req: NextRequest) => {
    const startTime = Date.now()
    
    // Log the incoming request
    const requestData = {
      method: req.method,
      url: req.url,
      headers: Object.fromEntries(req.headers.entries())
    }
    log.request(requestData, {
      path: req.nextUrl.pathname,
      searchParams: req.nextUrl.searchParams.toString(),
    })

    try {
      const response = await handler(req)
      const duration = Date.now() - startTime
      
      // Log successful response
      log.performance('API Response', duration, {
        status: response.status,
        path: req.nextUrl.pathname,
        method: req.method,
      })
      
      return response
    } catch (error) {
      const duration = Date.now() - startTime
      
      // Log error response
      log.error('API Error', error instanceof Error ? error : new Error(String(error)), {
        path: req.nextUrl.pathname,
        method: req.method,
        duration,
      })
      
      // Re-throw the error to maintain normal error handling
      throw error
    }
  }
} 