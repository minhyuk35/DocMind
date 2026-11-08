import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import Landing from "@/components/Landing";
import "./landing.css";

// Public landing page; signed-in users see a "go to chat" button instead of Google sign-in.
export default async function RootPage() {
  const session = await getServerSession(authOptions);
  return <Landing signedIn={Boolean(session)} />;
}
