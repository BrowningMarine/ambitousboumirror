import QRCode from 'qrcode';

/**
 * Local QR Generator
 * 
 * Generates QR codes locally using VietQR-compatible format
 * without external API dependencies.
 */

// VietQR Constants
const VIETQR_GUID = 'A000000727'; // Official VietQR GUID

export interface QRLocalParams {
  bankBin: string;
  accountNumber: string;
  amount: number;
  orderId?: string;
}

export interface QRLocalResult {
  success: boolean;
  qrDataURL?: string; // Base64 data URL
  qrText?: string; // Raw QR text data
  message?: string;
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
  const crc = QRLocal.calculateCRC16(qrData + '6304');
  qrData += `6304${crc}`;
  
  return qrData;
}

/**
 * Local QR Service
 * Provides self-contained QR code generation following VietQR standards
 */
export class QRLocal {
  
  /**
   * Calculate CRC16 checksum for QR data
   * @param data String data to calculate CRC for
   * @returns 4-character hex CRC string
   */
  static calculateCRC16(data: string): string {
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
    
    return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
  }

  /**
   * Generate VietQR-compatible QR code
   * @param params QR generation parameters
   * @returns QRLocalResult with VietQR-compatible format
   */
  static async generateQR(params: QRLocalParams): Promise<QRLocalResult> {
    try {
      const { bankBin, accountNumber, amount, orderId } = params;

      // Validate required parameters
      if (!bankBin || !accountNumber) {
        throw new Error('Missing required parameters: bankBin or accountNumber');
      }

      // Generate VietQR-compatible QR data string
      const qrText = generateQRData({
        bankBin,
        accountNumber,
        amount: Math.floor(amount),
        orderId
      });

      // Generate QR code as base64 data URL with optimized settings for speed
      // OPTIMIZATION: Reduce quality/size for faster generation (600ms -> ~100ms)
      const qrDataURL = await QRCode.toDataURL(qrText, {
        errorCorrectionLevel: 'L', // Low correction = faster (was 'M')
        type: 'image/png',
        margin: 1,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        },
        width: 200 // Smaller = faster (was 256)
      });

      return {
        success: true,
        qrText,
        qrDataURL,
        message: `QR generated for ${this.getBankNameFromBin(bankBin)} - ${orderId || 'payment'}`
      };

    } catch (error) {
      return {
        success: false,
        qrText: '',
        qrDataURL: '',
        message: error instanceof Error ? error.message : 'Failed to generate QR code'
      };
    }
  }

  /**
   * Validate if bank BIN is supported by VietQR
   * @param bankBin Bank BIN code
   * @returns boolean indicating if supported
   */
  static isSupportedBankBin(bankBin: string): boolean {
    // Complete Vietnamese bank BIN codes from VietQR API
    const supportedBins = [
      '970415', // VietinBank (ICB)
      '970436', // Vietcombank (VCB)
      '970418', // BIDV
      '970405', // Agribank (VBA)
      '970448', // OCB
      '970422', // MBBank (MB)
      '970407', // Techcombank (TCB)
      '970416', // ACB
      '970432', // VPBank (VPB)
      '970423', // TPBank (TPB)
      '970403', // Sacombank (STB)
      '970437', // HDBank (HDB)
      '970454', // VietCapitalBank (VCCB)
      '970429', // SCB
      '970441', // VIB
      '970443', // SHB
      '970431', // Eximbank (EIB)
      '970426', // MSB
      '546034', // CAKE
      '546035', // Ubank
      '971005', // ViettelMoney (VTLMONEY)
      '963388', // Timo
      '971011', // VNPTMoney
      '970400', // SaigonBank (SGICB)
      '970409', // BacABank (BAB)
      '971133', // PVcomBank Pay (PVDB)
      '970412', // PVcomBank (PVCB)
      '970414', // MBV
      '970419', // NCB
      '970424', // ShinhanBank (SHBVN)
      '970425', // ABBANK (ABB)
      '970427', // VietABank (VAB)
      '970428', // NamABank (NAB)
      '970430', // PGBank (PGB)
      '970433', // VietBank
      '970438', // BaoVietBank (BVB)
      '970440', // SeABank (SEAB)
      '970446', // COOPBANK
      '970449', // LPBank (LPB)
      '970452', // KienLongBank (KLB)
      '668888', // KBank
      '977777', // MAFC
      '970467', // KEBHANAHN
      '970466', // KEBHANAHCM
      '533948', // Citibank
      '999888', // VBSP
      '970444', // CBBank (CBB)
      '422589', // CIMB
      '796500', // DBSBank (DBS)
      '970406', // Vikki
      '970439', // PublicBank (PBVN)
      '970463', // KookminHCM (KBHCM)
      '970462', // KookminHN (KBHN)
      '970457', // Woori (WVN)
      '970421', // VRB
      '970408', // GPBank (GPB)
      '970442', // HongLeong (HLBVN)
      '458761', // HSBC
      '970455', // IBKHN
      '970456', // IBKHCM
      '801011', // Nonghyup (NHB HN)
      '970458', // UnitedOverseas (UOB)
      '970434', // IndovinaBank (IVB)
      '970410', // StandardChartered (SCVN)
    ];
    
    return supportedBins.includes(bankBin);
  }

  /**
   * Get bank name from BIN code
   * @param bankBin Bank BIN code
   * @returns Bank name or null if not found
   */
  static getBankNameFromBin(bankBin: string): string | null {
    const bankNames: Record<string, string> = {
      '970415': 'VietinBank', // ICB
      '970436': 'Vietcombank', // VCB
      '970418': 'BIDV',
      '970405': 'Agribank', // VBA
      '970448': 'OCB',
      '970422': 'MBBank', // MB
      '970407': 'Techcombank', // TCB
      '970416': 'ACB',
      '970432': 'VPBank', // VPB
      '970423': 'TPBank', // TPB
      '970403': 'Sacombank', // STB
      '970437': 'HDBank', // HDB
      '970454': 'VietCapitalBank', // VCCB
      '970429': 'SCB',
      '970441': 'VIB',
      '970443': 'SHB',
      '970431': 'Eximbank', // EIB
      '970426': 'MSB',
      '546034': 'CAKE',
      '546035': 'Ubank',
      '971005': 'ViettelMoney', // VTLMONEY
      '963388': 'Timo',
      '971011': 'VNPTMoney', // VNPTMONEY
      '970400': 'SaigonBank', // SGICB
      '970409': 'BacABank', // BAB
      '971133': 'PVcomBank Pay', // PVDB
      '970412': 'PVcomBank', // PVCB
      '970414': 'MBV',
      '970419': 'NCB',
      '970424': 'ShinhanBank', // SHBVN
      '970425': 'ABBANK', // ABB
      '970427': 'VietABank', // VAB
      '970428': 'NamABank', // NAB
      '970430': 'PGBank', // PGB
      '970433': 'VietBank', // VIETBANK
      '970438': 'BaoVietBank', // BVB
      '970440': 'SeABank', // SEAB
      '970446': 'COOPBANK',
      '970449': 'LPBank', // LPB
      '970452': 'KienLongBank', // KLB
      '668888': 'KBank',
      '977777': 'MAFC',
      '970467': 'KEBHanaHN', // KEBHANAHN
      '970466': 'KEBHanaHCM', // KEBHANAHCM
      '533948': 'Citibank',
      '999888': 'VBSP',
      '970444': 'CBBank', // CBB
      '422589': 'CIMB',
      '796500': 'DBSBank', // DBS
      '970406': 'Vikki',
      '970439': 'PublicBank', // PBVN
      '970463': 'KookminHCM', // KBHCM
      '970462': 'KookminHN', // KBHN
      '970457': 'Woori', // WVN
      '970421': 'VRB',
      '970408': 'GPBank', // GPB
      '970442': 'HongLeong', // HLBVN
      '458761': 'HSBC',
      '970455': 'IBKHN', // IBK - HN
      '970456': 'IBKHCM', // IBK - HCM
      '801011': 'Nonghyup', // NHB HN
      '970458': 'UnitedOverseas', // UOB
      '970434': 'IndovinaBank', // IVB
      '970410': 'StandardChartered', // SCVN
    };

    return bankNames[bankBin] || null;
  }
}

export default QRLocal;