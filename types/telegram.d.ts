// types/telegram.d.ts  
interface TelegramMainButton {  
  setText(text: string): TelegramMainButton;  
  show(): TelegramMainButton;  
  hide(): TelegramMainButton;  
  enable(): TelegramMainButton;  
  disable(): TelegramMainButton;  
  onClick(callback: () => void): TelegramMainButton;  
  offClick(callback: () => void): TelegramMainButton;  
  showProgress(leaveActive: boolean): TelegramMainButton;  
  hideProgress(): TelegramMainButton;  
  isActive: boolean;  
  isVisible: boolean;  
  isProgressVisible: boolean;  
}  

interface TelegramBackButton {  
  show(): TelegramBackButton;  
  hide(): TelegramBackButton;  
  onClick(callback: () => void): TelegramBackButton;  
  offClick(callback: () => void): TelegramBackButton;  
  isVisible: boolean;  
}  

interface TelegramWebApp {  
  ready(): void;  
  expand(): void;  
  close(): void;  
  sendData(data: string): void;  
  MainButton: TelegramMainButton;  
  BackButton: TelegramBackButton;  
  themeParams: {  
    bg_color: string;  
    text_color: string;  
    hint_color: string;  
    link_color: string;  
    button_color: string;  
    button_text_color: string;  
  };  
  onEvent(eventType: string, eventHandler: () => void): void;  
  offEvent(eventType: string, eventHandler: () => void): void;  
}  

declare global {  
  interface Window {  
    Telegram: {  
      WebApp: TelegramWebApp;  
    }  
  }  
}  

export {}