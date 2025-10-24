import axios from 'axios';  

interface NotificationData {  
  orderId?: string;  
  amount?: number;  
  type?: string;  
  bankInfo?: string;  
  timestamp?: string;  
  [key: string]: unknown; // Allow additional custom properties  
}  

// Updated interface with optional fields  
interface OneSignalFilter {  
  field?: string;  
  key?: string;  
  relation?: string;  
  value?: string;  
  operator?: string;  
}  

interface OneSignalNotificationResponse {  
  id: string;  
  recipients: number;  
  external_id?: string;  
  errors?: Record<string, unknown>;  
}  

export class NotificationService {  
  private static appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;  
  private static restApiKey = process.env.ONESIGNAL_REST_API_KEY;  
  
  /**  
   * Send a notification to all subscribed users  
   */  
  public static async sendToAll(  
    heading: string,   
    content: string,   
    additionalData?: NotificationData  
  ): Promise<boolean> {  
    try {  
      if (!this.appId || !this.restApiKey) {  
        console.warn('OneSignal configuration missing');  
        return false;  
      }  
      
      const response = await axios.post<OneSignalNotificationResponse>(  
        'https://onesignal.com/api/v1/notifications',  
        {  
          app_id: this.appId,  
          included_segments: ['Subscribed Users'],  
          headings: { en: heading },  
          contents: { en: content },  
          data: additionalData || {},  
        },  
        {  
          headers: {  
            'Content-Type': 'application/json',  
            'Authorization': `Basic ${this.restApiKey}`  
          }  
        }  
      );  
      
      //console.log('OneSignal notification sent:', response.data);  
      return true;  
    } catch (error) {  
      console.error('Error sending OneSignal notification:', error);  
      return false;  
    }  
  }  
  
  /**  
   * Send a notification to admin users (uses tags to filter users)  
   */  
  public static async sendToAdmins(  
    heading: string,   
    content: string,   
    additionalData?: NotificationData  
  ): Promise<boolean> {  
    try {  
      if (!this.appId || !this.restApiKey) {  
        console.warn('OneSignal configuration missing');  
        return false;  
      }  
      
      // Updated filters to include both admin and transactor roles  
      const filters: OneSignalFilter[] = [  
        { field: 'tag', key: 'role', relation: '=', value: 'admin' },
      ];  
      
      const response = await axios.post<OneSignalNotificationResponse>(  
        'https://onesignal.com/api/v1/notifications',  
        {  
          app_id: this.appId,  
          filters,  
          headings: { en: heading },  
          contents: { en: content },  
          data: additionalData || {},  
        },  
        {  
          headers: {  
            'Content-Type': 'application/json',  
            'Authorization': `Basic ${this.restApiKey}`  
          }  
        }  
      );  
      
      //console.log('OneSignal notification sent to admins and transactors:', response.data);  
      return true;  
    } catch (error) {  
      console.error('Error sending OneSignal notification to admins and transactors:', error);  
      return false;  
    }  
  }  
  
  /**  
   * Send a notification to users with specific roles  
   */  
  public static async sendToRoles(  
    heading: string,  
    content: string,  
    roles: string[],  
    additionalData?: NotificationData  
  ): Promise<boolean> {  
    try {  
      if (!this.appId || !this.restApiKey) {  
        console.warn('OneSignal configuration missing');  
        return false;  
      }  
      
      // Create filters array with OR operators between roles  
      const filters: OneSignalFilter[] = [];  
      
      // Add each role with OR operators between them  
      roles.forEach((role, index) => {  
        if (index > 0) {  
          filters.push({ operator: 'OR' });  
        }  
        
        filters.push({ field: 'tag', key: 'role', relation: '=', value: role });  
      });  
      
      const response = await axios.post<OneSignalNotificationResponse>(  
        'https://onesignal.com/api/v1/notifications',  
        {  
          app_id: this.appId,  
          filters,  
          headings: { en: heading },  
          contents: { en: content },  
          data: additionalData || {},  
        },  
        {  
          headers: {  
            'Content-Type': 'application/json',  
            'Authorization': `Basic ${this.restApiKey}`  
          }  
        }  
      );  
      
      //console.log(`OneSignal notification sent to roles (${roles.join(', ')}):`, response.data);  
      return true;  
    } catch (error) {  
      console.error(`Error sending OneSignal notification to roles (${roles.join(', ')}):`, error);  
      return false;  
    }  
  }  

  /**  
   * Send a notification to specific users by their external user ID  
   * This assumes users have an external_user_id set in OneSignal  
   */  
  public static async sendToUsers(  
    heading: string,  
    content: string,  
    userIds: string[],  
    additionalData?: NotificationData  
  ): Promise<boolean> {  
    try {  
      if (!this.appId || !this.restApiKey) {  
        console.warn('OneSignal configuration missing');  
        return false;  
      }  
      
      if (!userIds.length) {  
        console.warn('No user IDs provided for notification');  
        return false;  
      }  
      
      const response = await axios.post<OneSignalNotificationResponse>(  
        'https://onesignal.com/api/v1/notifications',  
        {  
          app_id: this.appId,  
          include_external_user_ids: userIds,  
          headings: { en: heading },  
          contents: { en: content },  
          data: additionalData || {},  
        },  
        {  
          headers: {  
            'Content-Type': 'application/json',  
            'Authorization': `Basic ${this.restApiKey}`  
          }  
        }  
      );  
      
      //console.log(`OneSignal notification sent to specific users:`, response.data);  
      return true;  
    } catch (error) {  
      console.error(`Error sending OneSignal notification to specific users:`, error);  
      return false;  
    }  
  }  

  /**  
   * Send a notification to users associated with a merchant account and with specific roles  
   */  
  public static async sendToMerchantAndRoles(  
    heading: string,  
    content: string,  
    merchantAccountId: string, // The publicTransactionId  
    additionalRoles: string[] = ['admin', 'transactor', 'merchant'], // Default roles to notify  
    additionalData?: NotificationData  
  ): Promise<boolean> {  
    try {  
      if (!this.appId || !this.restApiKey) {  
        console.warn('OneSignal configuration missing');  
        return false;  
      }  
      
      // Import account actions  
      const { getAccount } = await import('@/lib/actions/account.actions');  
      
      // Get the merchant account by publicTransactionId  
      const merchantAccount = await getAccount(merchantAccountId);  
      
      if (!merchantAccount) {  
        console.warn(`Merchant account not found: ${merchantAccountId}`);  
        // Continue with role-based notification even if merchant isn't found  
      }  
      
      // Get the user IDs associated with this account  
      let merchantUserIds: string[] = [];  
      if (merchantAccount) {  
        // If users is a string (single user ID)  
        if (typeof merchantAccount.users === 'string') {  
          merchantUserIds.push(merchantAccount.users);  
        }   
        // If users is an array of user IDs  
        else if (Array.isArray(merchantAccount.users)) {  
          merchantUserIds = [...merchantAccount.users];  
        }  
        
        // Add any reference users if they exist  
        if (merchantAccount.referenceUserId) {  
          if (typeof merchantAccount.referenceUserId === 'string') {  
            merchantUserIds.push(merchantAccount.referenceUserId);  
          } else if (Array.isArray(merchantAccount.referenceUserId)) {  
            merchantUserIds = [...merchantUserIds, ...merchantAccount.referenceUserId];  
          }  
        }  
      }  

      // Create filters for role-based notification  
      const filters: OneSignalFilter[] = [];  
      
      // Add role-based filters  
      additionalRoles.forEach((role, index) => {  
        if (index > 0) {  
          filters.push({ operator: 'OR' });  
        }  
        filters.push({ field: 'tag', key: 'role', relation: '=', value: role });  
      });  
      
      // Send notification to admins/transactors by role  
      const roleResponse = await axios.post<OneSignalNotificationResponse>(  
        'https://onesignal.com/api/v1/notifications',  
        {  
          app_id: this.appId,  
          filters,  
          headings: { en: heading },  
          contents: { en: content },  
          data: additionalData || {},  
        },  
        {  
          headers: {  
            'Content-Type': 'application/json',  
            'Authorization': `Basic ${this.restApiKey}`  
          }  
        }  
      );  
      
      //console.log(`OneSignal notification sent to roles (${additionalRoles.join(', ')}):`, roleResponse.data);  
      
      // If we have merchant user IDs, send to them specifically  
      if (merchantUserIds.length > 0) {  
        // Remove duplicates  
        const uniqueUserIds = [...new Set(merchantUserIds)];  
        
        const userResponse = await axios.post<OneSignalNotificationResponse>(  
          'https://onesignal.com/api/v1/notifications',  
          {  
            app_id: this.appId,  
            include_external_user_ids: uniqueUserIds,  
            headings: { en: heading },  
            contents: { en: content },  
            data: additionalData || {},  
          },  
          {  
            headers: {  
              'Content-Type': 'application/json',  
              'Authorization': `Basic ${this.restApiKey}`  
            }  
          }  
        );  
        
        //console.log(`OneSignal notification sent to merchant users:`, userResponse.data);  
      }  
      
      return true;  
    } catch (error) {  
      console.error(`Error sending merged notification:`, error);  
      return false;  
    }  
  }  
}