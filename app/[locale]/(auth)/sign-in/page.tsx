// app/(auth)/sign-in/page.tsx
import AuthForm from "@/components/AuthForm";
import { Suspense } from "react";
import { Loader2 } from "lucide-react";

export default function SignIn() {

  return (
    <Suspense
      fallback={
        <div className="flex-center size-full">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      }
    >
      <section className="flex-center size-full max-sm:px-6">
        <AuthForm type="sign-in" />
      </section>
    </Suspense>
  );
}
