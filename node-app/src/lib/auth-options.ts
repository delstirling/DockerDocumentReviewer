import type { NextAuthOptions } from "next-auth";
import { compare } from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { db } from "@/db/client";
import { organizations, users } from "@/db/schema/auth";
import { isOrganizationFeatureAvailable } from "@/lib/organization-feature";

const authSecret =
  process.env.NEXTAUTH_SECRET ??
  process.env.AUTH_SECRET ??
  (process.env.NODE_ENV === "production"
    ? undefined
    : "local-dev-nextauth-secret");

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const hasGoogleOAuth = Boolean(googleClientId && googleClientSecret);

export const authOptions: NextAuthOptions = {
  secret: authSecret,
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const orgFeatureAvailable = await isOrganizationFeatureAvailable();
        const [user] = orgFeatureAvailable
          ? await db
              .select({
                id: users.id,
                email: users.email,
                name: users.name,
                password: users.password,
                role: users.role,
                isApproved: users.isApproved,
                isActive: users.isActive,
                organizationId: users.organizationId,
                organizationName: organizations.name,
                organizationTier: users.organizationTier,
              })
              .from(users)
              .leftJoin(organizations, eq(users.organizationId, organizations.id))
              .where(eq(users.email, String(credentials.email).trim()))
              .limit(1)
          : await db
              .select({
                id: users.id,
                email: users.email,
                name: users.name,
                password: users.password,
                role: users.role,
                isApproved: users.isApproved,
                isActive: users.isActive,
                organizationId: sql<number | null>`null`,
                organizationName: sql<string | null>`null`,
                organizationTier: sql<"admin" | "user">`'user'`,
              })
              .from(users)
              .where(eq(users.email, String(credentials.email).trim()))
              .limit(1);

        if (!user?.password) {
          return null;
        }

        if (!user.isApproved) {
          throw new Error("AccountNotApproved");
        }

        if (!user.isActive) {
          throw new Error("AccountInactive");
        }

        const isValidPassword = await compare(
          String(credentials.password),
          user.password,
        );

        if (!isValidPassword) {
          return null;
        }

        return {
          id: String(user.id),
          email: user.email,
          name: user.name,
          role: user.role,
          organizationId: orgFeatureAvailable ? user.organizationId : null,
          organizationName: orgFeatureAvailable ? user.organizationName : null,
          organizationTier: orgFeatureAvailable
            ? (user.organizationTier as "admin" | "user")
            : "user",
        };
      },
    }),
    ...(hasGoogleOAuth
      ? [
          GoogleProvider({
            clientId: googleClientId as string,
            clientSecret: googleClientSecret as string,
          }),
        ]
      : []),
  ],
  pages: {
    signIn: "/auth/signin",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "google") {
        return true;
      }

      if (!user.email) {
        return "/auth/signin?error=OAuthAccountNotLinked";
      }

      const orgFeatureAvailable = await isOrganizationFeatureAvailable();
      const [existingUser] = orgFeatureAvailable
        ? await db
            .select({
              id: users.id,
              role: users.role,
              isApproved: users.isApproved,
              isActive: users.isActive,
              organizationId: users.organizationId,
              organizationTier: users.organizationTier,
              organizationName: organizations.name,
            })
            .from(users)
            .leftJoin(organizations, eq(users.organizationId, organizations.id))
            .where(eq(users.email, user.email))
            .limit(1)
        : await db
            .select({
              id: users.id,
              role: users.role,
              isApproved: users.isApproved,
              isActive: users.isActive,
              organizationId: sql<number | null>`null`,
              organizationTier: sql<"admin" | "user">`'user'`,
              organizationName: sql<string | null>`null`,
            })
            .from(users)
            .where(eq(users.email, user.email))
            .limit(1);

      if (existingUser) {
        if (!existingUser.isActive) {
          return "/auth/signin?error=AccountInactive";
        }

        if (!existingUser.isApproved) {
          return "/auth/signin?error=AccountNotApproved";
        }

        (user as any).id = String(existingUser.id);
        (user as any).role = existingUser.role;
        (user as any).organizationId = existingUser.organizationId;
        (user as any).organizationName = existingUser.organizationName;
        (user as any).organizationTier = existingUser.organizationTier;

        return true;
      }

      const [createdUser] = await db
        .insert(users)
        .values({
          name: user.name?.trim() || user.email,
          email: user.email,
          password: null,
          role: "user",
          organizationTier: "user",
          isActive: true,
          isApproved: true,
          updatedAt: new Date(),
        })
        .returning({ id: users.id, role: users.role });

      (user as any).id = String(createdUser.id);
      (user as any).role = createdUser.role;
      (user as any).organizationId = null;
      (user as any).organizationName = null;
      (user as any).organizationTier = "user";

      return true;
    },
    async jwt({ token, user }) {
      const authUser = user as
        | {
            role?: string;
            organizationId?: number | null;
            organizationName?: string | null;
            organizationTier?: "admin" | "user";
          }
        | undefined;
      const userRole = authUser?.role;

      if (user?.id) {
        token.id = Number(user.id);
      }

      if (typeof userRole === "string") {
        token.role = userRole;
        token.roles = [userRole];
      }

      if (!token.id && token.sub) {
        token.id = Number(token.sub);
      }

      if ((typeof token.id !== "number" || Number.isNaN(token.id)) && token.email) {
        const orgFeatureAvailable = await isOrganizationFeatureAvailable();
        const [dbUser] = orgFeatureAvailable
          ? await db
              .select({
                id: users.id,
                role: users.role,
                organizationId: users.organizationId,
                organizationName: organizations.name,
                organizationTier: users.organizationTier,
              })
              .from(users)
              .leftJoin(organizations, eq(users.organizationId, organizations.id))
              .where(eq(users.email, token.email))
              .limit(1)
          : await db
              .select({
                id: users.id,
                role: users.role,
                organizationId: sql<number | null>`null`,
                organizationName: sql<string | null>`null`,
                organizationTier: sql<"admin" | "user">`'user'`,
              })
              .from(users)
              .where(eq(users.email, token.email))
              .limit(1);

        if (dbUser) {
          token.id = dbUser.id;
          token.role = dbUser.role;
          token.roles = [dbUser.role];
          token.organizationId = dbUser.organizationId;
          token.organizationName = dbUser.organizationName;
          token.organizationTier = dbUser.organizationTier;
        }
      }

      if (Object.prototype.hasOwnProperty.call(authUser ?? {}, "organizationId")) {
        token.organizationId = authUser?.organizationId ?? null;
      }

      if (Object.prototype.hasOwnProperty.call(authUser ?? {}, "organizationName")) {
        token.organizationName = authUser?.organizationName ?? null;
      }

      if (Object.prototype.hasOwnProperty.call(authUser ?? {}, "organizationTier")) {
        token.organizationTier = authUser?.organizationTier ?? "user";
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user && (token.id || token.sub)) {
        session.user.id = Number(token.id ?? token.sub);
        session.user.role = token.role;
        session.user.roles = token.roles;
        session.user.organizationId = token.organizationId;
        session.user.organizationName = token.organizationName;
        session.user.organizationTier = token.organizationTier ?? "user";
      }

      return session;
    },
  },
};
