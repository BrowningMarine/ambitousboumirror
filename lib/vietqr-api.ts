import axios from 'axios';
import { appConfig } from './appconfig';
import QRLocal from './qr_local';

// VietQR API Configuration
const VIETQR_GENERATE_URL = 'https://api.vietqr.io/v2/generate';

// Define request and response types for VietQR API
export interface VietQRGenerateRequest {
  accountNo: string | number;
  accountName: string;
  acqId: string | number;
  amount: number;
  addInfo: string;
  format?: 'text' | 'base64';
  template?: string;
}

export interface VietQRGenerateResponse {
  code: string;
  desc: string;
  data: {
    qrCode: string;
    qrDataURL?: string; // Base64 image data when format is 'base64'
  };
}

export interface QRGenerationResult {
  success: boolean;
  qrCode?: string; // Either direct URL or base64 image data
  message?: string;
  generationMethod: 'api' | 'direct' | 'local';
}

/**
 * VietQR Dynamic QR Code Generation Service
 * 
 * Supports both direct URL generation and API-based generation
 * based on app configuration settings.
 */
export class VietQRService {
  private static readonly API_TIMEOUT = 10000; // 10 seconds timeout
  
  /**
   * Generate QR code based on app configuration
   * @param params QR generation parameters
   * @returns QRGenerationResult with QR data
   */
  static async generateQRCode(params: {
    bankCode: string;
    accountNumber: string;
    accountName?: string;
    amount: number;
    orderId: string;
  }): Promise<QRGenerationResult> {
    const { bankCode, accountNumber, accountName, amount, orderId } = params;
    
    // Determine generation method from app config
    const useApiGeneration = appConfig.create_qr_by === 'vietqr';
    
    if (useApiGeneration) {
      // Use VietQR API for generation
      return await this.generateViaAPI({
        bankCode,
        accountNumber,
        accountName: accountName || '',
        amount,
        orderId
      });
    } else {
      // Use direct URL generation (existing method)
      return this.generateDirectURL({
        bankCode,
        accountNumber,
        amount,
        orderId
      });
    }
  }
  
  /**
   * Generate QR code using VietQR API
   * @param params API generation parameters
   * @returns QRGenerationResult with base64 QR data
   */
  private static async generateViaAPI(params: {
    bankCode: string;
    accountNumber: string;
    accountName: string;
    amount: number;
    orderId: string;
  }): Promise<QRGenerationResult> {
    
    // Prepare API request payload
    const requestPayload: VietQRGenerateRequest = {
      accountNo: params.accountNumber,
      accountName: params.accountName,
      acqId: params.bankCode,
      amount: Math.floor(params.amount),
      addInfo: params.orderId,
      format: 'base64', // Request base64 format for embedded display
      template: appConfig.qrTemplateCode
    };
    
    try {
      // Validate required credentials
      if (!appConfig.qrClientId || !appConfig.qrClientSecret) {
        return this.generateDirectURL({
          bankCode: params.bankCode,
          accountNumber: params.accountNumber,
          amount: params.amount,
          orderId: params.orderId
        });
      }
      
      // Make API request
      console.log('VietQR API Request:', {
        url: VIETQR_GENERATE_URL,
        method: 'POST',
        headers: {
          'x-client-id': appConfig.qrClientId,
          'x-api-key': appConfig.qrClientSecret,
          'Content-Type': 'application/json',
          'User-Agent': 'AmbitiousBoy-QR/1.0'
        },
        body: requestPayload
      });
      
      const response = await axios.post<VietQRGenerateResponse>(
        VIETQR_GENERATE_URL,
        requestPayload,
        {
          timeout: this.API_TIMEOUT,
          headers: {
            'x-client-id': appConfig.qrClientId,
            'x-api-key': appConfig.qrClientSecret,
            'Content-Type': 'application/json',
            'User-Agent': 'AmbitiousBoy-QR/1.0'
          }
        }
      );
      
      if (response.data && response.data.code === "00") {
        return {
          success: true,
          qrCode: response.data.data.qrDataURL || response.data.data.qrCode, // Prioritize base64 image data
          generationMethod: 'api',
          message: 'QR code generated successfully via API'
        };
      } else {
        throw new Error(`VietQR API Error: ${response.data?.desc || 'Unknown error'}`);
      }
      
    } catch (error) {
      // Log the actual VietQR API error details
      console.error('VietQR API failed with error:', error);
      
      // Log the request body that was sent
      console.error('VietQR Request Body:', requestPayload);
      
      if (error instanceof Error) {
        console.error('Error message:', error.message);
      }
      
      // Check if it's an Axios error to get response details
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as { response?: { status?: number; data?: unknown }; config?: { url?: string; method?: string; headers?: Record<string, string> } };
        console.error('Response status:', axiosError.response?.status);
        console.error('Response data:', axiosError.response?.data);
        console.error('Request config:', {
          url: axiosError.config?.url,
          method: axiosError.config?.method,
          headers: axiosError.config?.headers
        });
      }
      
      // Fallback to local generation first, then direct URL
      console.warn('VietQR API failed, attempting local generation...');
      
      try {
        const localResult = await QRLocal.generateQR({
          bankBin: params.bankCode,
          accountNumber: params.accountNumber,
          amount: params.amount,
          orderId: params.orderId
        });
        
        if (localResult.success && localResult.qrDataURL) {
          return {
            success: true,
            qrCode: localResult.qrDataURL,
            generationMethod: 'local',
            message: 'QR code generated locally (API fallback)'
          };
        }
      } catch (localError) {
        console.error('Local QR generation also failed:', localError);
      }
      
      // Final fallback to direct URL generation
      return this.generateDirectURL({
        bankCode: params.bankCode,
        accountNumber: params.accountNumber,
        amount: params.amount,
        orderId: params.orderId
      });
    }
  }
  
  /**
   * Generate QR code using local generation method (fully self-contained)
   * @param params Local generation parameters
   * @returns QRGenerationResult with base64 QR data
   */
  static async generateLocalQR(params: {
    bankCode: string;
    accountNumber: string;
    accountName: string;
    amount: number;
    orderId: string;
  }): Promise<QRGenerationResult> {
    try {
      const localResult = await QRLocal.generateQR({
        bankBin: params.bankCode,
        accountNumber: params.accountNumber,
        amount: params.amount,
        orderId: params.orderId
      });
      
      if (localResult.success && localResult.qrDataURL) {
        return {
          success: true,
          qrCode: localResult.qrDataURL,
          generationMethod: 'local',
          message: 'QR code generated locally'
        };
      } else {
        throw new Error(localResult.message || 'Local QR generation failed');
      }
    } catch (error) {
      console.error('Local QR generation error:', error);
      
      // Final fallback to direct URL
      return this.generateDirectURL({
        bankCode: params.bankCode,
        accountNumber: params.accountNumber,
        amount: params.amount,
        orderId: params.orderId
      });
    }
  }
  
  /**
   * Generate QR code using direct URL method (existing approach)
   * @param params Direct URL generation parameters
   * @returns QRGenerationResult with direct URL
   */
  private static generateDirectURL(params: {
    bankCode: string;
    accountNumber: string;
    amount: number;
    orderId: string;
  }): QRGenerationResult {
    const directUrl = `https://img.vietqr.io/image/${params.bankCode}-${params.accountNumber}-${appConfig.qrTemplateCode}.png?amount=${Math.floor(params.amount)}&addInfo=${params.orderId}`;
    
    return {
      success: true,
      qrCode: directUrl,
      generationMethod: 'direct',
      message: 'QR code generated successfully via direct URL'
    };
  }
  
  /**
   * Validate VietQR API credentials
   * @returns Boolean indicating if credentials are available
   */
  static hasValidCredentials(): boolean {
    return !!(appConfig.qrClientId && appConfig.qrClientSecret);
  }
  
  /**
   * Get current QR generation method from config
   * @returns Current generation method
   */
  static getCurrentMethod(): 'api' | 'direct' | 'local' {
    return appConfig.create_qr_by === 'vietqr' ? 'api' : appConfig.create_qr_by === 'local' ? 'local' : 'direct';
  }
}

export default VietQRService;
