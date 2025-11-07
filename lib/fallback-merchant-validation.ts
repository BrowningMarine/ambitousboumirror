/**
 * Fallback Merchant Validation
 * Used when all databases are down to maintain payment system availability
 * Now reads from centralized lib/json/appconfig.json
 */

import { loadAppConfig } from './json/config-loader';
import { createHash } from 'crypto';

interface FallbackMerchant {
  apiKeyHash: string;
  accountId: string;
  minDepositAmount: number;
  maxDepositAmount: number;
  minWithdrawAmount: number;
  maxWithdrawAmount: number;
  depositWhitelistIps: string[];
  withdrawWhitelistIps: string[];
  enabled: boolean;
}

interface FallbackValidationResult {
  success: boolean;
  merchantId?: string;
  accountId?: string;
  error?: string;
}

/**
 * Simple hash function for API key comparison
 * In production, consider using bcrypt or similar
 */
function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Check if IP matches whitelist pattern
 * Supports wildcards like "192.168.1.*"
 */
function matchesIpPattern(ip: string, pattern: string): boolean {
  if (pattern === '*') return true;
  
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '[0-9]+');
  
  return new RegExp(`^${regexPattern}$`).test(ip);
}

/**
 * Validate merchant using fallback JSON configuration
 * This is used ONLY when all databases are unavailable
 */
export function validateMerchantFallback(
  apiKey: string,
  requestIp?: string,
  type: 'deposit' | 'withdraw' = 'deposit'
): FallbackValidationResult {
  try {
    const apiKeyHash = hashApiKey(apiKey);
    
    // Load merchants from centralized config
    const config = loadAppConfig();
    const merchants = config.merchants as Record<string, FallbackMerchant>;
    
    for (const [merchantId, config] of Object.entries(merchants)) {
      if (config.apiKeyHash === apiKeyHash) {
        // Check if merchant is enabled
        if (!config.enabled) {
          return {
            success: false,
            error: 'Merchant account is disabled'
          };
        }
        
        // Check IP whitelist if provided
        if (requestIp) {
          const whitelist = type === 'deposit' 
            ? config.depositWhitelistIps 
            : config.withdrawWhitelistIps;
          
          const ipAllowed = whitelist.some(pattern => 
            matchesIpPattern(requestIp, pattern)
          );
          
          if (!ipAllowed) {
            return {
              success: false,
              error: 'IP address not whitelisted for this operation'
            };
          }
        }
        
        // Validation successful
        return {
          success: true,
          merchantId,
          accountId: config.accountId
        };
      }
    }
    
    // API key not found
    return {
      success: false,
      error: 'Invalid API key'
    };
    
  } catch (error) {
    console.error('Fallback merchant validation error:', error);
    return {
      success: false,
      error: 'Validation system error'
    };
  }
}

/**
 * Get merchant limits from fallback configuration
 */
export function getMerchantLimitsFallback(merchantId: string, type: 'deposit' | 'withdraw' = 'deposit') {
  const config = loadAppConfig();
  const merchants = config.merchants as Record<string, FallbackMerchant>;
  const merchantConfig = merchants[merchantId];
  
  if (!merchantConfig) {
    return null;
  }
  
  return {
    minAmount: type === 'deposit' ? merchantConfig.minDepositAmount : merchantConfig.minWithdrawAmount,
    maxAmount: type === 'deposit' ? merchantConfig.maxDepositAmount : merchantConfig.maxWithdrawAmount
  };
}

/**
 * Check if merchant exists in fallback configuration
 */
export function hasFallbackMerchant(merchantId: string): boolean {
  const config = loadAppConfig();
  const merchants = config.merchants as Record<string, FallbackMerchant>;
  return merchantId in merchants;
}
