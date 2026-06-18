"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Mail, Send, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function InviteUserForm() {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    name: "",
    role: "user",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSuccess(false);

    try {
      const res = await fetch("/api/admin/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok) {
        toast({
          title: "Error",
          description: data.error || "Failed to send invitation",
          variant: "destructive",
        });
        setSubmitting(false);
        return;
      }

      toast({
        title: "Invitation Sent! 🎉",
        description: `Invitation email sent to ${formData.email}`,
      });

      setSuccess(true);
      setFormData({ email: "", name: "", role: "user" });

      // Reset success state after 3 seconds
      setTimeout(() => setSuccess(false), 3000);
    } catch (error) {
      console.error("Error sending invitation:", error);
      toast({
        title: "Error",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-purple-600" />
          <CardTitle>Invite New User</CardTitle>
        </div>
        <CardDescription>
          Send an invitation email to add a new user to the platform
        </CardDescription>
      </CardHeader>
      <CardContent>
        {success && (
          <Alert className="mb-4 bg-green-50 border-green-200">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">
              Invitation sent successfully! The user will receive an email with
              instructions to create their account.
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address *</Label>
              <Input
                id="email"
                type="email"
                placeholder="user@example.com"
                value={formData.email}
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
                required
                disabled={submitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Full Name *</Label>
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
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">Role *</Label>
            <Select
              value={formData.role}
              onValueChange={(value) =>
                setFormData({ ...formData, role: value })
              }
              disabled={submitting}
            >
              <SelectTrigger id="role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">Viewer</span>
                    <span className="text-xs text-gray-500">
                      Read-only access to documents
                    </span>
                  </div>
                </SelectItem>
                <SelectItem value="user">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">User</span>
                    <span className="text-xs text-gray-500">
                      Standard access to all features
                    </span>
                  </div>
                </SelectItem>
                <SelectItem value="admin">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">Administrator</span>
                    <span className="text-xs text-gray-500">
                      Full system access and user management
                    </span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
            <p className="font-medium mb-1">📧 What happens next?</p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li>User receives an invitation email with temporary password</li>
              <li>They can login directly with the temporary password</li>
              <li>
                Account is automatically created and approved with the selected
                role
              </li>
              <li>They must change their password on first login</li>
              <li>
                Invitation expires in 7 days, password expires in 24 hours
              </li>
            </ul>
          </div>

          <Button
            type="submit"
            className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending Invitation...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Send Invitation
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
