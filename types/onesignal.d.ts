interface OneSignalEventListener {  
  (event: unknown): void;  
}  

interface OneSignalPrompt {  
  type?: string;  
  autoPrompt?: boolean;  
  text?: {  
    actionMessage?: string;  
    acceptButton?: string;  
    cancelButton?: string;  
    cancelMessage?: string;  
  };  
  delay?: {  
    pageViews?: number;  
    timeDelay?: number;  
  };  
}  

interface OneSignalNotifications {  
  permission: boolean;  
  isPushEnabled: () => Promise<boolean>;  
  requestPermission: () => Promise<boolean>;  
  addEventListener: (event: string, listener: OneSignalEventListener) => void;  
  removeEventListener: (event: string, listener: OneSignalEventListener) => void;  
}  

interface OneSignalUser {  
  addTags: (tags: Record<string, string | number | boolean>) => Promise<void>;  
  getTags: () => Promise<Record<string, string>>;  
  removeTag: (key: string) => Promise<void>;  
  removeTags: (keys: string[]) => Promise<void>;  
  getOnesignalId: () => Promise<string | null>;  
  getExternalId: () => Promise<string | null>;  
}  

interface OneSignalDebug {  
  setLogLevel: (level: string) => void;  
}  

interface OneSignalInitOptions {  
  appId: string;  
  allowLocalhostAsSecureOrigin?: boolean;  
  serviceWorkerPath?: string;  
  serviceWorkerUpdaterPath?: string;  
  subdomainName?: string;  
  autoResubscribe?: boolean;  
  autoRegister?: boolean;  
  notifyButton?: {  
    enable?: boolean;  
    size?: 'small' | 'medium' | 'large';  
    position?: 'bottom-left' | 'bottom-right';  
    showCredit?: boolean;  
    prenotify?: boolean;  
    theme?: 'default' | 'inverse';  
    text?: Record<string, string>;  
  };  
  persistNotification?: boolean;  
  promptOptions?: {  
    slidedown?: {  
      prompts?: OneSignalPrompt[];  
    };  
  };  
  [key: string]: unknown;  
}  

interface OneSignal {  
  init: (options: OneSignalInitOptions) => Promise<void>;  
  login: (externalId: string) => Promise<void>;  
  logout: () => Promise<void>;  
  User: OneSignalUser;  
  Notifications: OneSignalNotifications;  
  Debug: OneSignalDebug;  
  getNotificationPermission: () => Promise<string>;  
  showSlidedownPrompt: (options?: unknown) => Promise<void>;  
  isPushNotificationsEnabled: () => Promise<boolean>;  
}  

// Declare global to merge with existing Window definition  
declare global {  
  interface Window {  
    OneSignal: OneSignal;  
  }  
}  

// Export for use in other modules if needed  
export type { OneSignal, OneSignalInitOptions, OneSignalUser, OneSignalNotifications };  