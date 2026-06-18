"use client";

import { Suspense } from "react";
import { Card, CardContent } from "@/components/ui/card";
import SignUpForm from "./signup-form";

function SignUpLoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 p-4">
      <Card className="w-full max-w-md bg-gray-900/80 border-gray-700 backdrop-blur-sm">
        <CardContent className="pt-6">
          <div className="text-center text-gray-400">Loading...</div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SignUpPage() {
  return (
    <Suspense fallback={<SignUpLoadingFallback />}>
      <SignUpForm />
    </Suspense>
  );
}
