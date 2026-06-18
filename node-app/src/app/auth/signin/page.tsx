"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import Link from "next/link";

function SignInPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";
  const error = searchParams.get("error");
  const resetSuccess = searchParams.get("reset") === "success";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [formError, setFormError] = useState("");

  const errorMessages: Record<string, string> = {
    CredentialsSignin: "Invalid email or password",
    OAuthAccountNotLinked:
      "This email is already associated with another account",
    AccountNotApproved:
      "Your account is pending approval. Please contact an administrator.",
    AccountInactive:
      "Your account has been deactivated. Please contact an administrator.",
    default: "An error occurred during sign in",
  };

  const handleCredentialsSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setFormError("");

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setFormError(errorMessages[result.error] || errorMessages.default);
      } else if (result?.ok) {
        router.push(callbackUrl);
        router.refresh();
      }
    } catch (error) {
      setFormError("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 p-4">
      <Card className="w-full max-w-md bg-gray-900/80 border-gray-700 backdrop-blur-sm relative z-10">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center text-gray-100">
            Legal Document Analysis AI
          </CardTitle>
          <CardDescription className="text-center text-gray-400">
            Sign in to access the platform
          </CardDescription>
        </CardHeader>
        <CardContent>
          {resetSuccess && !error && !formError && (
            <Alert className="mb-4 bg-green-900/50 border-green-700">
              <AlertDescription className="text-green-200">
                Password reset successful. You can now sign in with your new password.
              </AlertDescription>
            </Alert>
          )}

          {(error || formError) && (
            <Alert
              variant="destructive"
              className="mb-4 bg-red-900/50 border-red-700"
            >
              <AlertDescription className="text-red-200">
                {formError ||
                  errorMessages[error as string] ||
                  errorMessages.default}
              </AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleCredentialsSignIn} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-gray-200">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isLoading}
                className="bg-gray-800 border-gray-600 text-gray-100 placeholder:text-gray-500"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-gray-200">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isLoading}
                className="bg-gray-800 border-gray-600 text-gray-100"
              />
            </div>
            <Button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              disabled={isLoading}
            >
              {isLoading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex flex-col space-y-2">
          <div className="text-sm text-center text-gray-400">
            Don't have an account?{" "}
            <Link href="/auth/signup" className="text-blue-400 hover:underline">
              Sign up
            </Link>
          </div>
          <div className="text-sm text-center text-gray-400">
            <Link
              href="/auth/forgot-password"
              className="text-blue-400 hover:underline"
            >
              Forgot password?
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950" />}>
      <SignInPageContent />
    </Suspense>
  );
}
