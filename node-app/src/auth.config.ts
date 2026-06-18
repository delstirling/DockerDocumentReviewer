import type { NextAuthOptions } from "next-auth";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { db } from "@/db/client";
import { users } from "@/db/schema/auth";
import { eq } from "drizzle-orm";

/**
 * NextAuth Configuration
 * Defines authentication providers and session strategy
 */
export default {
  providers: [
    // Google OAuth Provider
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      // SECURITY: Disabled dangerous email account linking to prevent account takeover.
      // An attacker could create an OAuth account with a victim's email to hijack their session.
      allowDangerousEmailAccountLinking: false,
    }),

    // GitHub OAuth Provider
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID || "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
      allowDangerousEmailAccountLinking: false,
    }),

    // Email/Password Credentials Provider
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = credentials.email as string;
        const password = credentials.password as string;

        // Find user by email
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        if (!user || !user.password) {
          return null;
        }

        // Verify password
        const isPasswordValid = await compare(password, user.password);
        if (!isPasswordValid) {
          return null;
        }

        // Check if account is active and approved
        if (!user.isActive) {
          throw new Error("Account is inactive. Please contact administrator.");
        }

        if (!user.isApproved) {
          throw new Error(
            "Account pending approval. Please wait for admin approval.",
          );
        }

        // Return user object (password excluded)
        // Include both legacy role and new roles array
        const userRoles = [user.role || "user"];
        return {
          id: String(user.id),
          email: user.email,
          name: user.name,
          image: null,
          role: user.role,
          roles: userRoles,
        };
      },
    }),
  ],

  pages: {
    signIn: "/auth/signin",
    signOut: "/auth/signout",
    error: "/auth/error",
    verifyRequest: "/auth/verify-request",
    newUser: "/auth/new-user",
  },

  callbacks: {
    async signIn({ user, account }) {
      // For OAuth providers, check if user is approved
      if (account?.provider !== "credentials") {
        const [existingUser] = await db
          .select()
          .from(users)
          .where(eq(users.email, user.email!))
          .limit(1);

        if (existingUser && !existingUser.isApproved) {
          return "/auth/error?error=AccountNotApproved";
        }

        if (existingUser && !existingUser.isActive) {
          return "/auth/error?error=AccountInactive";
        }
      }

      return true;
    },

    async jwt({ token, user, trigger, session }) {
      // Initial sign in
      if (user) {
        token.id = typeof user.id === "string" ? Number(user.id) : user.id;
        token.role = (user as any).role || "user";
        // Set roles array - use roles if available, otherwise create array from single role
        token.roles = (user as any).roles || [(user as any).role || "user"];
      }

      // Handle session updates (e.g., profile updates)
      if (trigger === "update" && session) {
        token.name = session.name;
        token.image = session.image;
      }

      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as number;
        session.user.role = token.role as string;
        session.user.roles = (token.roles as string[]) || [
          token.role as string,
        ];
      }

      return session;
    },
  },

  session: {
    strategy: "jwt",
    // SECURITY (HIPAA): Reduced from 30 days to 8 hours for automatic logoff compliance.
    // HIPAA §164.312(a)(2)(iii) requires automatic logoff after a period of inactivity.
    maxAge: 8 * 60 * 60, // 8 hours
  },
} satisfies NextAuthOptions;
