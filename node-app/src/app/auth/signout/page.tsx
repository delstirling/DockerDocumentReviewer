"use client";

import { signOut } from "next-auth/react";
import { useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function SignOutPage() {
  useEffect(() => {
    signOut({ callbackUrl: "/auth/signin" });
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-center">
            Signing Out...
          </CardTitle>
          <CardDescription className="text-center">
            Please wait while we sign you out
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center py-6">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </CardContent>
      </Card>
    </div>
  );
}
