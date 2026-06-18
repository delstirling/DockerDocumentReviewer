"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2, XCircle, Mail, Shield } from "lucide-react";

interface InvitationData {
  email: string;
  role: string;
  invitedBy: string;
  expires: string;
}

export default function InvitePage() {
  const router = useRouter();
  const params = useParams();
  const token = params?.token as string;

  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [invitation, setInvitation] = useState<InvitationData | null>(null);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    password: "",
    confirmPassword: "",
  });

  // Verify invitation token on mount
  useEffect(() => {
    async function verifyToken() {
      if (!token) {
        setError("No invitation token provided");
        setVerifying(false);
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/invite/verify?token=${token}`);
        const data = await res.json();

        if (!res.ok || !data.valid) {
          setError(data.error || "Invalid or expired invitation");
          setVerifying(false);
          setLoading(false);
          return;
        }

        setInvitation(data.invitation);
        setVerifying(false);
        setLoading(false);
      } catch (err) {
        console.error("Error verifying invitation:", err);
        setError("Failed to verify invitation");
        setVerifying(false);
        setLoading(false);
      }
    }

    verifyToken();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Validation
    if (!formData.name.trim()) {
      setError("Name is required");
      return;
    }

    if (formData.password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setSubmitting(true);

    try {
      // Register user with invitation token
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          email: invitation!.email,
          password: formData.password,
          invitationToken: token,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Registration failed");
        setSubmitting(false);
        return;
      }

      // Auto sign-in after successful registration
      const signInResult = await signIn("credentials", {
        email: invitation!.email,
        password: formData.password,
        redirect: false,
      });

      if (signInResult?.error) {
        setError(
          "Account created but sign-in failed. Please sign in manually.",
        );
        setSubmitting(false);
        setTimeout(() => router.push("/auth/signin"), 2000);
        return;
      }

      // Success - redirect to dashboard
      router.push("/");
      router.refresh();
    } catch (err) {
      console.error("Registration error:", err);
      setError("An unexpected error occurred");
      setSubmitting(false);
    }
  };

  const getRoleDisplay = (role: string) => {
    switch (role) {
      case "admin":
        return { label: "Administrator", color: "text-purple-600" };
      case "viewer":
        return { label: "Viewer", color: "text-blue-600" };
      default:
        return { label: "User", color: "text-green-600" };
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-blue-50">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center py-8">
              <Loader2 className="h-12 w-12 animate-spin text-purple-600 mb-4" />
              <p className="text-gray-600">Verifying invitation...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Invalid invitation state
  if (!invitation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-blue-50">
        <Card className="w-full max-w-md border-red-200">
          <CardHeader>
            <div className="flex items-center gap-2 text-red-600 mb-2">
              <XCircle className="h-6 w-6" />
              <CardTitle>Invalid Invitation</CardTitle>
            </div>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600 mb-4">
              This invitation link may have expired, been used already, or is
              invalid. Please contact the administrator for a new invitation.
            </p>
            <Button
              onClick={() => router.push("/auth/signin")}
              variant="outline"
              className="w-full"
            >
              Go to Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const roleDisplay = getRoleDisplay(invitation.role);
  const expiresAt = new Date(invitation.expires);
  const timeRemaining = Math.round(
    (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60),
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-blue-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center justify-center mb-4">
            <div className="bg-gradient-to-br from-purple-500 to-blue-600 p-3 rounded-full">
              <Mail className="h-8 w-8 text-white" />
            </div>
          </div>
          <CardTitle className="text-center text-2xl">
            You&apos;re Invited! 🎉
          </CardTitle>
          <CardDescription className="text-center">
            Create your account to get started
          </CardDescription>
        </CardHeader>

        <CardContent>
          {/* Invitation Details */}
          <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-lg p-4 mb-6 border border-purple-100">
            <div className="space-y-2 text-sm">
              <div className="flex items-start gap-2">
                <Mail className="h-4 w-4 text-gray-500 mt-0.5" />
                <div>
                  <p className="text-gray-500">Email</p>
                  <p className="font-medium text-gray-900">
                    {invitation.email}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Shield className="h-4 w-4 text-gray-500 mt-0.5" />
                <div>
                  <p className="text-gray-500">Role</p>
                  <p className={`font-medium ${roleDisplay.color}`}>
                    {roleDisplay.label}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-gray-500 mt-0.5" />
                <div>
                  <p className="text-gray-500">Invited by</p>
                  <p className="font-medium text-gray-900">
                    {invitation.invitedBy}
                  </p>
                </div>
              </div>
            </div>

            {timeRemaining < 24 && (
              <Alert className="mt-3 bg-yellow-50 border-yellow-200">
                <AlertDescription className="text-yellow-800 text-xs">
                  ⏰ This invitation expires in {timeRemaining} hour
                  {timeRemaining !== 1 ? "s" : ""}
                </AlertDescription>
              </Alert>
            )}
          </div>

          {/* Registration Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>
              <Input
                id="name"
                type="text"
                placeholder="John Doe"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                required
                disabled={submitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Minimum 8 characters"
                value={formData.password}
                onChange={(e) =>
                  setFormData({ ...formData, password: e.target.value })
                }
                required
                minLength={8}
                disabled={submitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Re-enter your password"
                value={formData.confirmPassword}
                onChange={(e) =>
                  setFormData({ ...formData, confirmPassword: e.target.value })
                }
                required
                minLength={8}
                disabled={submitting}
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating Account...
                </>
              ) : (
                "Create Account & Sign In"
              )}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-gray-600">
            <p>
              By creating an account, you agree to our Terms of Service and
              Privacy Policy.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
