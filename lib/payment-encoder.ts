/**
 * Payment Data Encoder/Decoder
 * 
 * Encrypts/decrypts payment information for URL-based payment pages that work without database queries.
 * This allows the payment system to remain functional even when the database is unavailable.
 * 
 * Security: Uses AES-256-GCM encryption with authenticated encryption
 */

import crypto from 'crypto';
import { appConfig } from './appconfig';

// Payment data structure that will be encoded in URLs
export interface PaymentData {
  odrId: string;
  merchantOrdId?: string;
  odrType: 'deposit' | 'withdraw';
  odrStatus: string;
  amount: number;
  timestamp: string;
  
  // Deposit-specific fields
  bankName?: string;
  bankBinCode?: string;  // Bank bin code for QR generation
  accountNumber?: string;
  accountName?: string;
  // QR code removed from URL to prevent 431 errors - generated client-side
  qrCode?: string | null;
  
  // Withdraw-specific fields
  bankReceiveNumber?: string;
  bankReceiveOwnerName?: string;
  bankReceiveName?: string;
  
  // URLs - keep short ones only
  urlSuccess?: string;
  urlFailed?: string;
  urlCanceled?: string;
  urlCallBack?: string;
  
  // Merchant info - logo URL removed to prevent 431 errors
  merchantName?: string;
  merchantLogoUrl?: string;
  
  // Merchant ID for webhook validation
  merchantId: string;
}

/**
 * Encrypts payment data using AES-256-GCM
 * @param data Payment data to encrypt
 * @returns Base64-encoded encrypted string suitable for URLs
 */
export function encryptPaymentData(data: PaymentData): string {
  try {
    // Ensure encryption key is 32 bytes for AES-256
    const key = Buffer.from(appConfig.paymentEncryptionKey.padEnd(32, '0').substring(0, 32));
    
    // Generate random IV (Initialization Vector)
    const iv = crypto.randomBytes(16);
    
    // Create cipher
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    
    // Encrypt the JSON data
    const jsonData = JSON.stringify(data);
    let encrypted = cipher.update(jsonData, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Get authentication tag
    const authTag = cipher.getAuthTag();
    
    // Combine IV + authTag + encrypted data
    const combined = iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
    
    // Return base64-encoded URL-safe string
    return Buffer.from(combined).toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    
  } catch (error) {
    console.error('Payment data encryption error:', error);
    throw new Error('Failed to encrypt payment data');
  }
}

/**
 * Decrypts payment data from URL-encoded string
 * @param encodedData Base64-encoded encrypted string from URL
 * @returns Decrypted payment data
 */
export function decryptPaymentData(encodedData: string): PaymentData {
  try {
    // Convert URL-safe base64 back to standard base64
    const base64 = encodedData
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(encodedData.length + (4 - (encodedData.length % 4)) % 4, '=');
    
    // Decode from base64
    const combined = Buffer.from(base64, 'base64').toString('utf8');
    
    // Split IV, authTag, and encrypted data
    const parts = combined.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    // Ensure encryption key is 32 bytes for AES-256
    const key = Buffer.from(appConfig.paymentEncryptionKey.padEnd(32, '0').substring(0, 32));
    
    // Create decipher
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    // Decrypt the data
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    // Parse JSON
    const data = JSON.parse(decrypted) as PaymentData;
    
    // Validate required fields
    if (!data.odrId || !data.odrType || !data.amount || !data.merchantId) {
      throw new Error('Invalid payment data: missing required fields');
    }
    
    return data;
    
  } catch (error) {
    console.error('Payment data decryption error:', error);
    throw new Error('Failed to decrypt payment data');
  }
}

/**
 * Validates that encrypted payment data has not expired
 * @param data Decrypted payment data
 * @param maxAgeSeconds Maximum age in seconds (default: 24 hours)
 * @returns Boolean indicating if data is still valid
 */
export function validatePaymentDataAge(data: PaymentData, maxAgeSeconds: number = 86400): boolean {
  try {
    const createdTime = new Date(data.timestamp).getTime();
    const now = Date.now();
    const ageSeconds = (now - createdTime) / 1000;
    
    return ageSeconds <= maxAgeSeconds;
  } catch {
    return false;
  }
}

/**
 * Creates a short, URL-friendly payment link with encoded data
 * @param baseUrl Base URL of the application
 * @param data Payment data to encode
 * @returns Complete payment URL
 */
export function createEncodedPaymentUrl(baseUrl: string, data: PaymentData): string {
  const encoded = encryptPaymentData(data);
  return `${baseUrl}/payment-direct/${encoded}`;
}
