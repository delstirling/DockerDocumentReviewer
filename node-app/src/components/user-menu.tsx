"use client";

import { useEffect, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { User, LogOut, Settings, Shield, Building2 } from "lucide-react";
import Link from "next/link";

/**
 * Helper function to check if user has a specific role
 * Supports both the new roles array and legacy single role field
 */
function userHasRole(user: any, requiredRole: string): boolean {
  if (!user) return false;

  // Check new roles array first
  const userRoles = user.roles as string[] | undefined;
  if (userRoles && Array.isArray(userRoles)) {
    return userRoles.some(
      (r: string) => r.toLowerCase() === requiredRole.toLowerCase(),
    );
  }

  // Fall back to legacy single role
  const userRole = user.role;
  if (userRole) {
    return userRole.toLowerCase() === requiredRole.toLowerCase();
  }

  return false;
}

export function UserMenu() {
  const { data: session, status } = useSession();
  const [organizationName, setOrganizationName] = useState<string | null>(
    session?.user?.organizationName ?? null,
  );

  useEffect(() => {
    let isMounted = true;

    async function loadAccountDetails() {
      if (!session?.user) {
        return;
      }

      try {
        const response = await fetch("/api/account/me", {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const data = await response.json();
        if (isMounted) {
          setOrganizationName(data.organization?.name ?? null);
        }
      } catch {
        // Non-blocking: menu can still render from session details.
      }
    }

    setOrganizationName(session?.user?.organizationName ?? null);
    loadAccountDetails();

    return () => {
      isMounted = false;
    };
  }, [session?.user]);

  if (status === "loading") {
    return (
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-full bg-slate-200 animate-pulse" />
      </div>
    );
  }

  if (!session?.user) {
    return (
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/auth/signin">Sign In</Link>
        </Button>
        <Button asChild size="sm">
          <Link href="/auth/signup">Sign Up</Link>
        </Button>
      </div>
    );
  }

  const user = session.user;
  const initials =
    user.name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase() ||
    user.email?.[0].toUpperCase() ||
    "U";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
          aria-label="Open user menu"
        >
          <Avatar className="h-10 w-10">
            <AvatarImage
              src={user.image || undefined}
              alt={user.name || "User"}
            />
            <AvatarFallback className="bg-blue-600 text-white">
              {initials}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-56 bg-gray-900 border-gray-700"
        align="end"
        forceMount
      >
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none text-gray-100">
              {user.name}
            </p>
            <p className="text-xs leading-none text-gray-400">{user.email}</p>
            {user.role && (
              <p className="text-xs leading-none text-gray-400 capitalize mt-1">
                Role: {user.role}
              </p>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-gray-700" />
        <DropdownMenuItem
          asChild
          className="text-gray-200 focus:bg-gray-800 focus:text-white"
        >
          <Link href="/account" className="cursor-pointer">
            <User className="mr-2 h-4 w-4" />
            <span>Manage Account</span>
          </Link>
        </DropdownMenuItem>
        {organizationName ? (
          <DropdownMenuItem
            asChild
            className="text-gray-200 focus:bg-gray-800 focus:text-white"
          >
            <Link href="/organization" className="cursor-pointer">
              <Building2 className="mr-2 h-4 w-4" />
              <span>{organizationName}</span>
            </Link>
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuLabel className="text-xs text-gray-400 px-2 py-1.5">
              Unaffiliated
            </DropdownMenuLabel>
            <DropdownMenuItem
              asChild
              className="text-gray-200 focus:bg-gray-800 focus:text-white"
            >
              <Link href="/organization" className="cursor-pointer">
                <Building2 className="mr-2 h-4 w-4" />
                <span>Create Organization</span>
              </Link>
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator className="bg-gray-700" />
        {userHasRole(user, "admin") && (
          <DropdownMenuItem
            asChild
            className="text-gray-200 focus:bg-gray-800 focus:text-white"
          >
            <Link href="/settings" className="cursor-pointer">
              <Settings className="mr-2 h-4 w-4" />
              <span>Settings</span>
            </Link>
          </DropdownMenuItem>
        )}
        {userHasRole(user, "software_admin") && (
          <DropdownMenuItem
            asChild
            className="text-gray-200 focus:bg-gray-800 focus:text-white"
          >
            <Link href="/workflow" className="cursor-pointer">
              <User className="mr-2 h-4 w-4" />
              <span>Workflow Config</span>
            </Link>
          </DropdownMenuItem>
        )}
        {userHasRole(user, "admin") && (
          <DropdownMenuItem
            asChild
            className="text-gray-200 focus:bg-gray-800 focus:text-white"
          >
            <Link href="/admin" className="cursor-pointer">
              <Shield className="mr-2 h-4 w-4" />
              <span>Admin Panel</span>
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator className="bg-gray-700" />
        <DropdownMenuItem
          className="cursor-pointer text-red-400 focus:bg-gray-800 focus:text-red-300"
          onClick={() => signOut({ callbackUrl: "/auth/signin" })}
        >
          <LogOut className="mr-2 h-4 w-4" />
          <span>Sign Out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
