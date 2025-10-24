// This is a server component
import React from "react";
import { EditAccountClient } from "./edit-account-client";

// Define the PageParams interface here since we can't import it from @/types
interface PageParams {
  id: string;
  locale: string;
}

// Server component wrapper that extracts the ID and passes it to the client component
export default async function EditAccountPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  // Safely await and extract the ID
  const resolvedParams = await params;
  const id = resolvedParams?.id || "";

  // Pass the ID directly to the client component
  return <EditAccountClient id={id} />;
}
