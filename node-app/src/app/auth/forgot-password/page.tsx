"use client";

import { useState } from "react";
import Link from "next/link";
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

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to send reset email");
      }

      setSubmitted(true);
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
            Reset Password
          </CardTitle>
          <CardDescription className="text-center text-gray-400">
            {submitted
              ? "Check your email for reset instructions"
              : "Enter your email address to receive a password reset link"}
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
                If an account exists with that email address, you will receive
                password reset instructions shortly. Please check your inbox and
                spam folder.
              </AlertDescription>
            </Alert>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
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
              <Button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                disabled={isLoading}
              >
                {isLoading ? "Sending..." : "Send Reset Link"}
              </Button>
            </form>
          )}
        </CardContent>
        <CardFooter className="flex justify-center">
          <div className="text-sm text-gray-400">
            Remember your password?{" "}
            <Link href="/auth/signin" className="text-blue-400 hover:underline">
              Sign in
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
