/**
 * Client-Side QR Generator
 * 
 * Browser-compatible version of QRLocal for generating VietQR-compatible QR codes
 * Uses browser-compatible qrcode library
 */

// VietQR Constants
const VIETQR_GUID = 'A000000727'; // Official VietQR GUID

export interface ClientQRParams {
  bankBin: string;
  accountNumber: string;
  amount: number;
  orderId?: string;
}

export interface ClientQRResult {
  success: boolean;
  qrDataURL?: string; // Base64 data URL
  qrText?: string; // Raw QR text data
  message?: string;
}

/**
 * Calculate CRC16-CCITT checksum for VietQR validation
 * @param data Data string to calculate CRC for
 * @returns CRC16 checksum as uppercase hex string
 */
function calculateCRC16(data: string): string {
  let crc = 0xFFFF;
  
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
    }
  }
  
  crc = crc & 0xFFFF;
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Generate VietQR-compatible QR data string
 * @param params QR generation parameters
 * @returns VietQR-formatted QR data string
 */
function generateQRData(params: {
  bankBin: string;
  accountNumber: string;
  amount: number;
  orderId?: string;
}): string {
  const { bankBin, accountNumber, amount, orderId = '' } = params;
  
  // VietQR format based on real data analysis
  const guid = `0010${VIETQR_GUID}`; // 0010A000000727
  
  // Bank identification - 0006 + bankBin (10 chars total)
  const bankIdentifier = `0006${bankBin}`;
  
  // Account info - tag 01, length of account number only, account number
  const accountInfo = `01${String(accountNumber.length).padStart(2, '0')}${accountNumber}`;
  
  // Template code - tag 02, length 08, value QRIBFTTA
  const templateCode = '0208QRIBFTTA';
  
  // Combine: bank identifier + account info + template
  const bankAndAccountData = bankIdentifier + accountInfo + templateCode;
  // VietQR uses actual content length minus 12 (empirically determined pattern)
  const bankTagLength = bankAndAccountData.length - 12;
  const bankTag = `01${String(bankTagLength).padStart(2, '0')}${bankAndAccountData}`;
  
  // Complete merchant info
  const merchantInfo = guid + bankTag;
  const merchantTag = `38${String(merchantInfo.length).padStart(2, '0')}${merchantInfo}`;
  
  // Build the complete QR string
  let qrData = '';
  
  // Payload format indicator
  qrData += '000201';
  
  // Point of initiation method
  qrData += '010212'; // Dynamic QR (12)
  
  // Merchant account information (tag 38)
  qrData += merchantTag;
  
  // Transaction currency (VND = 704)
  qrData += '5303704';
  
  // Transaction amount
  if (amount > 0) {
    const amountStr = amount.toString();
    qrData += `54${String(amountStr.length).padStart(2, '0')}${amountStr}`;
  }
  
  // Country code
  qrData += '5802VN';
  
  // Additional data field (order ID)
  if (orderId) {
    const additionalData = `08${String(orderId.length).padStart(2, '0')}${orderId}`;
    qrData += `62${String(additionalData.length).padStart(2, '0')}${additionalData}`;
  }
  
  // Calculate and append CRC
  const crc = calculateCRC16(qrData + '6304');
  qrData += `6304${crc}`;
  
  return qrData;
}

/**
 * Generate QR code image (client-side compatible)
 * 
 * NOTE: This function dynamically imports the qrcode library to work in both
 * browser and server environments
 * 
 * @param params QR generation parameters
 * @returns Promise resolving to QR result with base64 data URL
 */
export async function generateClientQR(params: ClientQRParams): Promise<ClientQRResult> {
  try {
    const { bankBin, accountNumber, amount, orderId } = params;
    
    // Validate inputs
    if (!bankBin || !accountNumber) {
      return {
        success: false,
        message: 'Bank BIN and account number are required'
      };
    }
    
    if (amount <= 0) {
      return {
        success: false,
        message: 'Amount must be greater than 0'
      };
    }
    
    // Generate VietQR-compatible data string
    const qrText = generateQRData({
      bankBin,
      accountNumber,
      amount,
      orderId
    });
    
    // Dynamically import qrcode for browser compatibility
    const QRCode = await import('qrcode');
    
    // Generate QR code as base64 data URL
    const qrDataURL = await QRCode.default.toDataURL(qrText, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 400,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
    
    return {
      success: true,
      qrDataURL,
      qrText
    };
  } catch (error) {
    console.error('Client QR generation error:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to generate QR code'
    };
  }
}
