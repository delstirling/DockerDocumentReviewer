"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  RefreshCw,
  Send,
  Ban,
  Copy,
  CheckCircle2,
  XCircle,
  Clock,
  Mail,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Invitation {
  id: string;
  token: string;
  email: string;
  role: string;
  status: string;
  used: boolean;
  expires: string;
  createdAt: string;
  acceptedAt?: string;
  reminderCount?: number;
  reminderSentAt?: string;
  revokedAt?: string;
  inviterName?: string;
  inviterEmail?: string;
}

interface InvitationsData {
  pending: Invitation[];
  expired: Invitation[];
  accepted: Invitation[];
}

export function InvitationManagement() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [invitations, setInvitations] = useState<InvitationsData>({
    pending: [],
    expired: [],
    accepted: [],
  });
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);
  const [selectedInvitation, setSelectedInvitation] =
    useState<Invitation | null>(null);

  const fetchInvitations = async () => {
    try {
      const res = await fetch("/api/admin/invite");
      const data = await res.json();

      if (res.ok && data.success) {
        setInvitations(data.invitations);
      } else {
        toast({
          title: "Error",
          description: "Failed to load invitations",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error fetching invitations:", error);
      toast({
        title: "Error",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvitations();
  }, []);

  const handleResend = async (invitation: Invitation) => {
    setActionLoading(invitation.id);
    try {
      const res = await fetch(`/api/admin/invite/${invitation.id}/resend`, {
        method: "POST",
      });

      const data = await res.json();

      if (res.ok && data.success) {
        toast({
          title: "Invitation Resent! 🎉",
          description: `New invitation sent to ${invitation.email}`,
        });
        await fetchInvitations();
      } else {
        toast({
          title: "Error",
          description: data.error || "Failed to resend invitation",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error resending invitation:", error);
      toast({
        title: "Error",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemind = async (invitation: Invitation) => {
    setActionLoading(invitation.id);
    try {
      const res = await fetch(`/api/admin/invite/${invitation.id}/remind`, {
        method: "POST",
      });

      const data = await res.json();

      if (res.ok && data.success) {
        toast({
          title: "Reminder Sent! 📧",
          description: `Reminder sent to ${invitation.email}`,
        });
        await fetchInvitations();
      } else {
        toast({
          title: "Error",
          description: data.error || "Failed to send reminder",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error sending reminder:", error);
      toast({
        title: "Error",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRevoke = async () => {
    if (!selectedInvitation) return;

    setActionLoading(selectedInvitation.id);
    try {
      const res = await fetch(
        `/api/admin/invite/${selectedInvitation.id}/revoke`,
        {
          method: "POST",
        },
      );

      const data = await res.json();

      if (res.ok && data.success) {
        toast({
          title: "Invitation Revoked",
          description: `Invitation for ${selectedInvitation.email} has been revoked`,
        });
        await fetchInvitations();
      } else {
        toast({
          title: "Error",
          description: data.error || "Failed to revoke invitation",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error revoking invitation:", error);
      toast({
        title: "Error",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
      setRevokeDialogOpen(false);
      setSelectedInvitation(null);
    }
  };

  const handleCopyLink = (invitation: Invitation) => {
    const inviteUrl = `${window.location.origin}/auth/invite/${invitation.token}`;
    navigator.clipboard.writeText(inviteUrl);
    toast({
      title: "Link Copied! 📋",
      description: "Invitation link copied to clipboard",
    });
  };

  const getStatusBadge = (invitation: Invitation) => {
    if (invitation.status === "revoked") {
      return <Badge variant="destructive">Revoked</Badge>;
    }
    if (invitation.used) {
      return (
        <Badge variant="default" className="bg-green-600">
          Accepted
        </Badge>
      );
    }
    if (new Date(invitation.expires) < new Date()) {
      return <Badge variant="secondary">Expired</Badge>;
    }
    return (
      <Badge variant="outline" className="border-blue-600 text-blue-600">
        Pending
      </Badge>
    );
  };

  const getRoleDisplay = (role: string) => {
    switch (role) {
      case "admin":
        return (
          <Badge variant="default" className="bg-purple-600">
            Admin
          </Badge>
        );
      case "viewer":
        return (
          <Badge variant="default" className="bg-blue-600">
            Viewer
          </Badge>
        );
      default:
        return (
          <Badge variant="default" className="bg-green-600">
            User
          </Badge>
        );
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getTimeRemaining = (expiresAt: string) => {
    const now = new Date();
    const expires = new Date(expiresAt);
    const hoursRemaining = Math.round(
      (expires.getTime() - now.getTime()) / (1000 * 60 * 60),
    );

    if (hoursRemaining < 0) return "Expired";
    if (hoursRemaining < 24) return `${hoursRemaining}h remaining`;
    const daysRemaining = Math.round(hoursRemaining / 24);
    return `${daysRemaining}d remaining`;
  };

  const renderInvitationTable = (
    invitationList: Invitation[],
    title: string,
    icon: React.ReactNode,
  ) => {
    if (invitationList.length === 0) {
      return null;
    }

    return (
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            {icon}
            <CardTitle>{title}</CardTitle>
          </div>
          <CardDescription>
            {invitationList.length} invitation
            {invitationList.length !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Invited By</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitationList.map((invitation) => (
                <TableRow key={invitation.id}>
                  <TableCell className="font-medium">
                    {invitation.email}
                  </TableCell>
                  <TableCell>{getRoleDisplay(invitation.role)}</TableCell>
                  <TableCell>{getStatusBadge(invitation)}</TableCell>
                  <TableCell className="text-sm text-gray-600">
                    {invitation.inviterName ||
                      invitation.inviterEmail ||
                      "Unknown"}
                  </TableCell>
                  <TableCell className="text-sm text-gray-600">
                    {formatDate(invitation.createdAt)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {getTimeRemaining(invitation.expires)}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      {!invitation.used && invitation.status !== "revoked" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleResend(invitation)}
                            disabled={actionLoading === invitation.id}
                            title="Resend with new password"
                          >
                            {actionLoading === invitation.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRemind(invitation)}
                            disabled={actionLoading === invitation.id}
                            title="Send reminder"
                          >
                            <Send className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleCopyLink(invitation)}
                            title="Copy invitation link"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedInvitation(invitation);
                              setRevokeDialogOpen(true);
                            }}
                            disabled={actionLoading === invitation.id}
                            title="Revoke invitation"
                            className="text-red-600 hover:text-red-700"
                          >
                            <Ban className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                      {invitation.reminderCount &&
                        invitation.reminderCount > 0 && (
                          <Badge variant="secondary" className="ml-2">
                            {invitation.reminderCount} reminder
                            {invitation.reminderCount !== 1 ? "s" : ""}
                          </Badge>
                        )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center py-8">
            <Loader2 className="h-12 w-12 animate-spin text-purple-600 mb-4" />
            <p className="text-gray-600">Loading invitations...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-6">
        {renderInvitationTable(
          invitations.pending,
          "Pending Invitations",
          <Clock className="h-5 w-5 text-blue-600" />,
        )}
        {renderInvitationTable(
          invitations.expired,
          "Expired Invitations",
          <XCircle className="h-5 w-5 text-orange-600" />,
        )}
        {renderInvitationTable(
          invitations.accepted,
          "Accepted Invitations",
          <CheckCircle2 className="h-5 w-5 text-green-600" />,
        )}

        {invitations.pending.length === 0 &&
          invitations.expired.length === 0 &&
          invitations.accepted.length === 0 && (
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Mail className="h-12 w-12 text-gray-400 mb-4" />
                  <p className="text-gray-600 font-medium">
                    No invitations yet
                  </p>
                  <p className="text-sm text-gray-500 mt-2">
                    Send your first invitation to get started
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
      </div>

      <AlertDialog open={revokeDialogOpen} onOpenChange={setRevokeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke Invitation</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to revoke the invitation for{" "}
              <strong>{selectedInvitation?.email}</strong>? This action cannot
              be undone and the invitation link will no longer work.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              className="bg-red-600 hover:bg-red-700"
            >
              Revoke Invitation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
