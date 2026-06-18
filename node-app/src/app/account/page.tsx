"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, Save, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TopTitleBar } from "@/components/top-title-bar";

interface AccountData {
  user: {
    id: number;
    name: string;
    email: string;
    role: string;
  };
  organization: {
    id: number;
    name: string;
  } | null;
}

export default function AccountPage() {
  const [account, setAccount] = useState<AccountData | null>(null);
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    loadAccount();
  }, []);

  async function loadAccount() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/account/me", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Failed to load account details");
      }

      const data = (await response.json()) as AccountData;
      setAccount(data);
      setName(data.user.name ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load account");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/account/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to update account");
      }

      setMessage("Account updated successfully.");
      await loadAccount();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update account");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <TopTitleBar />
      <div className="p-4 md:p-8">
        <div className="mx-auto max-w-2xl space-y-4">
          <Button asChild variant="ghost" className="text-gray-300 hover:text-white">
            <Link href="/dashboard">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Link>
          </Button>

          <Card className="bg-gray-900 border-gray-700">
            <CardHeader>
              <CardTitle className="text-gray-100">Manage Account</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-sm text-gray-400">Loading account...</p>
              ) : (
                <form className="space-y-4" onSubmit={handleSubmit}>
                  {error && (
                    <Alert variant="destructive" className="bg-red-900/50 border-red-700">
                      <AlertDescription className="text-red-200">{error}</AlertDescription>
                    </Alert>
                  )}
                  {message && (
                    <Alert className="bg-green-900/30 border-green-700">
                      <AlertDescription className="text-green-200">{message}</AlertDescription>
                    </Alert>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="name" className="text-gray-200">
                      Display Name
                    </Label>
                    <div className="relative">
                      <User className="absolute left-3 top-2.5 h-4 w-4 text-gray-500" />
                      <Input
                        id="name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        className="bg-gray-800 border-gray-700 text-gray-100 pl-10"
                        placeholder="Your name"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-gray-200">Email</Label>
                    <Input
                      value={account?.user.email ?? ""}
                      readOnly
                      className="bg-gray-800 border-gray-700 text-gray-400"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-gray-200">Organization</Label>
                    {account?.organization ? (
                      <div className="rounded-md border border-gray-700 bg-gray-800 p-3 text-sm text-gray-200">
                        <Building2 className="mr-2 inline h-4 w-4" />
                        {account.organization.name}
                      </div>
                    ) : (
                      <div className="rounded-md border border-gray-700 bg-gray-800 p-3 text-sm text-gray-400">
                        Unaffiliated. <Link href="/organization" className="text-blue-300 underline">Create organization</Link>
                      </div>
                    )}
                  </div>

                  <Button disabled={isSaving} className="w-full">
                    <Save className="mr-2 h-4 w-4" />
                    {isSaving ? "Saving..." : "Save Changes"}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
