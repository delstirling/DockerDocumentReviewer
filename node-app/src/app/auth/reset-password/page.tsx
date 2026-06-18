"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!token) {
      setError("Invalid reset link. Please request a new one.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Failed to reset password");
      }

      setSubmitted(true);
      setTimeout(() => {
        router.push("/auth/signin?reset=success");
      }, 1500);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 p-4">
      <Card className="w-full max-w-md bg-gray-900/80 border-gray-700 backdrop-blur-sm relative z-10">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center text-gray-100">
            Choose a New Password
          </CardTitle>
          <CardDescription className="text-center text-gray-400">
            {submitted
              ? "Password updated. Redirecting to sign in..."
              : "Enter your new password below"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert
              variant="destructive"
              className="mb-4 bg-red-900/50 border-red-700"
            >
              <AlertDescription className="text-red-200">
                {error}
              </AlertDescription>
            </Alert>
          )}

          {submitted ? (
            <Alert className="bg-green-900/50 border-green-700">
              <AlertDescription className="text-green-200">
                Your password has been reset successfully.
              </AlertDescription>
            </Alert>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password" className="text-gray-200">
                  New Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  disabled={isLoading}
                  className="bg-gray-800 border-gray-600 text-gray-100"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-gray-200">
                  Confirm Password
                </Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                  disabled={isLoading}
                  className="bg-gray-800 border-gray-600 text-gray-100"
                />
              </div>

              <Button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                disabled={isLoading || !token}
              >
                {isLoading ? "Resetting..." : "Reset Password"}
              </Button>
            </form>
          )}
        </CardContent>
        <CardFooter className="flex justify-center">
          <div className="text-sm text-gray-400">
            Back to{" "}
            <Link href="/auth/signin" className="text-blue-400 hover:underline">
              Sign in
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950" />}>
      <ResetPasswordContent />
    </Suspense>
  );
}
