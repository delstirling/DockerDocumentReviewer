"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, PlusCircle, UserPlus, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TopTitleBar } from "@/components/top-title-bar";

interface OrganizationData {
  organization: {
    id: number;
    name: string;
    currentUserTier: "admin" | "user";
  } | null;
  members: Array<{
    id: number;
    name: string;
    email: string;
    organizationTier: "admin" | "user";
  }>;
}

export default function OrganizationPage() {
  const [organization, setOrganization] = useState<OrganizationData["organization"]>(
    null,
  );
  const [name, setName] = useState("");
  const [members, setMembers] = useState<OrganizationData["members"]>([]);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberTier, setMemberTier] = useState<"admin" | "user">("user");
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isManagingMembers, setIsManagingMembers] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    loadOrganization();
  }, []);

  async function loadOrganization() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/organization", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Failed to load organization");
      }

      const data = (await response.json()) as OrganizationData;
      setOrganization(data.organization);
      setMembers(data.members || []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load organization",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/organization", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to create organization");
      }

      setName("");
      setMessage(
        data.joinedExisting
          ? "Organization linked successfully."
          : "Organization created successfully.",
      );
      await loadOrganization();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create organization",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAddMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsManagingMembers(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/organization", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "addMember",
          email: memberEmail,
          tier: memberTier,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to add member");
      }

      setMemberEmail("");
      setMemberTier("user");
      setMessage("Member added to organization.");
      await loadOrganization();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setIsManagingMembers(false);
    }
  }

  async function handleTierChange(memberId: number, tier: "admin" | "user") {
    setIsManagingMembers(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/organization", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ memberId, tier }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to update tier");
      }

      setMessage("Member tier updated.");
      await loadOrganization();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update tier");
    } finally {
      setIsManagingMembers(false);
    }
  }

  async function handleRemoveMember(memberId: number) {
    setIsManagingMembers(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/organization?memberId=${memberId}`, {
        method: "DELETE",
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to remove member");
      }

      setMessage("Member removed from organization.");
      await loadOrganization();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove member");
    } finally {
      setIsManagingMembers(false);
    }
  }

  async function handleSendInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsInviting(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/organization/invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: inviteName,
          email: inviteEmail,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to send invitation");
      }

      setInviteName("");
      setInviteEmail("");
      setMessage("Invitation email sent.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send invitation");
    } finally {
      setIsInviting(false);
    }
  }

  const isOrgAdmin = organization?.currentUserTier === "admin";

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
              <CardTitle className="text-gray-100">Organization Management</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoading ? (
                <p className="text-sm text-gray-400">Loading organization...</p>
              ) : (
                <>
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

                  {organization ? (
                    <div className="space-y-4">
                      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4 text-gray-100">
                        <p className="text-sm text-gray-400">Current organization</p>
                        <p className="mt-2 text-lg font-semibold">
                          <Building2 className="mr-2 inline h-5 w-5" />
                          {organization.name}
                        </p>
                        <p className="mt-2 text-sm text-gray-300">
                          Your tier: {organization.currentUserTier === "admin" ? "Admin" : "User"}
                        </p>
                      </div>

                      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
                        <p className="text-sm text-gray-400 mb-3">Organization Members</p>
                        <div className="space-y-3">
                          {members.map((member) => (
                            <div
                              key={member.id}
                              className="flex flex-col gap-2 rounded-md border border-gray-700 bg-gray-900 p-3 md:flex-row md:items-center md:justify-between"
                            >
                              <div>
                                <p className="text-sm font-medium text-gray-100">{member.name}</p>
                                <p className="text-xs text-gray-400">{member.email}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Select
                                  value={member.organizationTier}
                                  onValueChange={(value) =>
                                    handleTierChange(member.id, value as "admin" | "user")
                                  }
                                  disabled={!isOrgAdmin || isManagingMembers}
                                >
                                  <SelectTrigger className="w-[130px] bg-gray-800 border-gray-700 text-gray-100">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="admin">Admin</SelectItem>
                                    <SelectItem value="user">User</SelectItem>
                                  </SelectContent>
                                </Select>
                                {isOrgAdmin && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="border-gray-700 text-red-300 hover:text-red-200"
                                    disabled={isManagingMembers}
                                    onClick={() => handleRemoveMember(member.id)}
                                  >
                                    <UserX className="mr-1 h-4 w-4" />
                                    Remove
                                  </Button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {isOrgAdmin && (
                        <form
                          className="space-y-3 rounded-lg border border-gray-700 bg-gray-800 p-4"
                          onSubmit={handleAddMember}
                        >
                          <p className="text-sm text-gray-300">
                            Add existing user to {organization.name}
                          </p>
                          <div className="space-y-2">
                            <Label htmlFor="memberEmail" className="text-gray-200">
                              User Email
                            </Label>
                            <Input
                              id="memberEmail"
                              type="email"
                              value={memberEmail}
                              onChange={(event) => setMemberEmail(event.target.value)}
                              className="bg-gray-800 border-gray-700 text-gray-100"
                              placeholder="user@example.com"
                              required
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-gray-200">Tier</Label>
                            <Select
                              value={memberTier}
                              onValueChange={(value) =>
                                setMemberTier(value as "admin" | "user")
                              }
                              disabled={isManagingMembers}
                            >
                              <SelectTrigger className="w-[140px] bg-gray-800 border-gray-700 text-gray-100">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="admin">Admin</SelectItem>
                                <SelectItem value="user">User</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <Button disabled={isManagingMembers} className="w-full">
                            <UserPlus className="mr-2 h-4 w-4" />
                            {isManagingMembers ? "Updating..." : "Add Member"}
                          </Button>
                        </form>
                      )}

                      {isOrgAdmin && (
                        <form
                          className="space-y-3 rounded-lg border border-gray-700 bg-gray-800 p-4"
                          onSubmit={handleSendInvitation}
                        >
                          <p className="text-sm text-gray-300">Invite new user</p>
                          <div className="space-y-2">
                            <Label htmlFor="inviteName" className="text-gray-200">
                              Name
                            </Label>
                            <Input
                              id="inviteName"
                              type="text"
                              value={inviteName}
                              onChange={(event) => setInviteName(event.target.value)}
                              className="bg-gray-800 border-gray-700 text-gray-100"
                              placeholder="Enter full name"
                              required
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="inviteEmail" className="text-gray-200">
                              Email address
                            </Label>
                            <Input
                              id="inviteEmail"
                              type="email"
                              value={inviteEmail}
                              onChange={(event) => setInviteEmail(event.target.value)}
                              className="bg-gray-800 border-gray-700 text-gray-100"
                              placeholder="user@example.com"
                              required
                            />
                          </div>
                          <Button disabled={isInviting} className="w-full">
                            {isInviting ? "Sending..." : "Send Invitation"}
                          </Button>
                        </form>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4 text-sm text-gray-300">
                        Unaffiliated. Create your organization below.
                      </div>

                      <form className="space-y-3" onSubmit={handleCreateOrganization}>
                        <div className="space-y-2">
                          <Label htmlFor="organizationName" className="text-gray-200">
                            Organization Name
                          </Label>
                          <Input
                            id="organizationName"
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            className="bg-gray-800 border-gray-700 text-gray-100"
                            placeholder="Enter organization name"
                            required
                          />
                        </div>

                        <Button disabled={isSaving} className="w-full">
                          <PlusCircle className="mr-2 h-4 w-4" />
                          {isSaving ? "Creating..." : "Create Organization"}
                        </Button>
                      </form>
                    </>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
