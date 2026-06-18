"use client";

import { useState } from "react";
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
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useToast } from "@/hooks/use-toast";

export default function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const invitationToken = searchParams.get("invitationToken") || "";
  const invitedName = searchParams.get("name") || "";
  const invitedEmail = searchParams.get("email") || "";
  const [formData, setFormData] = useState({
    name: invitedName,
    email: invitedEmail,
    password: "",
    confirmPassword: "",
    joinOrganization: false,
    organizationName: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [pendingApproval, setPendingApproval] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, type, checked, value } = e.target;

    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
      ...(name === "joinOrganization" && !checked
        ? { organizationName: "" }
        : {}),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    // Validation
    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match");
      setIsLoading(false);
      return;
    }

    if (formData.password.length < 8) {
      setError("Password must be at least 8 characters");
      setIsLoading(false);
      return;
    }

    if (
      formData.joinOrganization &&
      formData.organizationName.trim().length === 0
    ) {
      setError("Please enter an organization name");
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          password: formData.password,
          invitationToken: invitationToken || undefined,
          joinOrganization: formData.joinOrganization,
          organizationName: formData.organizationName.trim() || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Registration failed");
      }

      if (data.isApproved) {
        const signInResult = await signIn("credentials", {
          email: formData.email,
          password: formData.password,
          redirect: false,
        });

        if (signInResult?.error) {
          throw new Error("Account created, but automatic sign-in failed. Please sign in manually.");
        }

        toast({
          title: "Account created",
          description: "Welcome! You are now signed in.",
        });

        router.push("/dashboard");
        router.refresh();
        return;
      }

      setPendingApproval(Boolean(data.requiresApproval));
    } catch (err: any) {
      setError(err.message || "An error occurred during registration");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOAuthSignUp = async (provider: "google") => {
    setIsLoading(true);
    setError("");

    try {
      const providersResponse = await fetch("/api/auth/providers", {
        cache: "no-store",
      });
      const providers = await providersResponse.json();

      if (!providers?.[provider]) {
        throw new Error(
          "Google sign-up is not configured yet. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local.",
        );
      }

      if (invitationToken) {
        localStorage.setItem("pendingInvitationToken", invitationToken);
      }

      await signIn(provider, { callbackUrl: "/dashboard" });
    } catch (err: any) {
      setError(err?.message || "Unable to start OAuth sign-up");
      setIsLoading(false);
    }
  };

  if (pendingApproval) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 p-4">
        <Card className="w-full max-w-md bg-gray-900/80 border-gray-700 backdrop-blur-sm relative z-10">
          <CardHeader>
            <CardTitle className="text-2xl font-bold text-center text-green-600">
              Registration Successful!
            </CardTitle>
            <CardDescription className="text-center text-gray-400">
              Your account has been created
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <Alert className="bg-green-900/50 border-green-700">
              <AlertDescription className="text-green-200">
                Your account is pending approval. You will be notified via email
                once an administrator approves your account.
              </AlertDescription>
            </Alert>
            <Button
              onClick={() => router.push("/auth/signin")}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            >
              Go to Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 p-4">
      <Card className="w-full max-w-md bg-gray-900/80 border-gray-700 backdrop-blur-sm relative z-10">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center text-gray-100">
            Create an Account
          </CardTitle>
          <CardDescription className="text-center text-gray-400">
            Sign up to access the Legal Document Analysis AI
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert
              variant="destructive"
              className="mb-4 bg-red-900/50 border-red-700"
            >
              <AlertDescription className="text-red-200">{error}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-gray-200">Full Name</Label>
              <Input
                id="name"
                name="name"
                type="text"
                placeholder="John Doe"
                value={formData.name}
                onChange={handleChange}
                required
                disabled={isLoading}
                className="bg-gray-800 border-gray-600 text-gray-100 placeholder:text-gray-500"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="text-gray-200">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="you@example.com"
                value={formData.email}
                onChange={handleChange}
                required
                disabled={isLoading || Boolean(invitationToken)}
                className="bg-gray-800 border-gray-600 text-gray-100 placeholder:text-gray-500"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-gray-200">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="At least 8 characters"
                value={formData.password}
                onChange={handleChange}
                required
                disabled={isLoading}
                minLength={8}
                className="bg-gray-800 border-gray-600 text-gray-100 placeholder:text-gray-500"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-gray-200">
                Confirm Password
              </Label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                placeholder="Re-enter your password"
                value={formData.confirmPassword}
                onChange={handleChange}
                required
                disabled={isLoading}
                minLength={8}
                className="bg-gray-800 border-gray-600 text-gray-100 placeholder:text-gray-500"
              />
            </div>

            {!invitationToken && (
              <div className="space-y-3 rounded-md border border-gray-700 bg-gray-800/40 p-3">
                <div className="flex items-center gap-2">
                  <input
                    id="joinOrganization"
                    name="joinOrganization"
                    type="checkbox"
                    checked={formData.joinOrganization}
                    onChange={handleChange}
                    disabled={isLoading}
                    className="h-4 w-4 rounded border-gray-500 bg-gray-800"
                  />
                  <Label htmlFor="joinOrganization" className="text-gray-200">
                    I want to join an organization
                  </Label>
                </div>

                {formData.joinOrganization && (
                  <div className="space-y-2">
                    <Label htmlFor="organizationName" className="text-gray-200">
                      Organization Name
                    </Label>
                    <Input
                      id="organizationName"
                      name="organizationName"
                      type="text"
                      placeholder="Enter organization name"
                      value={formData.organizationName}
                      onChange={handleChange}
                      required={formData.joinOrganization}
                      disabled={isLoading}
                      className="bg-gray-800 border-gray-600 text-gray-100 placeholder:text-gray-500"
                    />
                  </div>
                )}
              </div>
            )}

            <Button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              disabled={isLoading}
            >
              {isLoading ? "Creating account..." : "Sign Up"}
            </Button>
          </form>

          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-gray-700" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-gray-900 px-2 text-gray-400">
                Or continue with
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              className="w-full bg-gray-800 border-gray-600 text-gray-200 hover:bg-gray-700 hover:text-white"
              onClick={() => handleOAuthSignUp("google")}
              disabled={isLoading}
            >
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Sign up with Google
            </Button>

          </div>
        </CardContent>
        <CardFooter className="text-sm text-center text-gray-400">
          Already have an account?{" "}
          <Link
            href="/auth/signin"
            className="text-blue-400 hover:underline ml-1"
          >
            Sign in
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
