-- Supabase Backup Database Schema
-- This database stores orders when the main Appwrite database is unavailable
-- Created: 2025-10-23

-- =====================================================
-- 1. Merchant Accounts Cache Table
-- Stores merchant account info for API key verification when main DB is down
-- =====================================================
CREATE TABLE IF NOT EXISTS merchant_accounts_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id TEXT NOT NULL UNIQUE, -- publicTransactionId
    api_key TEXT NOT NULL,
    account_name TEXT,
    available_balance DECIMAL(15, 2) DEFAULT 0,
    min_deposit_amount DECIMAL(15, 2) DEFAULT 0,
    max_deposit_amount DECIMAL(15, 2) DEFAULT 0,
    min_withdraw_amount DECIMAL(15, 2) DEFAULT 0,
    max_withdraw_amount DECIMAL(15, 2) DEFAULT 0,
    deposit_whitelist_ips JSONB DEFAULT '[]'::jsonb,
    withdraw_whitelist_ips JSONB DEFAULT '[]'::jsonb,
    status BOOLEAN DEFAULT true,
    appwrite_doc_id TEXT, -- Original Appwrite document ID
    cached_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT unique_api_key UNIQUE (api_key)
);

-- Index for fast API key lookups
CREATE INDEX idx_merchant_api_key ON merchant_accounts_cache(api_key);
CREATE INDEX idx_merchant_id ON merchant_accounts_cache(merchant_id);
CREATE INDEX idx_merchant_status ON merchant_accounts_cache(status);

-- =====================================================
-- 2. Backup Orders Table
-- Stores orders created when main database is unavailable
-- =====================================================
CREATE TABLE IF NOT EXISTS backup_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Order identification
    odr_id TEXT NOT NULL UNIQUE,
    merchant_odr_id TEXT,
    
    -- Order details
    odr_type TEXT NOT NULL CHECK (odr_type IN ('deposit', 'withdraw')),
    odr_status TEXT NOT NULL DEFAULT 'processing',
    amount DECIMAL(15, 2) NOT NULL,
    paid_amount DECIMAL(15, 2) DEFAULT 0,
    unpaid_amount DECIMAL(15, 2) NOT NULL,
    
    -- Merchant info
    merchant_id TEXT NOT NULL, -- publicTransactionId
    merchant_account_id TEXT, -- Appwrite account $id
    
    -- Deposit-specific fields
    bank_id TEXT,
    bank_name TEXT,
    bank_bin_code TEXT,
    account_number TEXT,
    account_name TEXT,
    qr_code TEXT, -- Base64 QR code data
    
    -- Withdraw-specific fields
    bank_code TEXT,
    bank_receive_number TEXT,
    bank_receive_owner_name TEXT,
    bank_receive_name TEXT,
    
    -- URLs
    url_success TEXT,
    url_failed TEXT,
    url_canceled TEXT,
    url_callback TEXT NOT NULL,
    
    -- Metadata
    created_ip TEXT,
    is_suspicious BOOLEAN DEFAULT false,
    last_payment_date TIMESTAMP WITH TIME ZONE,
    
    -- Sync tracking
    synced_to_appwrite BOOLEAN DEFAULT false,
    appwrite_doc_id TEXT, -- Set after successful sync
    sync_attempts INTEGER DEFAULT 0,
    last_sync_attempt TIMESTAMP WITH TIME ZONE,
    sync_error TEXT,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CHECK (amount > 0),
    CHECK (odr_type = 'deposit' OR odr_type = 'withdraw')
);

-- Indexes for fast queries
CREATE INDEX idx_backup_orders_odr_id ON backup_orders(odr_id);
CREATE INDEX idx_backup_orders_merchant_id ON backup_orders(merchant_id);
CREATE INDEX idx_backup_orders_merchant_odr_id ON backup_orders(merchant_odr_id);
CREATE INDEX idx_backup_orders_odr_type ON backup_orders(odr_type);
CREATE INDEX idx_backup_orders_odr_status ON backup_orders(odr_status);
CREATE INDEX idx_backup_orders_synced ON backup_orders(synced_to_appwrite);
CREATE INDEX idx_backup_orders_created_at ON backup_orders(created_at DESC);

-- =====================================================
-- 3. Sync Log Table
-- Tracks synchronization attempts and results
-- =====================================================
CREATE TABLE IF NOT EXISTS sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_type TEXT NOT NULL CHECK (sync_type IN ('order_sync', 'merchant_cache_update', 'full_sync')),
    status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed', 'partial')),
    
    -- Statistics
    total_records INTEGER DEFAULT 0,
    synced_records INTEGER DEFAULT 0,
    failed_records INTEGER DEFAULT 0,
    skipped_records INTEGER DEFAULT 0,
    
    -- Details
    error_message TEXT,
    details JSONB,
    
    -- Timestamps
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    duration_ms INTEGER
);

CREATE INDEX idx_sync_logs_type ON sync_logs(sync_type);
CREATE INDEX idx_sync_logs_status ON sync_logs(status);
CREATE INDEX idx_sync_logs_started_at ON sync_logs(started_at DESC);

-- =====================================================
-- 4. Bank Transaction Entries Backup Table
-- Stores bank transaction entries when Appwrite is down
-- =====================================================
CREATE TABLE IF NOT EXISTS bank_transaction_entries_backup (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Portal details
    portal_id TEXT NOT NULL, -- cassoflow, sepay, secretagent
    portal_transaction_id TEXT NOT NULL,
    
    -- Transaction details
    odr_id TEXT, -- May be null for unlinked transactions
    bank_id TEXT,
    amount DECIMAL(15, 2) NOT NULL,
    transaction_type TEXT CHECK (transaction_type IN ('credit', 'debit')),
    balance_after DECIMAL(15, 2),
    
    -- Bank details
    bank_account_number TEXT,
    bank_name TEXT,
    
    -- Status tracking
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'available', 'failed', 'unlinked')),
    notes TEXT,
    
    -- Processing details
    processed_at TIMESTAMP WITH TIME ZONE,
    
    -- Sync tracking
    synced_to_appwrite BOOLEAN DEFAULT false,
    appwrite_doc_id TEXT,
    sync_attempts INTEGER DEFAULT 0,
    last_sync_attempt TIMESTAMP WITH TIME ZONE,
    sync_error TEXT,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraint to prevent duplicate transactions
    CONSTRAINT unique_portal_transaction UNIQUE (portal_id, portal_transaction_id)
);

-- Indexes for fast queries
CREATE INDEX idx_bank_entries_portal_id ON bank_transaction_entries_backup(portal_id);
CREATE INDEX idx_bank_entries_portal_tx_id ON bank_transaction_entries_backup(portal_transaction_id);
CREATE INDEX idx_bank_entries_odr_id ON bank_transaction_entries_backup(odr_id);
CREATE INDEX idx_bank_entries_status ON bank_transaction_entries_backup(status);
CREATE INDEX idx_bank_entries_synced ON bank_transaction_entries_backup(synced_to_appwrite);
CREATE INDEX idx_bank_entries_created_at ON bank_transaction_entries_backup(created_at DESC);

-- =====================================================
-- 5. Webhook Events Table (Optional but recommended)
-- Stores webhook events received while main DB is down
-- =====================================================
CREATE TABLE IF NOT EXISTS webhook_events_backup (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Webhook details
    portal TEXT NOT NULL, -- cassoflow, sepay, secretagent
    odr_id TEXT NOT NULL,
    
    -- Payment info
    amount DECIMAL(15, 2) NOT NULL,
    paid_amount DECIMAL(15, 2) NOT NULL,
    payment_reference TEXT,
    payment_description TEXT,
    
    -- Bank info
    bank_account_number TEXT,
    bank_info TEXT,
    
    -- Raw webhook data
    webhook_payload JSONB NOT NULL,
    
    -- Processing status
    processed BOOLEAN DEFAULT false,
    processing_error TEXT,
    processed_at TIMESTAMP WITH TIME ZONE,
    
    -- Timestamps
    received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_webhook_backup_odr_id ON webhook_events_backup(odr_id);
CREATE INDEX idx_webhook_backup_processed ON webhook_events_backup(processed);
CREATE INDEX idx_webhook_backup_portal ON webhook_events_backup(portal);
CREATE INDEX idx_webhook_backup_received_at ON webhook_events_backup(received_at DESC);

-- =====================================================
-- 6. Updated_at Trigger Function
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to tables
CREATE TRIGGER update_merchant_accounts_cache_updated_at
    BEFORE UPDATE ON merchant_accounts_cache
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_backup_orders_updated_at
    BEFORE UPDATE ON backup_orders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bank_entries_updated_at
    BEFORE UPDATE ON bank_transaction_entries_backup
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 7. Row Level Security (RLS) Policies (Optional)
-- Enable if you want to restrict access
-- =====================================================

-- Enable RLS
ALTER TABLE merchant_accounts_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transaction_entries_backup ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events_backup ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (your API will use service role key)
CREATE POLICY "Service role full access" ON merchant_accounts_cache
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access" ON backup_orders
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access" ON bank_transaction_entries_backup
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access" ON sync_logs
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access" ON webhook_events_backup
    FOR ALL USING (auth.role() = 'service_role');

-- =====================================================
-- 8. Helper Views
-- =====================================================

-- View: Unsynced orders that need to be migrated to Appwrite
CREATE OR REPLACE VIEW unsynced_orders AS
SELECT 
    id,
    odr_id,
    merchant_odr_id,
    odr_type,
    odr_status,
    amount,
    merchant_id,
    created_at,
    sync_attempts,
    last_sync_attempt
FROM backup_orders
WHERE synced_to_appwrite = false
ORDER BY created_at ASC;

-- View: Sync statistics
CREATE OR REPLACE VIEW sync_statistics AS
SELECT 
    COUNT(*) FILTER (WHERE synced_to_appwrite = true) as synced_count,
    COUNT(*) FILTER (WHERE synced_to_appwrite = false) as pending_count,
    COUNT(*) FILTER (WHERE sync_attempts > 3) as failed_count,
    MAX(created_at) as last_order_created,
    MAX(last_sync_attempt) as last_sync_attempt
FROM backup_orders;

-- View: Bank entries sync statistics
CREATE OR REPLACE VIEW bank_entries_sync_statistics AS
SELECT 
    COUNT(*) FILTER (WHERE synced_to_appwrite = true) as synced_count,
    COUNT(*) FILTER (WHERE synced_to_appwrite = false) as pending_count,
    COUNT(*) FILTER (WHERE status = 'unlinked') as unlinked_count,
    MAX(created_at) as last_entry_created,
    MAX(last_sync_attempt) as last_sync_attempt
FROM bank_transaction_entries_backup;

-- =====================================================
-- 9. Sample Data Cleanup Function (Optional)
-- =====================================================

-- Function to clean up old synced orders (run periodically)
CREATE OR REPLACE FUNCTION cleanup_old_synced_orders(days_old INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM backup_orders
    WHERE synced_to_appwrite = true
    AND created_at < NOW() - (days_old || ' days')::INTERVAL;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- SETUP COMPLETE
-- =====================================================

-- Grant necessary permissions to authenticated role
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- Display setup confirmation
SELECT 
    'Supabase backup database schema created successfully!' as status,
    (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE '%backup%' OR table_name LIKE '%merchant%') as tables_created,
    NOW() as created_at;
