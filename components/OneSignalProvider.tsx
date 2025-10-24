'use client';  

import OneSignalSetup from './OneSignalSetup';  

type OneSignalProviderProps = {  
  children: React.ReactNode;  
};  

export default function OneSignalProvider({ children }: OneSignalProviderProps) {  
  return (  
    <>  
      {children}  
      <OneSignalSetup />  
    </>  
  );  
}  