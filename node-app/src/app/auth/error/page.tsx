"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

function AuthErrorPageContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  const errorMessages: Record<string, { title: string; description: string }> =
    {
      Configuration: {
        title: "Configuration Error",
        description:
          "There is a problem with the server configuration. Please contact support.",
      },
      AccessDenied: {
        title: "Access Denied",
        description: "You do not have permission to sign in.",
      },
      Verification: {
        title: "Verification Failed",
        description:
          "The verification token has expired or has already been used.",
      },
      OAuthSignin: {
        title: "OAuth Sign In Error",
        description:
          "Error in constructing an authorization URL. Please try again.",
      },
      OAuthCallback: {
        title: "OAuth Callback Error",
        description: "Error in handling the response from the OAuth provider.",
      },
      OAuthCreateAccount: {
        title: "OAuth Account Creation Error",
        description: "Could not create an OAuth provider user in the database.",
      },
      EmailCreateAccount: {
        title: "Email Account Creation Error",
        description: "Could not create an email provider user in the database.",
      },
      Callback: {
        title: "Callback Error",
        description: "Error in the OAuth callback handler route.",
      },
      OAuthAccountNotLinked: {
        title: "Account Not Linked",
        description:
          "This email is already associated with another sign-in method.",
      },
      EmailSignin: {
        title: "Email Sign In Error",
        description: "The email could not be sent. Please try again.",
      },
      CredentialsSignin: {
        title: "Sign In Failed",
        description:
          "Invalid email or password. Please check your credentials and try again.",
      },
      SessionRequired: {
        title: "Session Required",
        description: "Please sign in to access this page.",
      },
      AccountNotApproved: {
        title: "Account Pending Approval",
        description:
          "Your account is awaiting administrator approval. You will be notified via email once approved.",
      },
      AccountInactive: {
        title: "Account Inactive",
        description:
          "Your account has been deactivated. Please contact an administrator.",
      },
      Forbidden: {
        title: "Access Forbidden",
        description: "You don't have permission to access this resource.",
      },
      default: {
        title: "Authentication Error",
        description: "An unexpected error occurred. Please try again.",
      },
    };

  const errorInfo = errorMessages[error || "default"] || errorMessages.default;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-center text-red-600 flex items-center justify-center gap-2">
            <AlertCircle className="h-6 w-6" />
            {errorInfo.title}
          </CardTitle>
          <CardDescription className="text-center">
            Authentication Error
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{errorInfo.description}</AlertDescription>
          </Alert>

          <div className="flex flex-col gap-2">
            <Button asChild className="w-full">
              <Link href="/auth/signin">Back to Sign In</Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link href="/">Go to Home</Link>
            </Button>
          </div>

          {error === "AccountNotApproved" && (
            <p className="text-sm text-center text-muted-foreground mt-4">
              Need help? Contact support at{" "}
              <a
                href="mailto:support@example.com"
                className="text-primary hover:underline"
              >
                support@example.com
              </a>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50 dark:bg-slate-950" />}>
      <AuthErrorPageContent />
    </Suspense>
  );
}
