import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { upsertUser } from "@/lib/db";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async signIn({ user, account }) {
      const userId = account?.providerAccountId;
      if (userId && user.email) {
        user.id = userId;
        await upsertUser({ id: userId, email: user.email, name: user.name, image: user.image }).catch(
          (err) => console.error("[auth] upsertUser failed:", err),
        );
      }
      return true;
    },
    async jwt({ token, account }) {
      if (account?.providerAccountId) {
        token.userId = account.providerAccountId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.userId) {
        session.user.id = token.userId as string;
      }
      return session;
    },
  },
};
