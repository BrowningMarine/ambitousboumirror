"use client";

import { getLoggedInUser } from "@/lib/actions/user.actions";
import { useEffect, useState } from "react";
// Only import types if we need to specifically use them in type annotations, which we don't need now
// since we're using the global Window interface extension

// Global flag to prevent multiple initializations across the entire app
let isOneSignalInitialized = false;

// Check sessionStorage for initialization state (survives component remounts)
const getInitializationState = () => {
  if (typeof window === "undefined") return false;
  return isOneSignalInitialized || sessionStorage.getItem('onesignal-initialized') === 'true';
};

const setInitializationState = (state: boolean) => {
  isOneSignalInitialized = state;
  if (typeof window !== "undefined") {
    if (state) {
      sessionStorage.setItem('onesignal-initialized', 'true');
    } else {
      sessionStorage.removeItem('onesignal-initialized');
    }
  }
};

export default function OneSignalSetup() {
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    
    // Check if already initialized globally or in sessionStorage
    if (getInitializationState()) {
      console.log("OneSignal already initialized (from previous session), skipping...");
      setInitialized(true);
      return;
    }

    const initOneSignal = async () => {
      const oneSignal = window.OneSignal;

      if (!initialized && !getInitializationState() && oneSignal) {
        try {
          // Set global flag before initialization to prevent race conditions
          setInitializationState(true);
          
          console.log("Initializing OneSignal...");
          // Initialize OneSignal with minimal configuration
          await oneSignal.init({
            appId: process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID! || "",
            allowLocalhostAsSecureOrigin: true,

            // Disable notification bell
            notifyButton: {
              enable: false,
            },

            // Use OneSignal's default slidedown prompt
            promptOptions: {
              slidedown: {
                prompts: [
                  {
                    type: "push",
                    autoPrompt: true,
                    text: {
                      actionMessage:
                        "Would you like to receive transaction notifications?",
                      acceptButton: "Allow",
                      cancelButton: "No Thanks",
                    },
                    delay: {
                      pageViews: 1,
                      timeDelay: 10,
                    },
                  },
                ],
              },
            },
          });

          try {
            // Get logged in user
            const loggedIn = await getLoggedInUser();

            if (loggedIn && loggedIn.userId) {
              // Login the user to OneSignal
              await oneSignal.login(loggedIn.userId);

              // Add user tags for segmentation
              if (oneSignal.User) {
                await oneSignal.User.addTags({
                  role: loggedIn.role,
                  userId: loggedIn.userId,
                });
              }
            }
          } catch (userError) {
            console.error("Error with OneSignal user login:", userError);
          }

          setInitialized(true);
          console.log("OneSignal initialization completed successfully");
        } catch (error) {
          // Reset global flag on initialization failure
          setInitializationState(false);
          console.error("Error initializing OneSignal:", error);
        }
      }
    };

    // Add a small delay to ensure OneSignal is loaded
    const timer = setTimeout(() => {
      initOneSignal();
    }, 2000);

    return () => {
      clearTimeout(timer);
    };
  }, [initialized]);

  // No UI is needed for normal operation
  return null;
}
