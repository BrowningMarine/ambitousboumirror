"use server";
/**
 * Admin API: Cache Merchant Account in Supabase
 * 
 * This endpoint reads a merchant account from Appwrite and caches it in Supabase
 * 
 * POST /api/admin/cache-merchant
 * Authorization: Bearer INTERNAL_API_SECRET
 * Body: { merchantId: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAccount } from '@/lib/actions/account.actions';
import { MerchantAccountCacheService } from '@/lib/supabase-backup';
import { log } from '@/lib/logger';

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

export async function POST(request: NextRequest) {
  try {
    // 1. Verify authorization
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (!token || token !== INTERNAL_API_SECRET) {
      await log.warn('Admin API: Unauthorized cache merchant attempt', {
        hasAuth: !!authHeader
      });
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Parse request body
    const body = await request.json();
    const { merchantId, force = false } = body;

    if (!merchantId) {
      return NextResponse.json(
        { success: false, message: 'merchantId is required' },
        { status: 400 }
      );
    }

    await log.info('Admin API: Caching merchant account', { merchantId, force });

    // 3. Get merchant account - check database mode
    const { getCoreRunningMode } = await import('@/lib/appconfig');
    const { loadAppConfig } = await import('@/lib/json/config-loader');
    const runningMode = getCoreRunningMode();
    
    let merchantAccount;
    
    if (runningMode === 'supabase') {
      // When running in Supabase-only mode, get merchant from config file
      const jsonConfig = loadAppConfig();
      const merchants = jsonConfig.merchants || {};
      
      const merchantConfig = Object.entries(merchants).find(
        ([, merchant]) => merchant.accountId === merchantId
      );
      
      if (!merchantConfig) {
        await log.warn('Admin API: Merchant not found in config', { merchantId });
        return NextResponse.json(
          { success: false, message: 'Merchant not found in configuration. Please add to lib/json/appconfig.json' },
          { status: 404 }
        );
      }
      
      const [merchantName, merchantData] = merchantConfig;
      
      // Create merchant object from config
      merchantAccount = {
        $id: merchantId,
        publicTransactionId: merchantId,
        apiKey: '', // Will be derived from apiKeyHash
        apiKeyHash: merchantData.apiKeyHash,
        accountName: merchantName,
        avaiableBalance: 0,
        minDepositAmount: merchantData.minDepositAmount || 0,
        maxDepositAmount: merchantData.maxDepositAmount || 0,
        minWithdrawAmount: merchantData.minWithdrawAmount || 0,
        maxWithdrawAmount: merchantData.maxWithdrawAmount || 0,
        depositWhitelistIps: merchantData.depositWhitelistIps || [],
        withdrawWhitelistIps: merchantData.withdrawWhitelistIps || [],
      };
      
      await log.info('Admin API: Using merchant from config (Supabase mode)', { merchantId, merchantName });
    } else {
      // When running in Appwrite mode, get from Appwrite
      merchantAccount = await getAccount(merchantId);

      if (!merchantAccount) {
        await log.warn('Admin API: Merchant not found in Appwrite', { merchantId });
        return NextResponse.json(
          { success: false, message: 'Merchant account not found in main database' },
          { status: 404 }
        );
      }
    }

    // 4. Cache in Supabase
    const cacheService = new MerchantAccountCacheService();
    
    // Check if already cached
    if (!force) {
      const existingCache = await cacheService.getMerchantByApiKey(
        merchantAccount.apiKey,
        merchantId
      );

      if (existingCache) {
        await log.info('Admin API: Merchant already cached', {
          merchantId,
          cachedAt: existingCache.cached_at
        });
        
        return NextResponse.json({
          success: true,
          message: 'Merchant already cached (use force: true to update)',
          cached: existingCache,
          alreadyExists: true
        });
      }
    }

    // Cache merchant data
    // Note: When in Supabase mode, api_key will be the hash (since we don't have plain API keys)
    // The verification will use hash comparison instead
    const result = await cacheService.cacheMerchantAccount({
      merchant_id: merchantAccount.publicTransactionId,
      api_key: merchantAccount.apiKey || merchantAccount.apiKeyHash || '', // Use hash if no plain key
      account_name: merchantAccount.accountName,
      available_balance: merchantAccount.avaiableBalance,
      min_deposit_amount: merchantAccount.minDepositAmount,
      max_deposit_amount: merchantAccount.maxDepositAmount,
      min_withdraw_amount: merchantAccount.minWithdrawAmount,
      max_withdraw_amount: merchantAccount.maxWithdrawAmount,
      deposit_whitelist_ips: merchantAccount.depositWhitelistIps,
      withdraw_whitelist_ips: merchantAccount.withdrawWhitelistIps,
      status: true,
      appwrite_doc_id: merchantAccount.$id,
    });

    if (!result.success) {
      await log.error('Admin API: Failed to cache merchant', new Error(result.error || 'Failed to cache merchant'), {
        merchantId
      });
      return NextResponse.json(
        { success: false, message: result.error || 'Failed to cache merchant' },
        { status: 500 }
      );
    }

    await log.info('Admin API: Merchant cached successfully', {
      merchantId,
      apiKey: merchantAccount.apiKey.substring(0, 10) + '...'
    });

    return NextResponse.json({
      success: true,
      message: 'Merchant account cached successfully',
      data: {
        merchantId: merchantAccount.publicTransactionId,
        accountName: merchantAccount.accountName,
        availableBalance: merchantAccount.avaiableBalance,
        cachedAt: new Date().toISOString()
      }
    });

  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error('Unknown error');
    
    await log.error('Admin API: Cache merchant error', error, {});

    // Provide more detailed error message
    let errorMessage = error.message;
    if (errorMessage.includes('JWT') || errorMessage.includes('auth')) {
      errorMessage = 'Supabase authentication failed. Please check SUPABASE_SERVICE_KEY is set correctly (must be service_role key, not anon key).';
    } else if (errorMessage.includes('relation') || errorMessage.includes('does not exist')) {
      errorMessage = 'Database tables not found. Please run the schema file: docs/supabase-backup-schema.sql';
    }

    return NextResponse.json(
      { 
        success: false, 
        message: 'Internal server error', 
        error: errorMessage,
        hint: 'Check server logs for details. Common issues: wrong Supabase key (use service_role, not anon), missing database schema.'
      },
      { status: 500 }
    );
  }
}

// GET endpoint to check cache status
export async function GET(request: NextRequest) {
  try {
    // 1. Verify authorization
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (!token || token !== INTERNAL_API_SECRET) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Get merchantId from query params
    const { searchParams } = new URL(request.url);
    const merchantId = searchParams.get('merchantId');
    const apiKey = searchParams.get('apiKey');

    if (!merchantId && !apiKey) {
      return NextResponse.json(
        { success: false, message: 'merchantId or apiKey is required' },
        { status: 400 }
      );
    }

    // 3. Check cache
    const cacheService = new MerchantAccountCacheService();
    
    let cachedMerchant;
    if (merchantId && apiKey) {
      cachedMerchant = await cacheService.getMerchantByApiKey(apiKey, merchantId);
    } else if (merchantId) {
      // Get by merchant ID only (we need to modify the service to support this)
      cachedMerchant = await cacheService.getMerchantByApiKey('', merchantId);
    }

    if (!cachedMerchant) {
      return NextResponse.json({
        success: true,
        cached: false,
        message: 'Merchant not cached in Supabase'
      });
    }

    return NextResponse.json({
      success: true,
      cached: true,
      data: {
        merchantId: cachedMerchant.merchant_id,
        accountName: cachedMerchant.account_name,
        availableBalance: cachedMerchant.available_balance,
        cachedAt: cachedMerchant.cached_at,
        updatedAt: cachedMerchant.updated_at,
      }
    });

  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error('Unknown error');
    
    await log.error('Admin API: Check cache error', error, {});

    return NextResponse.json(
      { success: false, message: 'Internal server error', error: error.message },
      { status: 500 }
    );
  }
}
