import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user?: {
      id?: number;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role?: string;
      roles?: string[];
      organizationId?: number | null;
      organizationName?: string | null;
      organizationTier?: "admin" | "user";
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: number;
    role?: string;
    roles?: string[];
    organizationId?: number | null;
    organizationName?: string | null;
    organizationTier?: "admin" | "user";
  }
}
