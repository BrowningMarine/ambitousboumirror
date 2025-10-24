export default function PaymentLayout({  
    children,  
  }: {  
    children: React.ReactNode;  
  }) {  
    return (  
      <div className="payment-standalone-layout">  
        {children}  
      </div>  
    );  
  }