// Utility functions for encoding/decoding chat IDs

export function decodeChatId(encodedToken: string): string | null {
  try {
    // Make the token URL-safe by reversing the URL-safe base64 conversion
    let base64 = encodedToken.replace(/-/g, '+').replace(/_/g, '/');
    
    // Add padding if needed
    while (base64.length % 4) {
      base64 += '=';
    }
    
    // Custom base64 decode function (reverse of the encoder)
    function base64ToString(base64: string): string {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      let result = '';
      let i = 0;
      
      while (i < base64.length) {
        const encoded1 = chars.indexOf(base64.charAt(i++));
        const encoded2 = chars.indexOf(base64.charAt(i++));
        const encoded3 = chars.indexOf(base64.charAt(i++));
        const encoded4 = chars.indexOf(base64.charAt(i++));
        
        const bitmap = (encoded1 << 18) | (encoded2 << 12) | (encoded3 << 6) | encoded4;
        
        result += String.fromCharCode((bitmap >> 16) & 255);
        if (encoded3 !== 64) result += String.fromCharCode((bitmap >> 8) & 255);
        if (encoded4 !== 64) result += String.fromCharCode(bitmap & 255);
      }
      
      return result;
    }
    
    // Decode from base64
    const decoded = base64ToString(base64);
    
    // Remove the random suffix (everything after 'xx')
    const parts = decoded.split('xx');
    if (parts.length < 2) {
      console.log('Invalid token format: missing separator');
      return null;
    }
    
    const reversedChatId = parts[0];
    
    // Reverse the string to get original chat ID
    const originalChatId = reversedChatId.split('').reverse().join('');
    
    // Validate that it's a number
    if (isNaN(Number(originalChatId))) {
      console.log('Invalid token: decoded value is not a number');
      return null;
    }
    
    return originalChatId;
    
  } catch (error) {
    console.log('Decoding error:', error);
    return null;
  }
}

// Encoder function for testing/reference (matches your N8N function)
export function encodeChatId(str: string): string | null {
  try {
    // Convert to string and reverse
    const reversed = String(str).split('').reverse().join('');
    
    // Add random suffix for additional obfuscation
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const combined = reversed + 'xx' + randomSuffix;
    
    // Convert to base64 using btoa-like function
    function stringToBase64(str: string): string {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      let result = '';
      let i = 0;
      
      while (i < str.length) {
        const a = str.charCodeAt(i++);
        const b = i < str.length ? str.charCodeAt(i++) : 0;
        const c = i < str.length ? str.charCodeAt(i++) : 0;
        
        const bitmap = (a << 16) | (b << 8) | c;
        
        result += chars.charAt((bitmap >> 18) & 63);
        result += chars.charAt((bitmap >> 12) & 63);
        result += i - 2 < str.length ? chars.charAt((bitmap >> 6) & 63) : '=';
        result += i - 1 < str.length ? chars.charAt(bitmap & 63) : '=';
      }
      
      return result;
    }
    
    // Convert to base64 and make URL-safe
    const base64 = stringToBase64(combined);
    const encodedData = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    
    return encodedData;
    
  } catch (error) {
    console.log('Encoding error:', error);
    return null;
  }
}
