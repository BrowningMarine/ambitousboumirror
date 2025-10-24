"use client";

import Image from "next/image";
import Link from "next/link";
import React, { useState, useTransition } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import CustomInput from "./CustomInput";
import { authFormSchema } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { signIn, signUp } from "@/lib/actions/user.actions";
import { appConfig } from "@/lib/appconfig";
import { useTranslations } from 'next-intl';

const AuthForm = ({ type }: { type: string }) => {
  const t = useTranslations('auth');
  // Get current locale from URL
  const pathname = usePathname();
  const locale = pathname.split('/')[1]; // Get the locale from the URL

  const apptitle = appConfig.title;
  const applogo = appConfig.icon;
  const allowRegister = appConfig.allowRegister;
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams?.get("callbackUrl") || "/";

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [signupSuccess, setSignupSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  const formSchema = authFormSchema(type);

  // 1. Define your form.
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues:
      type === "sign-up"
        ? {
            email: "",
            password: "",
            firstName: "",
            lastName: "",
          }
        : {
            email: "",
            password: "",
          },
  });

  // 2. Define a submit handler.
  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    setError(null);
    startTransition(async () => {
      try {
        if (type === "sign-up") {
          const response = await signUp({
            firstName: data.firstName!,
            lastName: data.lastName!,
            email: data.email,
            password: data.password,
          });

          if (response.success) {
            setSignupSuccess(true);
            setSuccessMessage(
              response.message || t('signupSuccess')
            );
          } else {
            setError(response.message || t('signupError'));
          }
        }

        if (type === "sign-in") {
          const response = await signIn({
            email: data.email,
            password: data.password,
          });

          if (!response) {
            setError(t('noResponse'));
            return;
          }

          if ("code" in response) {
            switch (response.type) {
              case "email_not_verified":
                setError(t('emailNotVerified'));
                break;
              case "invalid_credentials":
                setError(t('invalidCredentials'));
                break;
              default:
                setError(response.message ||t('authFailed'));
            }
            return;
          }

          // Successful login
          // router.refresh(); // Refresh to update auth state
          // router.push(callbackUrl);
          //console.log("callbackUrl", callbackUrl);
          router.push(callbackUrl);
        }
      } catch (error) {
        console.error(error);
        setError(t('unexpectedError'));
      }
    });
  };
  const ErrorMessage = ({ message }: { message: string | null }) => {
    if (!message) return null;
    return (
      <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm mt-2">
        {message}
      </div>
    );
  };

  return (
    <section className="auth-form">
      <header className="flex flex-col items-center gap-5 md:gap-8">
        <Link href={`/${locale}`} className="cursor-pointer flex items-center gap-1">
          <Image
            src={applogo}
            width={34}
            height={34}
            alt="app logo"
            priority={true}
            loading="eager"
            className="w-auto h-auto"
          />
          <h1 className="text-26 font-ibm-plex-serif font-bold text-black-1">
            {apptitle}
          </h1>
        </Link>
      </header>
      <div className="round-xl rounded-xl shadow-lg border border-gray-200 p-6">
        <div className="flex flex-col items-center gap-1 md:gap-3 pb-4">
          <h1 className="text-24 lg:text-36 font-semibold text-gray-900">
            {signupSuccess
              ? "Successfully!!!"
              : type === "sign-in"
              ? t('signIn')
              : t('signUp')}
          </h1>
          <p className="text-16 font-normal text-gray-600">
            {signupSuccess ? successMessage : t('enterDetails')}
          </p>
        </div>
        {signupSuccess ? (
          <div className="flex flex-col items-center gap-4">
            <Link className="form-link" href="/">
              Back to Sign In
            </Link>
          </div>
        ) : (
          <>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-8"
              >
                {type === "sign-up" && (
                  <>
                    <div className="flex gap-4">
                      <CustomInput
                        control={form.control}
                        name="firstName"
                        label="First Name"
                        placeholder="Input first name"
                      />
                      <CustomInput
                        control={form.control}
                        name="lastName"
                        label="Last Name"
                        placeholder="Input last name"
                      />
                    </div>
                  </>
                )}
                <CustomInput
                  control={form.control}
                  name="email"
                  label= {t('email')}
                  placeholder= {t('enterEmail')}
                />
                <CustomInput
                  control={form.control}
                  name="password"
                  label={t('password')}
                  placeholder={t('enterPassword')}
                />
                <div className="flex flex-col gap-4">
                  <Button
                    type="submit"
                    disabled={isPending}
                    className="form-btn"
                  >
                    {isPending ? (
                      <>
                        <Loader2 size={20} className="animate-spin" /> &nbsp;
                        {t('loading')}
                      </>
                    ) : type === "sign-in" ? (
                      t('signIn')
                    ) : (
                      t('signUp')
                    )}
                  </Button>
                  <ErrorMessage message={error} />
                  {/* Display error message */}
                </div>
              </form>
            </Form>
            <footer className="flex justify-center gap-1 pt-4">
              <p className="text-14 font-normal text-gray-600">
                {type === "sign-in"
                  ? t('noAccount')
                  : t('hasAccount')}
              </p>
              <Link
                href={type === "sign-in" 
                  ? (allowRegister === 'true' ? `/${locale}/sign-up` : "javascript:void(0)") 
                  : `/${locale}/sign-in`}
                className={`form-link ${
                  type === "sign-in" && allowRegister !== 'true' 
                    ? "pointer-events-none opacity-50" 
                    : ""
                }`}
                onClick={(e) => {
                  if (type === "sign-in" && allowRegister !== 'true') {
                    e.preventDefault();
                  }
                }}
              >
                {type === "sign-in" ? t('signUp') : t('signIn')}
              </Link>
            </footer>
          </>
        )}
      </div>
    </section>
  );
};

export default AuthForm;
