"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle, XCircle, User, Shield, Eye } from "lucide-react";
import { useRouter } from "next/navigation";

interface UserData {
  id: number;
  name: string | null;
  email: string;
  role: string;
  isActive: boolean;
  isApproved: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
}

interface UserManagementProps {
  users: UserData[];
}

export function UserManagement({ users: initialUsers }: UserManagementProps) {
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers);
  const [loading, setLoading] = useState<number | null>(null);

  const updateUserStatus = async (
    userId: number,
    field: "isActive" | "isApproved",
    value: boolean,
  ) => {
    setLoading(userId);
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, field, value }),
      });

      if (!response.ok) {
        throw new Error("Failed to update user");
      }

      setUsers((prev) =>
        prev.map((user) =>
          user.id === userId ? { ...user, [field]: value } : user,
        ),
      );

      router.refresh();
    } catch (error) {
      console.error("Error updating user:", error);
      alert("Failed to update user");
    } finally {
      setLoading(null);
    }
  };

  const updateUserRole = async (userId: number, role: string) => {
    setLoading(userId);
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, field: "role", value: role }),
      });

      if (!response.ok) {
        throw new Error("Failed to update role");
      }

      setUsers((prev) =>
        prev.map((user) => (user.id === userId ? { ...user, role } : user)),
      );

      router.refresh();
    } catch (error) {
      console.error("Error updating role:", error);
      alert("Failed to update role");
    } finally {
      setLoading(null);
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "admin":
        return <Shield className="h-4 w-4" />;
      case "viewer":
        return <Eye className="h-4 w-4" />;
      default:
        return <User className="h-4 w-4" />;
    }
  };

  const pendingApprovals = users.filter((u) => !u.isApproved);
  const activeUsers = users.filter((u) => u.isActive && u.isApproved);
  const inactiveUsers = users.filter((u) => !u.isActive);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Pending Approvals
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingApprovals.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Active Users</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeUsers.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Inactive Users
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{inactiveUsers.length}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>User Management</CardTitle>
          <CardDescription>
            Approve, activate, deactivate, and manage user roles
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Approved</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last Login</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {getRoleIcon(user.role)}
                        {user.name || "N/A"}
                      </div>
                    </TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Select
                        value={user.role}
                        onValueChange={(value) =>
                          updateUserRole(user.id, value)
                        }
                        disabled={loading === user.id}
                      >
                        <SelectTrigger className="w-[130px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="user">User</SelectItem>
                          <SelectItem value="viewer">Viewer</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.isActive ? "default" : "secondary"}>
                        {user.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.isApproved ? "default" : "outline"}>
                        {user.isApproved ? "Yes" : "Pending"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {user.lastLoginAt
                        ? new Date(user.lastLoginAt).toLocaleDateString()
                        : "Never"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {!user.isApproved && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              updateUserStatus(user.id, "isApproved", true)
                            }
                            disabled={loading === user.id}
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Approve
                          </Button>
                        )}
                        {user.isActive ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              updateUserStatus(user.id, "isActive", false)
                            }
                            disabled={loading === user.id}
                          >
                            <XCircle className="h-4 w-4 mr-1" />
                            Deactivate
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              updateUserStatus(user.id, "isActive", true)
                            }
                            disabled={loading === user.id}
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Activate
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
